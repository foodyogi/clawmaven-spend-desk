import { type DbExec, sql } from "@agent-native/core/db";

import { loadPolicy, toCents, toMicroNearPerUsd } from "./policy.js";

const P1 = "sb-ymuio53707515@personal.example.com";
const P2 = "sb-zyjmt53707494@personal.example.com";
const P3 = "sb-houoq53707143@personal.example.com";
const N1 = "m22spend-payee1.testnet";
const N2 = "m22spend-payee2.testnet";
const N3 = "m22spend-payee3.testnet";

/** The four completed jobs from the demo story (brief section 4). */
export const SEED_TASKS = [
  { id: "task-logo", title: "Logo tweak", description: "Refresh the logo colors for dark mode.", amountUsd: 18, payeeEmail: P1, payeeNearAccount: N1 },
  { id: "task-blog", title: "Blog edit", description: "Copy-edit the November launch post.", amountUsd: 40, payeeEmail: P2, payeeNearAccount: N2 },
  { id: "task-video", title: "Video edit", description: "Cut the 90-second product demo video.", amountUsd: 120, payeeEmail: P3, payeeNearAccount: N3 },
  { id: "task-site", title: "Site rebuild", description: "Rebuild the marketing site.", amountUsd: 400, payeeEmail: P1, payeeNearAccount: N1 },
] as const;

/** Inserts the seed tasks and the demo month's budget. Safe to run repeatedly. */
export async function seedDemo(exec: DbExec): Promise<void> {
  const policy = loadPolicy();
  for (const t of SEED_TASKS) {
    await exec.execute(sql`INSERT INTO spend_tasks (id, title, description, amount_cents, payee_email, payee_near_account, status)
      VALUES (${sql.value(t.id)}, ${sql.value(t.title)}, ${sql.value(t.description)}, ${sql.value(toCents(t.amountUsd))}, ${sql.value(t.payeeEmail)}, ${sql.value(t.payeeNearAccount)}, 'completed')
      ON CONFLICT (id) DO NOTHING`);
  }
  await exec.execute(sql`INSERT INTO spend_budget (month, cap_cents, spent_cents, auto_approve_limit_cents)
    VALUES (${sql.value(policy.demoMonth)}, ${sql.value(toCents(policy.monthlyBudgetCapUsd))}, 0, ${sql.value(toCents(policy.autoApproveLimitUsd))})
    ON CONFLICT (month) DO NOTHING`);
}

/** Inserts the default spend policy from policy.json. Safe to run repeatedly. */
export async function seedPolicy(exec: DbExec): Promise<void> {
  const policy = loadPolicy();
  await exec.execute(sql`INSERT INTO spend_policy (id, monthly_cap_cents, auto_approve_limit_cents, allowed_payees, payout_rail, allowed_near_payees, near_micro_per_usd, updated_by)
    VALUES ('active', ${sql.value(toCents(policy.monthlyBudgetCapUsd))}, ${sql.value(toCents(policy.autoApproveLimitUsd))}, ${sql.value(JSON.stringify(policy.allowedPayees))}::jsonb,
      ${sql.value(policy.payoutRail)}, ${sql.value(JSON.stringify(policy.allowedNearPayees))}::jsonb, ${sql.value(toMicroNearPerUsd(policy.demoUsdToNear))}, 'policy.json')
    ON CONFLICT (id) DO NOTHING`);
}

/** Gives seed tasks created before the NEAR rail their NEAR testnet payee. */
export async function fillSeedNearPayees(exec: DbExec): Promise<void> {
  for (const t of SEED_TASKS) {
    await exec.execute(sql`UPDATE spend_tasks SET payee_near_account = ${sql.value(t.payeeNearAccount)}
      WHERE id = ${sql.value(t.id)} AND payee_near_account IS NULL`);
  }
}

/** Clears payments, receipts and spend, restores the seed tasks and the default policy. */
export async function resetDemo(exec: DbExec): Promise<void> {
  const policy = loadPolicy();
  await exec.execute(sql`DELETE FROM spend_policy WHERE id = 'active'`);
  await seedPolicy(exec);
  await exec.execute(sql`DELETE FROM spend_receipts`);
  await exec.execute(sql`DELETE FROM spend_payments`);
  await exec.execute(sql`DELETE FROM spend_tasks WHERE id IN ${sql.in(SEED_TASKS.map((t) => t.id))}`);
  await exec.execute(sql`DELETE FROM spend_budget WHERE month = ${sql.value(policy.demoMonth)}`);
  await seedDemo(exec);
}
