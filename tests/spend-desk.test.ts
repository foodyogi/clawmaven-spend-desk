import { getDbExec } from "@agent-native/core/db";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import editPayment from "../actions/edit-payment.js";
import executePayout from "../actions/execute-payout.js";
import getBudget from "../actions/get-budget.js";
import listCompletedTasks from "../actions/list-completed-tasks.js";
import listReceipts from "../actions/list-receipts.js";
import proposePayment from "../actions/propose-payment.js";
import { SPEND_DESK_MIGRATIONS } from "../server/db/migrations.js";
import { PayPalError, sendPayout } from "../server/spend-desk/paypal.js";
import { needsHumanApproval } from "../server/spend-desk/policy.js";
import { resetDemo } from "../server/spend-desk/seed.js";
import { reserveBudget } from "../server/spend-desk/store.js";

vi.mock("../server/spend-desk/paypal.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/spend-desk/paypal.js")>()),
  sendPayout: vi.fn(),
}));
const paypal = vi.mocked(sendPayout);

const human = { caller: "frontend" as const, userEmail: "paul@example.com" };
const agent = { caller: "tool" as const, userEmail: "paul@example.com" };

async function propose(taskId: string, extra: Record<string, unknown> = {}) {
  const res = await proposePayment.run({ taskId, ...extra } as never, agent);
  return res.payment;
}

function execArgs(p: { id: string; amountUsd: number; payeeEmail: string }, decision: "approve" | "reject" = "approve") {
  return { paymentId: p.id, amountUsd: p.amountUsd, payeeEmail: p.payeeEmail, decision };
}

const budget = () => getBudget.run({}, human);

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

describe("needsHumanApproval (brief section 3.1)", () => {
  const rule = (amount: number, remaining: number) =>
    needsHumanApproval({ amountCents: amount * 100, remainingCents: remaining * 100, autoApproveLimitCents: 2500 });

  it("does not pause an amount over the remaining budget (run() blocks it)", () => {
    expect(rule(400, 200)).toBe(false);
    expect(rule(100, 42)).toBe(false);
  });
  it("does not pause an amount at or under the $25 auto-limit", () => {
    expect(rule(18, 200)).toBe(false);
    expect(rule(25, 200)).toBe(false);
  });
  it("pauses an amount over $25 that fits the remaining budget", () => {
    expect(rule(25.01, 200)).toBe(true);
    expect(rule(40, 200)).toBe(true);
    expect(rule(42, 42)).toBe(true);
  });
});

describe("executePayout needsApproval predicate", () => {
  it("returns false for $18, true for $40 and $120, false for $400", async () => {
    for (const [taskId, expected] of [
      ["task-logo", false],
      ["task-blog", true],
      ["task-video", true],
      ["task-site", false],
    ] as const) {
      const p = await propose(taskId);
      expect(await executePayout.needsApproval!(execArgs(p) as never, agent), taskId).toBe(expected);
    }
  });
  it("returns false for a reject, an unknown payment and a stale amount", async () => {
    const p = await propose("task-blog");
    expect(await executePayout.needsApproval!(execArgs(p, "reject") as never, agent)).toBe(false);
    expect(await executePayout.needsApproval!({ ...execArgs(p), paymentId: "nope" } as never, agent)).toBe(false);
    expect(await executePayout.needsApproval!({ ...execArgs(p), amountUsd: 10 } as never, agent)).toBe(false);
  });
});

