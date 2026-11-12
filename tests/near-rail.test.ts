import { getDbExec } from "@agent-native/core/db";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import executePayout from "../actions/execute-payout.js";
import getBudget from "../actions/get-budget.js";
import getPolicy from "../actions/get-policy.js";
import listCompletedTasks from "../actions/list-completed-tasks.js";
import listPayments from "../actions/list-payments.js";
import proposePayment from "../actions/propose-payment.js";
import updatePolicy from "../actions/update-policy.js";
import { SPEND_DESK_MIGRATIONS } from "../server/db/migrations.js";
import { NearError, sendNearPayout } from "../server/spend-desk/near.js";
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
const N = ["m22spend-payee1.testnet", "m22spend-payee2.testnet", "m22spend-payee3.testnet"];
const human = { caller: "frontend" as const, userEmail: "paul@example.com" };
const agent = { caller: "tool" as const, userEmail: "paul@example.com" };
const YOCTO_PER_MILLINEAR = 10n ** 21n;

const setPolicy = (patch: Record<string, unknown>) =>
  updatePolicy.run({ monthlyBudgetCapUsd: 200, autoApproveLimitUsd: 25, allowedPayees: P, ...patch } as never, human);
const propose = async (taskId: string) => (await proposePayment.run({ taskId } as never, agent)).payment;
const nearArgs = (p: { id: string; amountUsd: number; payeeEmail: string; payeeNearAccount: string | null }) => ({
  paymentId: p.id,
  amountUsd: p.amountUsd,
  payeeEmail: p.payeeEmail,
  payeeNearAccount: p.payeeNearAccount ?? undefined,
  rail: "near" as const,
  decision: "approve" as const,
});
const spent = async () => (await getBudget.run({}, human)).spentUsd;

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
  paypal.mockImplementation(async () => ({ batchId: "BATCH", itemId: "ITEM", itemStatus: "SUCCESS" }));
  let n = 0;
  near.mockImplementation(async () => ({ txHash: `TX${++n}`, outcome: "paid", onChainOutcome: "Paid" }));
});

describe("rail branching", () => {
  it("pays on PayPal by default and makes no NEAR call", async () => {
    expect((await getPolicy.run({}, human)).payoutRail).toBe("paypal");
    const p = await propose("task-logo");
    const res = await executePayout.run({ paymentId: p.id, amountUsd: 18, payeeEmail: p.payeeEmail, decision: "approve" } as never, agent);
    expect(res.receipt).toMatchObject({ policyResult: "auto_paid", paypalBatchId: "BATCH", nearTxHash: null, payeeNearAccount: null });
    expect(paypal).toHaveBeenCalledTimes(1);
    expect(near).not.toHaveBeenCalled();
  });

  it("on the NEAR rail pays through the treasury with the payment id as idempotency key", async () => {
    await setPolicy({ payoutRail: "near" });
    const p = await propose("task-logo");
    expect(p.payeeNearAccount).toBe(N[0]);
    const res = await executePayout.run(nearArgs(p) as never, agent);
    expect(near).toHaveBeenCalledWith({ idempotencyKey: p.id, payee: N[0], amountYocto: 18n * YOCTO_PER_MILLINEAR, memo: p.memo });
    expect(paypal).not.toHaveBeenCalled();
    expect(res.receipt).toMatchObject({ policyResult: "auto_paid", approver: "auto", nearTxHash: "TX1", payeeNearAccount: N[0], paypalBatchId: null });
    expect(res.payment).toMatchObject({ status: "paid", nearTxHash: "TX1" });
    expect(await spent()).toBe(18);
  });

  it("an approved NEAR payout names the human and uses the mapped payee", async () => {
    await setPolicy({ payoutRail: "near" });
    const p = await propose("task-video");
    const res = await executePayout.run(nearArgs(p) as never, human);
    expect(near.mock.calls[0]![0]).toMatchObject({ payee: N[2], amountYocto: 120n * YOCTO_PER_MILLINEAR });
    expect(res.receipt).toMatchObject({ policyResult: "approved_and_paid", approver: "paul@example.com" });
  });

  it("the demo rate scales the NEAR amount", async () => {
    await setPolicy({ payoutRail: "near", demoUsdToNear: 0.002 });
    const p = await propose("task-logo");
    await executePayout.run(nearArgs(p) as never, agent);
    expect(near.mock.calls[0]![0].amountYocto).toBe(36n * YOCTO_PER_MILLINEAR);
  });
});

