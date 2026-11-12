import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import { isTestnetAccountId, isValidUsdAmount, toCents } from "../server/spend-desk/policy.js";
import { getPayment, OPEN_PAYMENT_STATUSES, transitionPayment } from "../server/spend-desk/store.js";
import { paymentOut, toPayment } from "../server/spend-desk/types.js";

const errors = defineActionErrors("not_found", "not_editable", "invalid_amount", "invalid_payee", "nothing_to_change");

export default defineAction({
  description:
    "Change the amount, payee (PayPal email or NEAR testnet account) and/or memo of a payment that is still proposed or awaiting approval. Editing never pays.",
  schema: z.object({
    paymentId: z.string().describe("Id of the payment to edit"),
    amountUsd: z.number().optional().describe("New amount in USD (max 2 decimals)"),
    payeeEmail: z.string().email().optional().describe("New payee PayPal email"),
    payeeNearAccount: z.string().optional().describe("New payee NEAR testnet account (NEAR rail)"),
    memo: z.string().max(500).optional().describe("New memo"),
  }),
  outputSchema: z.object({ id: z.string(), payment: paymentOut, message: z.string() }),
  errors,
  run: async (args) => {
    if (args.amountUsd === undefined && args.payeeEmail === undefined && args.payeeNearAccount === undefined && args.memo === undefined) {
      return errors.noWrite("Pass at least one of amountUsd, payeeEmail, payeeNearAccount or memo.", "nothing_to_change");
    }
    if (args.payeeNearAccount !== undefined && !isTestnetAccountId(args.payeeNearAccount.trim().toLowerCase())) {
      return errors.noWrite("payeeNearAccount must be a NEAR testnet account id (ending in .testnet).", "invalid_payee");
    }
    if (args.amountUsd !== undefined && !isValidUsdAmount(args.amountUsd)) {
      return errors.noWrite("amountUsd must be positive with at most 2 decimals.", "invalid_amount");
    }
    const current = await getPayment(args.paymentId);
    if (!current) return errors.noWrite(`Payment ${args.paymentId} not found.`, "not_found");
    const updated = await transitionPayment(current.id, OPEN_PAYMENT_STATUSES, {
      ...(args.amountUsd !== undefined ? { amountCents: toCents(args.amountUsd) } : {}),
      ...(args.payeeEmail !== undefined ? { payeeEmail: args.payeeEmail } : {}),
      ...(args.payeeNearAccount !== undefined ? { payeeNearAccount: args.payeeNearAccount.trim().toLowerCase() } : {}),
      ...(args.memo !== undefined ? { memo: args.memo } : {}),
    });
    if (!updated) return errors.noWrite(`Payment ${current.id} is ${current.status} and can no longer be edited.`, "not_editable");
    return {
      id: updated.id,
      payment: toPayment(updated),
      message: `Payment ${updated.id} is now $${(updated.amountCents / 100).toFixed(2)} to ${updated.payeeEmail}.`,
    };
  },
});
