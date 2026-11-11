import { z } from "zod";

import { POLICY_LIMITS, toUsd } from "./policy.js";
import type { ActivePolicy, BudgetRow, PaymentRow, ReceiptRow, TaskRow } from "./store.js";

export const taskOut = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  amountUsd: z.number(),
  payeeEmail: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

export const paymentOut = z.object({
  id: z.string(),
  taskId: z.string(),
  amountUsd: z.number(),
  payeeEmail: z.string(),
  memo: z.string(),
  status: z.string(),
  proposedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const receiptOut = z.object({
  id: z.string(),
  paymentId: z.string(),
  taskId: z.string(),
  amountUsd: z.number(),
  payeeEmail: z.string(),
  policyResult: z.string(),
  approver: z.string(),
  paypalBatchId: z.string().nullable(),
  paypalItemId: z.string().nullable(),
  budgetRemainingAfterUsd: z.number(),
  detail: z.string(),
  createdAt: z.string(),
});

export const budgetOut = z.object({
  month: z.string(),
  capUsd: z.number(),
  spentUsd: z.number(),
  remainingUsd: z.number(),
  autoApproveLimitUsd: z.number(),
});

const iso = (d: Date) => d.toISOString();

export const toTask = (r: TaskRow): z.infer<typeof taskOut> => ({
  id: r.id,
  title: r.title,
  description: r.description,
  amountUsd: toUsd(r.amountCents),
  payeeEmail: r.payeeEmail,
  status: r.status,
  createdAt: iso(r.createdAt),
});

export const toPayment = (r: PaymentRow): z.infer<typeof paymentOut> => ({
  id: r.id,
  taskId: r.taskId,
  amountUsd: toUsd(r.amountCents),
  payeeEmail: r.payeeEmail,
  memo: r.memo,
  status: r.status,
  proposedBy: r.proposedBy,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

export const toReceipt = (r: ReceiptRow): z.infer<typeof receiptOut> => ({
  id: r.id,
  paymentId: r.paymentId,
  taskId: r.taskId,
  amountUsd: toUsd(r.amountCents),
  payeeEmail: r.payeeEmail,
  policyResult: r.policyResult,
  approver: r.approver,
  paypalBatchId: r.paypalBatchId,
  paypalItemId: r.paypalItemId,
  budgetRemainingAfterUsd: toUsd(r.budgetRemainingAfterCents),
  detail: r.detail,
  createdAt: iso(r.createdAt),
});

export const toBudget = (r: BudgetRow): z.infer<typeof budgetOut> => ({
  month: r.month,
  capUsd: toUsd(r.capCents),
  spentUsd: toUsd(r.spentCents),
  remainingUsd: toUsd(Math.max(0, r.capCents - r.spentCents)),
  autoApproveLimitUsd: toUsd(r.autoApproveLimitCents),
});

export const policyOut = z.object({
  monthlyBudgetCapUsd: z.number(),
  autoApproveLimitUsd: z.number(),
  allowedPayees: z.array(z.string()),
  updatedAt: z.string().nullable(),
  updatedBy: z.string(),
  limits: z.object({ minCapUsd: z.number(), maxCapUsd: z.number(), maxPayees: z.number() }),
});

export const toPolicy = (p: ActivePolicy): z.infer<typeof policyOut> => ({
  monthlyBudgetCapUsd: toUsd(p.monthlyCapCents),
  autoApproveLimitUsd: toUsd(p.autoApproveLimitCents),
  allowedPayees: p.allowedPayees,
  updatedAt: p.updatedAt ? p.updatedAt.toISOString() : null,
  updatedBy: p.updatedBy,
  limits: { ...POLICY_LIMITS },
});
