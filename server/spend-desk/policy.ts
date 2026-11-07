import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

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
  const file = process.env.POLICY_PATH || path.join(process.cwd(), "policy.json");
  cached = policySchema.parse(JSON.parse(readFileSync(file, "utf8")));
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

export function isAllowedPayee(policy: Policy, email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return policy.allowedPayees.some((p) => p.toLowerCase() === normalized);
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
