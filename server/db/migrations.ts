import type { MigrationEntry } from "@agent-native/core/db";

import { fillSeedNearPayees, seedDemo, seedPolicy } from "../spend-desk/seed.js";

export const SPEND_DESK_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "spend-desk-tables",
    sql: `CREATE TABLE IF NOT EXISTS spend_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payee_email TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS spend_payments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payee_email TEXT NOT NULL,
  memo TEXT NOT NULL,
  status TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS spend_payments_task_id_idx ON spend_payments (task_id);
CREATE TABLE IF NOT EXISTS spend_receipts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payee_email TEXT NOT NULL,
  policy_result TEXT NOT NULL,
  approver TEXT NOT NULL,
  paypal_batch_id TEXT,
  paypal_item_id TEXT,
  budget_remaining_after_cents INTEGER NOT NULL,
  detail TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS spend_receipts_payment_created_idx ON spend_receipts (payment_id, created_at);
CREATE TABLE IF NOT EXISTS spend_budget (
  month TEXT PRIMARY KEY,
  cap_cents INTEGER NOT NULL,
  spent_cents INTEGER NOT NULL,
  auto_approve_limit_cents INTEGER NOT NULL
);`,
  },
  {
    version: 2,
    name: "spend-desk-seed",
    sql: {},
    run: async (exec) => {
      await seedDemo(exec);
    },
  },
  {
    version: 3,
    name: "spend-policy-table",
    sql: `CREATE TABLE IF NOT EXISTS spend_policy (
  id TEXT PRIMARY KEY,
  monthly_cap_cents INTEGER NOT NULL,
  auto_approve_limit_cents INTEGER NOT NULL,
  allowed_payees JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL
);`,
  },
  {
    version: 4,
    name: "spend-policy-seed",
    sql: {},
    run: async (exec) => {
      await seedPolicy(exec);
    },
  },
  {
    // Additive only: the PayPal app on main ignores these columns.
    version: 5,
    name: "near-rail-columns",
    sql: `ALTER TABLE spend_policy ADD COLUMN IF NOT EXISTS payout_rail TEXT NOT NULL DEFAULT 'paypal';
ALTER TABLE spend_policy ADD COLUMN IF NOT EXISTS allowed_near_payees JSONB;
ALTER TABLE spend_policy ADD COLUMN IF NOT EXISTS near_micro_per_usd INTEGER;
ALTER TABLE spend_tasks ADD COLUMN IF NOT EXISTS payee_near_account TEXT;
ALTER TABLE spend_payments ADD COLUMN IF NOT EXISTS payee_near_account TEXT;
ALTER TABLE spend_payments ADD COLUMN IF NOT EXISTS near_tx_hash TEXT;
ALTER TABLE spend_receipts ADD COLUMN IF NOT EXISTS payee_near_account TEXT;
ALTER TABLE spend_receipts ADD COLUMN IF NOT EXISTS near_tx_hash TEXT;`,
  },
  {
    version: 6,
    name: "near-rail-seed-payees",
    sql: {},
    run: async (exec) => {
      await fillSeedNearPayees(exec);
    },
  },
];
