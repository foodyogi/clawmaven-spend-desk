import { randomUUID } from "node:crypto";

import { type ActionRunContext, defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import { sendPayout } from "../server/spend-desk/paypal.js";
import { isAllowedPayee, loadPolicy, needsHumanApproval, toCents } from "../server/spend-desk/policy.js";
import {
  type BudgetRow,
  getActivePolicy,
  getBudgetRow,
  getPayment,
  insertReceipt,
  OPEN_PAYMENT_STATUSES,
  type PaymentRow,
  releaseBudget,
  reserveBudget,
  transitionPayment,
  transitionTask,
} from "../server/spend-desk/store.js";
import { budgetOut, paymentOut, receiptOut, toBudget, toPayment, toReceipt } from "../server/spend-desk/types.js";

const errors = defineActionErrors("not_found", "not_executable", "amount_mismatch", "payee_mismatch", "budget_missing");

const schema = z.object({
  paymentId: z.string().describe("Id of a proposed payment"),
  amountUsd: z
    .number()
    .describe("The payment's current amount in USD, restated so an approval covers exactly this amount"),
  payeeEmail: z.string().describe("The payment's current payee email, restated so an approval covers exactly this payee"),
  decision: z
    .enum(["approve", "reject"])
    .default("approve")
    .describe('"approve" (default) runs the policy and pays; "reject" refuses the payment and writes a rejected receipt'),
});
type Args = z.infer<typeof schema>;

/** Matches the stored payment, so an approval can never cover a stale amount or payee. */
function matchesStored(args: Args, payment: PaymentRow): boolean {
  return toCents(args.amountUsd) === payment.amountCents && args.payeeEmail === payment.payeeEmail;
}

function humanLabel(ctx?: ActionRunContext): string {
  return ctx?.userEmail ?? `human (${ctx?.caller ?? "unknown"})`;
}

// Never negative: the cap can be lowered below what is already spent.
const remaining = (b: BudgetRow) => Math.max(0, b.capCents - b.spentCents);

export default defineAction({
  description:
    "Execute (or reject) a proposed PayPal sandbox payout under the live Spend Desk policy (see get-policy): at or under the auto-approve limit pays automatically, above it pauses for human approval, over the remaining monthly budget or to a payee not on the allowed list is blocked. Every outcome writes a receipt.",
  schema,
  outputSchema: z.object({
    id: z.string(),
    receipt: receiptOut,
    payment: paymentOut,
    budget: budgetOut,
    message: z.string(),
  }),
  errors,
  // Brief section 3.1. Calls run() would refuse (unknown, already settled,
  // mismatched, or rejected) need no pause: nothing can be paid. Over-budget and
  // auto-limit amounts need no pause either; run() re-checks both.
  needsApproval: async (args) => {
    const payment = await getPayment(args.paymentId);
    if (!payment || !OPEN_PAYMENT_STATUSES.includes(payment.status)) return false;
    if (args.decision === "reject" || !matchesStored(args, payment)) return false;
    const budget = await getBudgetRow(loadPolicy().demoMonth);
    if (!budget) return false;
    return needsHumanApproval({
      amountCents: payment.amountCents,
      remainingCents: remaining(budget),
      autoApproveLimitCents: budget.autoApproveLimitCents,
    });
  },
  run: async (args, ctx) => {
    const policy = loadPolicy();
    const month = policy.demoMonth;
    const payment = await getPayment(args.paymentId);
    if (!payment) return errors.noWrite(`Payment ${args.paymentId} not found.`, "not_found");
    if (!OPEN_PAYMENT_STATUSES.includes(payment.status)) {
      return errors.noWrite(`Payment ${payment.id} is already ${payment.status}.`, "not_executable");
    }
    if (toCents(args.amountUsd) !== payment.amountCents) {
      return errors.noWrite(
        `Payment ${payment.id} is $${(payment.amountCents / 100).toFixed(2)}, not $${args.amountUsd.toFixed(2)}. Re-read it and call again.`,
        "amount_mismatch",
      );
    }
    if (args.payeeEmail !== payment.payeeEmail) {
      return errors.noWrite(`Payment ${payment.id} pays ${payment.payeeEmail}, not ${args.payeeEmail}.`, "payee_mismatch");
    }
    const budgetNow = await getBudgetRow(month);
    if (!budgetNow) return errors.noWrite(`No budget for ${month}. Run reset-demo.`, "budget_missing");

    // Settles the payment and task, writes the receipt and returns the result.
    const current: PaymentRow = payment;
    async function settle(
      status: string,
      taskStatus: string,
      receipt: { policyResult: string; approver: string; detail: string; batchId?: string; itemId?: string | null },
      budget: BudgetRow,
    ) {
      const settled = (await transitionPayment(current.id, ["approved", ...OPEN_PAYMENT_STATUSES], { status })) ?? current;
      await transitionTask(current.taskId, ["payment_proposed"], taskStatus);
      const row = await insertReceipt({
        id: `rcpt-${randomUUID().slice(0, 8)}`,
        paymentId: current.id,
        taskId: current.taskId,
        amountCents: current.amountCents,
        payeeEmail: current.payeeEmail,
        policyResult: receipt.policyResult,
        approver: receipt.approver,
        paypalBatchId: receipt.batchId ?? null,
        paypalItemId: receipt.itemId ?? null,
        budgetRemainingAfterCents: remaining(budget),
        detail: receipt.detail,
      });
      return {
        id: row.id,
        receipt: toReceipt(row),
        payment: toPayment(settled),
        budget: toBudget(budget),
        message: `${receipt.policyResult}: ${receipt.detail}`,
      };
    }

    // Human rejected: no PayPal call; the task can be proposed again.
    if (args.decision === "reject") {
      return settle("rejected", "completed", { policyResult: "rejected", approver: humanLabel(ctx), detail: "Rejected by a human; nothing was sent to PayPal." }, budgetNow);
    }

    if (!isAllowedPayee(await getActivePolicy(), payment.payeeEmail)) {
      return settle("blocked", "blocked", { policyResult: "blocked_payee_not_allowed", approver: "system-block", detail: `${payment.payeeEmail} is not in policy allowedPayees; nothing was sent to PayPal.` }, budgetNow);
    }

    // Claim the payment so a second execute of the same payment cannot pay twice.
    const claimed = await transitionPayment(payment.id, OPEN_PAYMENT_STATUSES, { status: "approved" });
    if (!claimed) return errors.noWrite(`Payment ${payment.id} is already being executed.`, "not_executable");

    // Re-check the budget at execution time by reserving it atomically.
    const reserved = await reserveBudget(month, payment.amountCents);
    if (!reserved) {
      const latest = (await getBudgetRow(month)) ?? budgetNow;
      return settle("blocked", "blocked", {
        policyResult: "blocked_over_budget",
        approver: "system-block",
        detail: `$${(payment.amountCents / 100).toFixed(2)} exceeds the $${(remaining(latest) / 100).toFixed(2)} left in the ${month} budget; nothing was sent to PayPal.`,
      }, latest);
    }

    const auto = payment.amountCents <= reserved.autoApproveLimitCents;
    try {
      const result = await sendPayout({
        senderBatchId: payment.id,
        amountCents: payment.amountCents,
        receiver: payment.payeeEmail,
        note: payment.memo,
      });
      return settle("paid", "paid", {
        policyResult: auto ? "auto_paid" : "approved_and_paid",
        approver: auto ? "auto" : humanLabel(ctx),
        detail: `Sent $${(payment.amountCents / 100).toFixed(2)} to ${payment.payeeEmail} via PayPal sandbox (item status ${result.itemStatus}).`,
        batchId: result.batchId,
        itemId: result.itemId,
      }, reserved);
    } catch (err) {
      const released = (await releaseBudget(month, payment.amountCents)) ?? budgetNow;
      return settle("error", "completed", {
        policyResult: "paypal_error",
        approver: auto ? "auto" : humanLabel(ctx),
        detail: `PayPal error (payout not confirmed, budget released): ${err instanceof Error ? err.message : "unknown error"}`.slice(0, 1000),
      }, released);
    }
  },
});
