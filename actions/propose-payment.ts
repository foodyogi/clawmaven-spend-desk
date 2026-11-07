import { randomUUID } from "node:crypto";

import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import { isValidUsdAmount, toCents } from "../server/spend-desk/policy.js";
import { getTask, insertPayment, transitionTask } from "../server/spend-desk/store.js";
import { paymentOut, toPayment } from "../server/spend-desk/types.js";

const errors = defineActionErrors("not_found", "task_not_ready", "invalid_amount");

export default defineAction({
  description:
    "Draft a PayPal payment for a completed task. Amount, payee and memo default to the task's values. Persists the payment as proposed; nothing is paid until executePayout.",
  schema: z.object({
    taskId: z.string().describe("Id of a completed task, e.g. task-logo"),
    amountUsd: z.number().optional().describe("Payout amount in USD (max 2 decimals); omit to use the task's amount"),
    payeeEmail: z.string().email().optional().describe("PayPal email of the payee; omit to use the task's payee"),
    memo: z.string().max(500).optional().describe("Note shown to the payee; omit for a default memo"),
  }),
  outputSchema: z.object({ id: z.string(), payment: paymentOut, message: z.string() }),
  errors,
  run: async (args, ctx) => {
    const task = await getTask(args.taskId);
    if (!task) return errors.noWrite(`Task ${args.taskId} not found.`, "not_found");
    if (args.amountUsd !== undefined && !isValidUsdAmount(args.amountUsd)) {
      return errors.noWrite("amountUsd must be positive with at most 2 decimals.", "invalid_amount");
    }
    if (!(await transitionTask(task.id, ["completed"], "payment_proposed"))) {
      return errors.noWrite(`Task ${task.id} is ${task.status}, not completed; it cannot get a new proposal.`, "task_not_ready");
    }
    const payment = await insertPayment({
      id: `pay-${task.id.replace(/^task-/, "")}-${randomUUID().slice(0, 6)}`,
      taskId: task.id,
      amountCents: args.amountUsd !== undefined ? toCents(args.amountUsd) : task.amountCents,
      payeeEmail: args.payeeEmail ?? task.payeeEmail,
      memo: args.memo ?? `Payment for ${task.title}`,
      status: "proposed",
      proposedBy: ctx?.caller === "tool" ? "agent" : "human",
    });
    return {
      id: payment.id,
      payment: toPayment(payment),
      message: `Proposed $${(payment.amountCents / 100).toFixed(2)} to ${payment.payeeEmail} for ${task.title}.`,
    };
  },
});
