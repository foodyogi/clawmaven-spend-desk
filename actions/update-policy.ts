import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import { nearContractId } from "../server/spend-desk/near.js";
import { loadPolicy, toCents, toMicroNearPerUsd, validatePolicyInput } from "../server/spend-desk/policy.js";
import { getActivePolicy, savePolicy } from "../server/spend-desk/store.js";
import { policyOut, toPolicy } from "../server/spend-desk/types.js";

const errors = defineActionErrors("human_only", "invalid_policy", "policy_missing");

/**
 * Human-only governance control. Hidden from the agent and from MCP
 * (agentTool: false), accepted only as a proven request from the app UI
 * (uiOnly), and run() refuses any caller that is not the frontend, so an agent
 * can never raise its own spending limits.
 */
export default defineAction({
  description:
    "Change the Spend Desk policy (monthly cap, auto-approve limit, allowed payees, payout rail, allowed NEAR payees, demo USD-to-NEAR rate). Human-only, from the UI.",
  agentTool: false,
  uiOnly: true,
  schema: z.object({
    monthlyBudgetCapUsd: z.number().describe("Monthly budget cap in USD, $1 to $1,000"),
    autoApproveLimitUsd: z.number().describe("Payouts at or under this amount pay automatically; $0 to the cap"),
    allowedPayees: z.array(z.string()).describe("PayPal emails that may be paid; at most 10"),
    payoutRail: z.enum(["paypal", "near"]).optional().describe('"paypal" or "near"; omit to keep the current rail'),
    allowedNearPayees: z.array(z.string()).optional().describe("NEAR testnet account ids that may be paid; at most 10; omit to keep"),
    demoUsdToNear: z.number().optional().describe("DEMO-ONLY testnet NEAR per $1, 0.0001 to 0.01; omit to keep"),
  }),
  outputSchema: policyOut.extend({ message: z.string() }),
  errors,
  run: async (args, ctx) => {
    if (ctx?.caller !== "frontend") {
      return errors.noWrite("The spend policy can only be changed by a person in the Spend Desk UI.", "human_only", { statusCode: 403 });
    }
    const current = await getActivePolicy();
    const checked = validatePolicyInput({
      monthlyBudgetCapUsd: args.monthlyBudgetCapUsd,
      autoApproveLimitUsd: args.autoApproveLimitUsd,
      allowedPayees: args.allowedPayees,
      payoutRail: args.payoutRail ?? current.payoutRail,
      allowedNearPayees: args.allowedNearPayees ?? current.allowedNearPayees,
      demoUsdToNear: args.demoUsdToNear ?? current.nearMicroPerUsd / 1_000_000,
    });
    if (!checked.ok) return errors.noWrite(checked.errors.join(" "), "invalid_policy", { statusCode: 400 });
    const saved = await savePolicy(
      loadPolicy().demoMonth,
      {
        monthlyCapCents: toCents(checked.value.monthlyBudgetCapUsd),
        autoApproveLimitCents: toCents(checked.value.autoApproveLimitUsd),
        allowedPayees: checked.value.allowedPayees,
        payoutRail: checked.value.payoutRail,
        allowedNearPayees: checked.value.allowedNearPayees,
        nearMicroPerUsd: toMicroNearPerUsd(checked.value.demoUsdToNear),
      },
      ctx.userEmail ?? "human (ui)",
    );
    if (!saved) return errors.noWrite("No active policy row. Press Reset demo to restore the defaults.", "policy_missing");
    const after = await getActivePolicy();
    return {
      ...toPolicy(after, nearContractId()),
      message: `Policy saved: ${after.payoutRail === "near" ? "NEAR testnet" : "PayPal sandbox"} rail, cap $${(after.monthlyCapCents / 100).toFixed(2)}, auto-approve up to $${(after.autoApproveLimitCents / 100).toFixed(2)}.`,
    };
  },
});