describe("executePayout run() policy paths", () => {
  it("auto-pays $18: auto_paid, approver auto, budget 182", async () => {
    const res = await executePayout.run(execArgs(await propose("task-logo")) as never, agent);
    expect(res.receipt).toMatchObject({ policyResult: "auto_paid", approver: "auto", paypalBatchId: "BATCH1", paypalItemId: "ITEM1", budgetRemainingAfterUsd: 182 });
    expect(res.payment.status).toBe("paid");
    expect(paypal).toHaveBeenCalledTimes(1);
  });

  it("pays an approved $40 with the human as approver", async () => {
    const res = await executePayout.run(execArgs(await propose("task-blog")) as never, human);
    expect(res.receipt).toMatchObject({ policyResult: "approved_and_paid", approver: "paul@example.com", budgetRemainingAfterUsd: 160 });
  });

  it("blocks $400 over budget and makes zero PayPal calls", async () => {
    const res = await executePayout.run(execArgs(await propose("task-site")) as never, agent);
    expect(res.receipt).toMatchObject({ policyResult: "blocked_over_budget", approver: "system-block", paypalBatchId: null, budgetRemainingAfterUsd: 200 });
    expect(res.payment.status).toBe("blocked");
    expect(paypal).not.toHaveBeenCalled();
    expect((await budget()).spentUsd).toBe(0);
  });

  it("re-checks the budget at execution time, not only at propose time", async () => {
    const p = await propose("task-video"); // $120 fits the $200 budget when proposed
    await reserveBudget("2026-11", 10_000); // something else spends $100 before execution
    const res = await executePayout.run(execArgs(p) as never, human);
    expect(res.receipt.policyResult).toBe("blocked_over_budget");
    expect(paypal).not.toHaveBeenCalled();
  });

  it("writes a rejected receipt and never calls PayPal on reject", async () => {
    const res = await executePayout.run(execArgs(await propose("task-video"), "reject") as never, human);
    expect(res.receipt).toMatchObject({ policyResult: "rejected", approver: "paul@example.com" });
    expect(paypal).not.toHaveBeenCalled();
    const ready = await listCompletedTasks.run({ status: "completed" }, human);
    expect(ready.tasks.map((t) => t.id)).toContain("task-video"); // can be proposed again
  });

  it("blocks a payee outside allowedPayees with zero PayPal calls", async () => {
    const p = await propose("task-logo", { payeeEmail: "stranger@example.com" });
    const res = await executePayout.run(execArgs(p) as never, agent);
    expect(res.receipt).toMatchObject({ policyResult: "blocked_payee_not_allowed", approver: "system-block" });
    expect(paypal).not.toHaveBeenCalled();
  });

  it("records paypal_error and releases the budget when PayPal fails", async () => {
    paypal.mockRejectedValueOnce(new PayPalError("Payout create failed: HTTP 422 | INSUFFICIENT_FUNDS"));
    const res = await executePayout.run(execArgs(await propose("task-logo")) as never, agent);
    expect(res.receipt.policyResult).toBe("paypal_error");
    expect(res.receipt.detail).toContain("INSUFFICIENT_FUNDS");
    expect(res.payment.status).toBe("error");
    expect((await budget()).spentUsd).toBe(0);
  });

  it("refuses to execute the same payment twice", async () => {
    const p = await propose("task-logo");
    await executePayout.run(execArgs(p) as never, agent);
    await expect(executePayout.run(execArgs(p) as never, agent)).rejects.toThrow(/already paid/);
    expect(paypal).toHaveBeenCalledTimes(1);
  });

  it("refuses a call whose amount no longer matches the payment", async () => {
    const p = await propose("task-blog");
    await expect(executePayout.run({ ...execArgs(p), amountUsd: 39 } as never, human)).rejects.toThrow(/not \$39\.00/);
    expect(paypal).not.toHaveBeenCalled();
  });
});

describe("demo story end to end (PayPal mocked)", () => {
  it("ends at spent 158 / remaining 42 with four receipts", async () => {
    const tasks = await listCompletedTasks.run({ status: "completed" }, human);
    expect(tasks.tasks.map((t) => [t.id, t.amountUsd])).toEqual([
      ["task-logo", 18], ["task-blog", 40], ["task-video", 120], ["task-site", 400],
    ]);
    expect(await budget()).toEqual({ month: "2026-11", capUsd: 200, spentUsd: 0, remainingUsd: 200, autoApproveLimitUsd: 25 });

    const [logo, blog, video, site] = [await propose("task-logo"), await propose("task-blog"), await propose("task-video"), await propose("task-site")];
    expect((await executePayout.run(execArgs(logo) as never, agent)).receipt.policyResult).toBe("auto_paid");
    expect((await executePayout.run(execArgs(blog) as never, human)).receipt.policyResult).toBe("approved_and_paid");
    const edited = (await editPayment.run({ paymentId: video.id, amountUsd: 100 } as never, human)).payment;
    expect(edited.amountUsd).toBe(100);
    expect((await executePayout.run(execArgs(edited) as never, human)).receipt.policyResult).toBe("approved_and_paid");
    const blocked = await executePayout.run(execArgs(site) as never, agent);
    expect(blocked.receipt).toMatchObject({ policyResult: "blocked_over_budget", budgetRemainingAfterUsd: 42 });

    expect(await budget()).toMatchObject({ spentUsd: 158, remainingUsd: 42 });
    expect(paypal).toHaveBeenCalledTimes(3);
    const receipts = await listReceipts.run({}, human);
    expect(receipts.receipts).toHaveLength(4);
  });
});
