import { getDbExec } from "@agent-native/core/db";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import executePayout from "../actions/execute-payout.js";
import getBudget from "../actions/get-budget.js";
import getPolicy from "../actions/get-policy.js";
import listPayments from "../actions/list-payments.js";
import proposePayment from "../actions/propose-payment.js";
import updatePolicy from "../actions/update-policy.js";
import { SPEND_DESK_MIGRATIONS } from "../server/db/migrations.js";
import { sendPayout } from "../server/spend-desk/paypal.js";
import { validatePolicyInput } from "../server/spend-desk/policy.js";
import { resetDemo } from "../server/spend-desk/seed.js";

vi.mock("../server/spend-desk/paypal.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/spend-desk/paypal.js")>()),
  sendPayout: vi.fn(),
}));
const paypal = vi.mocked(sendPayout);

const P1 = "sb-ymuio53707515@personal.example.com";
const P2 = "sb-zyjmt53707494@personal.example.com";
const P3 = "sb-houoq53707143@personal.example.com";
const DEFAULTS = { monthlyBudgetCapUsd: 200, autoApproveLimitUsd: 25, allowedPayees: [P1, P2, P3] };

const human = { caller: "frontend" as const, userEmail: "paul@example.com" };
const agent = { caller: "tool" as const, userEmail: "paul@example.com" };
const cli = { caller: "cli" as const };

const setPolicy = (patch: Partial<typeof DEFAULTS>) => updatePolicy.run({ ...DEFAULTS, ...patch } as never, human);
const propose = async (taskId: string) => (await proposePayment.run({ taskId } as never, agent)).payment;
const execArgs = (p: { id: string; amountUsd: number; payeeEmail: string }) => ({
  paymentId: p.id,
  amountUsd: p.amountUsd,
  payeeEmail: p.payeeEmail,
  decision: "approve" as const,
});

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
  let n = 0;
  paypal.mockImplementation(async () => ({ batchId: `BATCH${++n}`, itemId: `ITEM${n}`, itemStatus: "SUCCESS" }));
});

describe("update-policy is human-only", () => {
  it("is hidden from the agent and UI-only by definition", () => {
    expect(updatePolicy.agentTool).toBe(false);
    expect(updatePolicy.uiOnly).toBe(true);
  });

  it.each([
    ["the agent", agent],
    ["the CLI", cli],
    ["no caller", undefined],
  ])("is rejected when called by %s, and the policy is unchanged", async (_who, ctx) => {
    await expect(updatePolicy.run({ ...DEFAULTS, monthlyBudgetCapUsd: 1000 } as never, ctx as never)).rejects.toThrow(/only be called from the signed-in app UI|only be changed by a person/);
    expect((await getPolicy.run({}, human)).monthlyBudgetCapUsd).toBe(200);
  });

  it("is accepted from the UI and records who changed it", async () => {
    const res = await setPolicy({ monthlyBudgetCapUsd: 300 });
    expect(res).toMatchObject({ monthlyBudgetCapUsd: 300, updatedBy: "paul@example.com" });
    expect((await getBudget.run({}, human)).capUsd).toBe(300);
  });
});

