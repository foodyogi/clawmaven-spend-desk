import { getDbExec } from "@agent-native/core/db";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import executePayout from "../actions/execute-payout.js";
import getBudget from "../actions/get-budget.js";
import listCompletedTasks from "../actions/list-completed-tasks.js";
import listReceipts from "../actions/list-receipts.js";
import proposePayment from "../actions/propose-payment.js";
import updatePolicy from "../actions/update-policy.js";
import { SPEND_DESK_MIGRATIONS } from "../server/db/migrations.js";
import { describeNearSendError, NearError, sendNearPayout } from "../server/spend-desk/near.js";
import { sendPayout } from "../server/spend-desk/paypal.js";
import { resetDemo } from "../server/spend-desk/seed.js";

vi.mock("../server/spend-desk/paypal.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/spend-desk/paypal.js")>()),
  sendPayout: vi.fn(),
}));
vi.mock("../server/spend-desk/near.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/spend-desk/near.js")>()),
  sendNearPayout: vi.fn(),
}));
const paypal = vi.mocked(sendPayout);
const near = vi.mocked(sendNearPayout);

const P = ["sb-ymuio53707515@personal.example.com", "sb-zyjmt53707494@personal.example.com", "sb-houoq53707143@personal.example.com"];
const human = { caller: "frontend" as const, userEmail: "paul@example.com" };
const agent = { caller: "tool" as const, userEmail: "paul@example.com" };

const useNear = () => updatePolicy.run({ monthlyBudgetCapUsd: 200, autoApproveLimitUsd: 25, allowedPayees: P, payoutRail: "near" } as never, human);
const propose = async (taskId: string) => (await proposePayment.run({ taskId } as never, agent)).payment;
const pay = (p: { id: string; amountUsd: number; payeeEmail: string; payeeNearAccount: string | null }, ctx: typeof human | typeof agent) =>
  executePayout.run(
    { paymentId: p.id, amountUsd: p.amountUsd, payeeEmail: p.payeeEmail, payeeNearAccount: p.payeeNearAccount ?? undefined, rail: "near", decision: "approve" } as never,
    ctx,
  );
const spent = async () => (await getBudget.run({}, human)).spentUsd;
const readyTasks = async () => (await listCompletedTasks.run({ status: "completed" }, human)).tasks.map((t) => t.id);

// What near.ts throws when the network rejects the agent's key (see describeNearSendError).
const revoked = () =>
  new NearError(`NEAR transaction was not accepted, so nothing was sent: ${describeNearSendError("Server error: AccessKeyDoesNotExist ed25519:6GyB…")}`);

beforeAll(async () => {
  const exec = getDbExec();
  for (const m of SPEND_DESK_MIGRATIONS) {
    if (typeof m.sql !== "string") continue;
    for (const statement of m.sql.split(/;\s*\n/).filter((s) => s.trim())) await exec.execute(statement);
  }
});

beforeEach(async () => {
  await resetDemo(getDbExec());
  paypal.mockReset();
  near.mockReset();
  let n = 0;
  near.mockImplementation(async () => ({ txHash: `TX${++n}`, outcome: "paid", onChainOutcome: "Paid" }));
  await useNear();
});

describe("kill switch: treasury paused", () => {
  it("a payout while paused is refused on chain, releases the budget and can be retried after unpause", async () => {
    near.mockResolvedValueOnce({ txHash: "TXPAUSED", outcome: "refused", onChainOutcome: "RefusedPaused" });
    const blog = await propose("task-blog");
    const res = await pay(blog, human);
    expect(res.receipt).toMatchObject({ policyResult: "blocked_on_chain", approver: "contract", nearTxHash: "TXPAUSED" });
    expect(res.receipt.detail).toContain("RefusedPaused");
    expect(res.payment.status).toBe("blocked");
    expect(await spent()).toBe(0);
    expect(await readyTasks()).toContain("task-blog");

    // Owner unpauses; a new proposal for the same task pays.
    const again = await pay(await propose("task-blog"), human);
    expect(again.receipt).toMatchObject({ policyResult: "approved_and_paid", nearTxHash: "TX1" });
    expect(await spent()).toBe(40);
  });
});

describe("kill switch: agent key revoked", () => {
  it("fails closed with a clear near_error receipt, no transaction and the budget released", async () => {
    near.mockRejectedValueOnce(revoked());
    const res = await pay(await propose("task-logo"), agent);
    expect(res.receipt).toMatchObject({ policyResult: "near_error", nearTxHash: null });
    expect(res.receipt.detail).toMatch(/revoked or replaced/);
    expect(res.payment.status).toBe("error");
    expect(await spent()).toBe(0);
    expect(await readyTasks()).toContain("task-logo");
  });

  it("every later NEAR payout keeps failing closed until a new key is added", async () => {
    near.mockRejectedValue(revoked());
    const logo = await pay(await propose("task-logo"), agent);
    const video = await pay(await propose("task-video"), human);
    expect([logo.receipt.policyResult, video.receipt.policyResult]).toEqual(["near_error", "near_error"]);
    expect(await spent()).toBe(0);
    expect(paypal).not.toHaveBeenCalled(); // never falls back to another rail

    // New key in place: the next proposal pays.
    near.mockReset();
    near.mockResolvedValue({ txHash: "TXNEW", outcome: "paid", onChainOutcome: "Paid" });
    const retry = await pay(await propose("task-logo"), agent);
    expect(retry.receipt).toMatchObject({ policyResult: "auto_paid", nearTxHash: "TXNEW" });
  });

  it("an exhausted gas allowance fails closed the same way", async () => {
    near.mockRejectedValueOnce(new NearError(`NEAR transaction was not accepted, so nothing was sent: ${describeNearSendError("InvalidTxError: NotEnoughAllowance")}`));
    const res = await pay(await propose("task-logo"), agent);
    expect(res.receipt.policyResult).toBe("near_error");
    expect(res.receipt.detail).toMatch(/used up its gas allowance/);
    expect(await spent()).toBe(0);
    expect((await listReceipts.run({}, human)).receipts).toHaveLength(1);
  });
});

describe("describeNearSendError", () => {
  it.each([
    ["Server error: AccessKeyDoesNotExist", /revoked or replaced/],
    ["access key ed25519:abc does not exist while viewing", /revoked or replaced/],
    ["Can't complete the action because access key ed25519:abc doesn't exist", /revoked or replaced/],
    ["[-32000] Server error: UNKNOWN_ACCESS_KEY", /revoked or replaced/],
    ["InvalidTxError: NotEnoughAllowance { allowance: 0 }", /used up its gas allowance/],
    ["ActionError: MethodNameMismatch", /not allowed to make this call/],
  ])("explains %s", (raw, expected) => {
    expect(describeNearSendError(raw)).toMatch(expected);
  });
  it("passes other errors through", () => {
    expect(describeNearSendError("fetch failed")).toBe("fetch failed");
  });
});
