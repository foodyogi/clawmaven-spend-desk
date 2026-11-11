import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import { loadPolicy, toCents, validatePolicyInput } from "../server/spend-desk/policy.js";
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
  description: "Change the Spend Desk policy (monthly cap, auto-approve limit, allowed payees). Human-only, from the UI.",
  agentTool: false,
  uiOnly: true,
  schema: z.object({
    monthlyBudgetCapUsd: z.number().describe("Monthly budget cap in USD, $1 to $1,000"),
    autoApproveLimitUsd: z.number().describe("Payouts at or under this amount pay automatically; $0 to the cap"),
    allowedPayees: z.array(z.string()).describe("PayPal emails that may be paid; at most 10"),
  }),
  outputSchema: policyOut.extend({ message: z.string() }),
  errors,
  run: async (args, ctx) => {
    if (ctx?.caller !== "frontend") {
      return errors.noWrite("The spend policy can only be changed by a person in the Spend Desk UI.", "human_only", { statusCode: 403 });
    }
    const checked = validatePolicyInput(args);
    if (!checked.ok) return errors.noWrite(checked.errors.join(" "), "invalid_policy", { statusCode: 400 });
    const saved = await savePolicy(
      loadPolicy().demoMonth,
      {
        monthlyCapCents: toCents(checked.value.monthlyBudgetCapUsd),
        autoApproveLimitCents: toCents(checked.value.autoApproveLimitUsd),
        allowedPayees: checked.value.allowedPayees,
      },
      ctx.userEmail ?? "human (ui)",
    );
    if (!saved) return errors.noWrite("No active policy row. Press Reset demo to restore the defaults.", "policy_missing");
    const after = await getActivePolicy();
    return {
      ...toPolicy(after),
      message: `Policy saved: cap $${(after.monthlyCapCents / 100).toFixed(2)}, auto-approve up to $${(after.autoApproveLimitCents / 100).toFixed(2)}, ${after.allowedPayees.length} allowed payee(s).`,
    };
  },
});
