import { readFileSync } from "node:fs";

import { z } from "zod";

// Imported so the bundler ships it inside serverless functions (Netlify has no
// repo files at runtime). POLICY_PATH can still point at another file.
import defaultPolicy from "../../policy.json";

const policySchema = z.object({
  monthlyBudgetCapUsd: z.number().positive(),
  autoApproveLimitUsd: z.number().nonnegative(),
  currency: z.literal("USD"),
  allowedPayees: z.array(z.string().email()).min(1),
  demoMonth: z.string().regex(/^\d{4}-\d{2}$/),
  notes: z.string().optional(),
});

export type Policy = z.infer<typeof policySchema>;

let cached: Policy | undefined;

/** The demo policy from policy.json (or POLICY_PATH), read once per process. */
export function loadPolicy(): Policy {
  if (cached) return cached;
  // guard:allow-env-credential — POLICY_PATH is a deploy-level config file path, not a credential
  const file = process.env.POLICY_PATH;
  cached = policySchema.parse(file ? JSON.parse(readFileSync(file, "utf8")) : defaultPolicy);
  return cached;
}

export function toCents(usd: number): number {
  return Math.round(usd * 100);
}

export function toUsd(cents: number): number {
  return cents / 100;
}

/** True when a USD amount is positive and has at most two decimal places. */
export function isValidUsdAmount(usd: number): boolean {
  return usd > 0 && Math.abs(usd * 100 - Math.round(usd * 100)) < 1e-6;
}

export function isAllowedPayee(policy: Pick<Policy, "allowedPayees">, email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return policy.allowedPayees.some((p) => p.toLowerCase() === normalized);
}

/** Bounds update-policy enforces (USD). */
export const POLICY_LIMITS = { minCapUsd: 1, maxCapUsd: 1000, maxPayees: 10 } as const;

export interface PolicyInput {
  monthlyBudgetCapUsd: number;
  autoApproveLimitUsd: number;
  allowedPayees: string[];
}

const EMAIL = z.string().email();

/**
 * Checks a proposed policy and returns it normalized (payees trimmed,
 * lowercased, de-duplicated), or a list of human-readable problems.
 */
export function validatePolicyInput(input: PolicyInput): { ok: true; value: PolicyInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const { minCapUsd, maxCapUsd, maxPayees } = POLICY_LIMITS;
  const cap = input.monthlyBudgetCapUsd;
  const auto = input.autoApproveLimitUsd;
  if (!Number.isFinite(cap) || cap < minCapUsd || cap > maxCapUsd || !isWholeCents(cap)) {
    errors.push(`Monthly cap must be between $${minCapUsd} and $${maxCapUsd.toLocaleString("en-US")} (up to 2 decimals).`);
  }
  if (!Number.isFinite(auto) || auto < 0 || !isWholeCents(auto)) {
    errors.push("Auto-approve limit must be $0 or more (up to 2 decimals).");
  } else if (Number.isFinite(cap) && auto > cap) {
    errors.push("Auto-approve limit cannot be higher than the monthly cap.");
  }
  const payees = [...new Set(input.allowedPayees.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  const bad = payees.filter((p) => !EMAIL.safeParse(p).success);
  if (bad.length) errors.push(`Not a valid email: ${bad.join(", ")}.`);
  if (payees.length > maxPayees) errors.push(`At most ${maxPayees} allowed payees.`);
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { monthlyBudgetCapUsd: cap, autoApproveLimitUsd: auto, allowedPayees: payees } };
}

function isWholeCents(usd: number): boolean {
  return Math.abs(usd * 100 - Math.round(usd * 100)) < 1e-6;
}

/**
 * The executePayout approval rule from the brief (section 3.1):
 * - over the remaining monthly budget → no pause (run() hard-refuses it)
 * - at or under the auto-approve limit → no pause (run() pays it)
 * - otherwise → pause for a human to approve this specific call
 */
export function needsHumanApproval(input: {
  amountCents: number;
  remainingCents: number;
  autoApproveLimitCents: number;
}): boolean {
  if (input.amountCents > input.remainingCents) return false;
  if (input.amountCents <= input.autoApproveLimitCents) return false;
  return true;
}

export type PaymentOutlook = "auto_pay" | "needs_approval" | "blocked_over_budget" | "blocked_payee_not_allowed";

/** What executePayout would do with an open payment right now (same rules as run()). */
export function paymentOutlook(input: {
  amountCents: number;
  remainingCents: number;
  autoApproveLimitCents: number;
  payeeAllowed: boolean;
}): PaymentOutlook {
  if (!input.payeeAllowed) return "blocked_payee_not_allowed";
  if (input.amountCents > input.remainingCents) return "blocked_over_budget";
  return needsHumanApproval(input) ? "needs_approval" : "auto_pay";
}
