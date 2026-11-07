import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

const { spendBudget, spendPayments, spendReceipts, spendTasks } = schema;

export type TaskRow = typeof spendTasks.$inferSelect;
export type PaymentRow = typeof spendPayments.$inferSelect;
export type ReceiptRow = typeof spendReceipts.$inferSelect;
export type BudgetRow = typeof spendBudget.$inferSelect;
export type ReceiptInsert = typeof spendReceipts.$inferInsert;

/** Payment statuses a human may still edit or execute. */
export const OPEN_PAYMENT_STATUSES = ["proposed", "awaiting_approval"];

export async function getBudgetRow(month: string): Promise<BudgetRow | undefined> {
  const [row] = await getDb().select().from(spendBudget).where(eq(spendBudget.month, month));
  return row;
}

/** Atomically adds `cents` to spent only if it still fits under the cap. */
export async function reserveBudget(month: string, cents: number): Promise<BudgetRow | undefined> {
  const [row] = await getDb()
    .update(spendBudget)
    .set({ spentCents: sql`${spendBudget.spentCents} + ${cents}` })
    .where(and(eq(spendBudget.month, month), sql`${spendBudget.capCents} - ${spendBudget.spentCents} >= ${cents}`))
    .returning();
  return row;
}

export async function releaseBudget(month: string, cents: number): Promise<BudgetRow | undefined> {
  const [row] = await getDb()
    .update(spendBudget)
    .set({ spentCents: sql`greatest(${spendBudget.spentCents} - ${cents}, 0)` })
    .where(eq(spendBudget.month, month))
    .returning();
  return row;
}

export async function listTasks(statuses?: string[]): Promise<TaskRow[]> {
  const db = getDb();
  const query = db.select().from(spendTasks);
  const rows = statuses?.length ? await query.where(inArray(spendTasks.status, statuses)) : await query;
  return rows.sort((a, b) => a.amountCents - b.amountCents);
}

export async function getTask(id: string): Promise<TaskRow | undefined> {
  const [row] = await getDb().select().from(spendTasks).where(eq(spendTasks.id, id));
  return row;
}

/** Compare-and-set on task status; undefined means a lost race or illegal transition. */
export async function transitionTask(id: string, from: string[], to: string): Promise<TaskRow | undefined> {
  const [row] = await getDb()
    .update(spendTasks)
    .set({ status: to })
    .where(and(eq(spendTasks.id, id), inArray(spendTasks.status, from)))
    .returning();
  return row;
}

export async function getPayment(id: string): Promise<PaymentRow | undefined> {
  const [row] = await getDb().select().from(spendPayments).where(eq(spendPayments.id, id));
  return row;
}

export async function insertPayment(values: typeof spendPayments.$inferInsert): Promise<PaymentRow> {
  const [row] = await getDb().insert(spendPayments).values(values).returning();
  if (!row) throw new Error("insert into spendPayments returned no row");
  return row;
}

/** Compare-and-set on payment status, optionally changing other fields too. */
export async function transitionPayment(
  id: string,
  from: string[],
  patch: Partial<Pick<PaymentRow, "status" | "amountCents" | "payeeEmail" | "memo">>,
): Promise<PaymentRow | undefined> {
  const [row] = await getDb()
    .update(spendPayments)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(spendPayments.id, id), inArray(spendPayments.status, from)))
    .returning();
  return row;
}

export async function insertReceipt(values: ReceiptInsert): Promise<ReceiptRow> {
  const [row] = await getDb().insert(spendReceipts).values(values).returning();
  if (!row) throw new Error("insert into spendReceipts returned no row");
  return row;
}

export async function listReceiptRows(paymentId?: string): Promise<ReceiptRow[]> {
  const db = getDb();
  const query = db.select().from(spendReceipts);
  const filtered = paymentId ? query.where(eq(spendReceipts.paymentId, paymentId)) : query;
  return filtered.orderBy(desc(spendReceipts.createdAt), desc(spendReceipts.id));
}