describe("validation boundaries", () => {
  const v = (patch: Partial<typeof DEFAULTS>) => validatePolicyInput({ ...DEFAULTS, ...patch });

  it("accepts a cap from $1 to $1,000", () => {
    expect(v({ monthlyBudgetCapUsd: 1, autoApproveLimitUsd: 0 }).ok).toBe(true);
    expect(v({ monthlyBudgetCapUsd: 1000 }).ok).toBe(true);
  });
  it("rejects a cap below $1 or above $1,000", () => {
    expect(v({ monthlyBudgetCapUsd: 0.99, autoApproveLimitUsd: 0 })).toMatchObject({ ok: false });
    expect(v({ monthlyBudgetCapUsd: 1000.01 })).toMatchObject({ ok: false });
  });
  it("accepts an auto limit from $0 to the cap and rejects anything outside", () => {
    expect(v({ autoApproveLimitUsd: 0 }).ok).toBe(true);
    expect(v({ autoApproveLimitUsd: 200 }).ok).toBe(true);
    expect(v({ autoApproveLimitUsd: 200.01 })).toMatchObject({ ok: false, errors: ["Auto-approve limit cannot be higher than the monthly cap."] });
    expect(v({ autoApproveLimitUsd: -0.01 })).toMatchObject({ ok: false });
  });
  it("accepts up to 10 valid payees, normalized, and rejects 11 or a bad email", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `payee${i}@example.com`);
    expect(v({ allowedPayees: ten }).ok).toBe(true);
    expect(v({ allowedPayees: [...ten, "payee10@example.com"] })).toMatchObject({ ok: false, errors: ["At most 10 allowed payees."] });
    expect(v({ allowedPayees: ["not-an-email"] })).toMatchObject({ ok: false, errors: ["Not a valid email: not-an-email."] });
    expect(v({ allowedPayees: [` ${P1.toUpperCase()} `, P1] })).toMatchObject({ ok: true, value: { allowedPayees: [P1] } });
  });
  it("rejects invalid input through the action with a clear message", async () => {
    await expect(setPolicy({ monthlyBudgetCapUsd: 5000 })).rejects.toThrow(/between \$1 and \$1,000/);
  });
});

describe("the payout gate reads the live policy", () => {
  it("lowering the auto limit makes an $18 payment need approval", async () => {
    const logo = await propose("task-logo");
    expect(await executePayout.needsApproval!(execArgs(logo) as never, agent)).toBe(false);
    await setPolicy({ autoApproveLimitUsd: 10 });
    expect(await executePayout.needsApproval!(execArgs(logo) as never, agent)).toBe(true);
    const outlook = (await listPayments.run({ status: "open" } as never, human)).payments[0]!.outlook;
    expect(outlook).toBe("needs_approval");
  });

  it("lowering the cap blocks a payment with no PayPal call", async () => {
    const blog = await propose("task-blog");
    await setPolicy({ monthlyBudgetCapUsd: 30, autoApproveLimitUsd: 25 });
    expect((await listPayments.run({ status: "open" } as never, human)).payments[0]!.outlook).toBe("blocked_over_budget");
    expect(await executePayout.needsApproval!(execArgs(blog) as never, agent)).toBe(false);
    const res = await executePayout.run(execArgs(blog) as never, human);
    expect(res.receipt).toMatchObject({ policyResult: "blocked_over_budget", budgetRemainingAfterUsd: 30 });
    expect(paypal).not.toHaveBeenCalled();
  });

  it("a cap below what is already spent leaves remaining at 0, never negative", async () => {
    await executePayout.run(execArgs(await propose("task-logo")) as never, agent); // $18 auto-paid
    await setPolicy({ monthlyBudgetCapUsd: 10, autoApproveLimitUsd: 5 });
    expect(await getBudget.run({}, human)).toMatchObject({ capUsd: 10, spentUsd: 18, remainingUsd: 0 });
    const blocked = await executePayout.run(execArgs(await propose("task-blog")) as never, human);
    expect(blocked.receipt).toMatchObject({ policyResult: "blocked_over_budget", budgetRemainingAfterUsd: 0 });
    expect(paypal).toHaveBeenCalledTimes(1);
  });

  it("removing a payee from the allowed list blocks payouts to them", async () => {
    const logo = await propose("task-logo");
    await setPolicy({ allowedPayees: [P2, P3] });
    const res = await executePayout.run(execArgs(logo) as never, agent);
    expect(res.receipt.policyResult).toBe("blocked_payee_not_allowed");
    expect(paypal).not.toHaveBeenCalled();
  });
});

describe("reset-demo", () => {
  it("restores the default policy and budget", async () => {
    await setPolicy({ monthlyBudgetCapUsd: 500, autoApproveLimitUsd: 0, allowedPayees: [P1] });
    await resetDemo(getDbExec());
    expect(await getPolicy.run({}, human)).toMatchObject({ ...DEFAULTS, updatedBy: "policy.json" });
    expect(await getBudget.run({}, human)).toMatchObject({ capUsd: 200, spentUsd: 0, remainingUsd: 200, autoApproveLimitUsd: 25 });
  });
});
