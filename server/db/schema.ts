import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Spend Desk keeps one shared demo ledger, so these tables have no owner
// column (see doctor.dbToolScopingDenylist in agent-native.json). Money is
// stored as integer cents; actions expose USD numbers.

export const spendTasks = pgTable("spend_tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  payeeEmail: text("payee_email").notNull(),
  /** NEAR testnet payee for the NEAR rail (null on rows created before it). */
  payeeNearAccount: text("payee_near_account"),
  // completed | payment_proposed | paid | blocked
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const spendPayments = pgTable("spend_payments", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  payeeEmail: text("payee_email").notNull(),
  memo: text("memo").notNull(),
  payeeNearAccount: text("payee_near_account"),
  nearTxHash: text("near_tx_hash"),
  // proposed | awaiting_approval | approved | rejected | paid | blocked | error
  status: text("status").notNull(),
  proposedBy: text("proposed_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const spendReceipts = pgTable("spend_receipts", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id").notNull(),
  taskId: text("task_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  payeeEmail: text("payee_email").notNull(),
  policyResult: text("policy_result").notNull(),
  approver: text("approver").notNull(),
  paypalBatchId: text("paypal_batch_id"),
  paypalItemId: text("paypal_item_id"),
  payeeNearAccount: text("payee_near_account"),
  nearTxHash: text("near_tx_hash"),
  budgetRemainingAfterCents: integer("budget_remaining_after_cents").notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const spendBudget = pgTable("spend_budget", {
  month: text("month").primaryKey(),
  capCents: integer("cap_cents").notNull(),
  spentCents: integer("spent_cents").notNull(),
  autoApproveLimitCents: integer("auto_approve_limit_cents").notNull(),
});

// The active spend policy: one row (id "active"), seeded from policy.json.
// update-policy writes it together with the month's budget row.
export const spendPolicy = pgTable("spend_policy", {
  id: text("id").primaryKey(),
  monthlyCapCents: integer("monthly_cap_cents").notNull(),
  autoApproveLimitCents: integer("auto_approve_limit_cents").notNull(),
  allowedPayees: jsonb("allowed_payees").$type<string[]>().notNull(),
  // "paypal" | "near"
  payoutRail: text("payout_rail").notNull().default("paypal"),
  /** Null means the policy.json default. */
  allowedNearPayees: jsonb("allowed_near_payees").$type<string[]>(),
  /** DEMO-ONLY rate: micro-NEAR per USD. Null means the policy.json default. */
  nearMicroPerUsd: integer("near_micro_per_usd"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").notNull(),
});
