import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { isAllowedPayee, loadPolicy, paymentOutlook } from "../server/spend-desk/policy.js";
import { getActivePolicy, getBudgetRow, listPaymentRows, OPEN_PAYMENT_STATUSES } from "../server/spend-desk/store.js";
import { paymentOut, toPayment } from "../server/spend-desk/types.js";

export default defineAction({
  description:
    'List payments with their task title, status, PayPal payee and NEAR payee, plus the live payout rail ("paypal" or "near"). Open payments (proposed / awaiting_approval) also carry outlook: what executePayout would do now on that rail — "auto_pay", "needs_approval", "blocked_over_budget" or "blocked_payee_not_allowed".',
  schema: z.object({
    status: z
      .enum(["open", "all"])
      .default("all")
      .describe('"all" (default) = every payment; "open" = only proposed / awaiting_approval payments'),
  }),
  outputSchema: z.object({
    rail: z.enum(["paypal", "near"]),
    payments: z.array(
      paymentOut.extend({
        taskTitle: z.string().nullable(),
        outlook: z.enum(["auto_pay", "needs_approval", "blocked_over_budget", "blocked_payee_not_allowed"]).nullable(),
      }),
    ),
  }),
  http: { method: "GET" },
  run: async ({ status }) => {
    const policy = loadPolicy();
    const [rows, budget, active] = await Promise.all([listPaymentRows(), getBudgetRow(policy.demoMonth), getActivePolicy()]);
    const remainingCents = budget ? Math.max(0, budget.capCents - budget.spentCents) : 0;
    const payments = rows
      .filter((r) => status === "all" || OPEN_PAYMENT_STATUSES.includes(r.status))
      .map((r) => ({
        ...toPayment(r),
        taskTitle: r.taskTitle,
        outlook:
          OPEN_PAYMENT_STATUSES.includes(r.status) && budget
            ? paymentOutlook({
                amountCents: r.amountCents,
                remainingCents,
                autoApproveLimitCents: budget.autoApproveLimitCents,
                payeeAllowed:
                  active.payoutRail === "near"
                    ? active.allowedNearPayees.some((p) => p.toLowerCase() === r.payeeNearAccount?.toLowerCase())
                    : isAllowedPayee(active, r.payeeEmail),
              })
            : null,
      }));
    return { rail: active.payoutRail, payments };
  },
});