describe("NEAR refusals and errors", () => {
  it("a contract refusal releases the budget and names the on-chain outcome", async () => {
    await setPolicy({ payoutRail: "near" });
    near.mockResolvedValueOnce({ txHash: "TXR", outcome: "refused", onChainOutcome: "RefusedOverTotalCap" });
    const p = await propose("task-blog");
    const res = await executePayout.run(nearArgs(p) as never, human);
    expect(res.receipt).toMatchObject({ policyResult: "blocked_on_chain", approver: "contract", nearTxHash: "TXR" });
    expect(res.receipt.detail).toContain("RefusedOverTotalCap");
    expect(res.payment.status).toBe("blocked");
    expect(await spent()).toBe(0);
    expect((await listCompletedTasks.run({ status: "completed" }, human)).tasks.map((t) => t.id)).toContain("task-blog");
  });

  it("a NEAR error releases the budget and keeps the failed transaction hash", async () => {
    await setPolicy({ payoutRail: "near" });
    near.mockRejectedValueOnce(new NearError("NEAR transaction TXF failed: key revoked", "TXF"));
    const res = await executePayout.run(nearArgs(await propose("task-logo")) as never, agent);
    expect(res.receipt).toMatchObject({ policyResult: "near_error", nearTxHash: "TXF" });
    expect(res.payment.status).toBe("error");
    expect(await spent()).toBe(0);
  });

  it("the over-budget path makes zero NEAR calls", async () => {
    await setPolicy({ payoutRail: "near" });
    const res = await executePayout.run(nearArgs(await propose("task-site")) as never, agent);
    expect(res.receipt).toMatchObject({ policyResult: "blocked_over_budget", nearTxHash: null });
    expect(res.receipt.detail).toContain("nothing was sent to the NEAR treasury");
    expect(near).not.toHaveBeenCalled();
  });

  it("a NEAR payee not on allowedNearPayees is blocked with zero NEAR calls", async () => {
    await setPolicy({ payoutRail: "near", allowedNearPayees: [N[1], N[2]] });
    const p = await propose("task-logo");
    expect((await listPayments.run({ status: "open" } as never, human)).payments[0]!.outlook).toBe("blocked_payee_not_allowed");
    const res = await executePayout.run(nearArgs(p) as never, agent);
    expect(res.receipt.policyResult).toBe("blocked_payee_not_allowed");
    expect(near).not.toHaveBeenCalled();
  });

  it("a missing or stale NEAR payee, or a stale rail, is refused before any call", async () => {
    await setPolicy({ payoutRail: "near" });
    const p = await propose("task-logo");
    await expect(executePayout.run({ ...nearArgs(p), payeeNearAccount: undefined } as never, agent)).rejects.toThrow(/pays m22spend-payee1.testnet on NEAR/);
    await expect(executePayout.run({ ...nearArgs(p), payeeNearAccount: N[1] } as never, agent)).rejects.toThrow(/pays m22spend-payee1.testnet on NEAR/);
    await expect(executePayout.run({ ...nearArgs(p), rail: "paypal" } as never, agent)).rejects.toThrow(/rail is now near/);
    expect(near).not.toHaveBeenCalled();
    expect(paypal).not.toHaveBeenCalled();
  });
});

describe("NEAR policy fields", () => {
  it("list-payments reports the live rail and each NEAR payee", async () => {
    await setPolicy({ payoutRail: "near" });
    await propose("task-blog");
    const res = await listPayments.run({ status: "all" } as never, human);
    expect(res.rail).toBe("near");
    expect(res.payments[0]).toMatchObject({ payeeNearAccount: N[1], outlook: "needs_approval" });
  });

  it("validates NEAR payees and the demo rate", async () => {
    await expect(setPolicy({ allowedNearPayees: ["evil.near"] })).rejects.toThrow(/Not a NEAR testnet account id: evil.near/);
    await expect(setPolicy({ allowedNearPayees: Array.from({ length: 11 }, (_, i) => `p${i}.testnet`) })).rejects.toThrow(/At most 10 allowed NEAR payees/);
    await expect(setPolicy({ demoUsdToNear: 0.05 })).rejects.toThrow(/Demo rate must be between/);
    await expect(setPolicy({ demoUsdToNear: 0.00001 })).rejects.toThrow(/Demo rate must be between/);
  });

  it("omitted NEAR fields keep their current values", async () => {
    await setPolicy({ payoutRail: "near", demoUsdToNear: 0.002 });
    await setPolicy({ monthlyBudgetCapUsd: 150 });
    expect(await getPolicy.run({}, human)).toMatchObject({ payoutRail: "near", demoUsdToNear: 0.002, monthlyBudgetCapUsd: 150 });
  });

  it("switching the rail is human-only", async () => {
    await expect(updatePolicy.run({ monthlyBudgetCapUsd: 200, autoApproveLimitUsd: 25, allowedPayees: P, payoutRail: "near" } as never, agent)).rejects.toThrow(
      /only be called from the signed-in app UI|only be changed by a person/,
    );
    expect((await getPolicy.run({}, human)).payoutRail).toBe("paypal");
  });

  it("reset-demo restores the PayPal rail, NEAR payees and demo rate", async () => {
    await setPolicy({ payoutRail: "near", allowedNearPayees: [N[0]], demoUsdToNear: 0.005 });
    await resetDemo(getDbExec());
    expect(await getPolicy.run({}, human)).toMatchObject({ payoutRail: "paypal", allowedNearPayees: N, demoUsdToNear: 0.001 });
  });
});
