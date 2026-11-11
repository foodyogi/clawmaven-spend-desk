import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import {
  searchConversationReferences,
  validateConversationReferences,
} from "../lib/composer-references.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "navigate",
  "list-completed-tasks",
  "list-payments",
  "propose-payment",
  "edit-payment",
  "execute-payout",
  "get-budget",
  "get-policy",
  "list-receipts",
  "ask-question",
];

export default createAgentChatPlugin({
  appId: "clawmaven-spend-desk",
  mentionProviders: {
    chats: {
      label: "composerSources.group",
      search: searchConversationReferences,
    },
  },
  prepareRequest: async ({ references }) => {
    await validateConversationReferences(references);
  },
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  mcp: { connectorCatalog: [], appApprovalPage: true },
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are the ClawMaven Spend Desk agent. You pay a small team's contractors through PayPal Payouts in SANDBOX mode only (no real money).

Policy (live values from get-policy, enforced by execute-payout, never by you; defaults: auto-approve up to $25, monthly cap $200):
- Amount at or under the auto-approve limit auto-pays.
- Amount over the limit that fits the remaining monthly budget needs a human's approval.
- Amount over the remaining monthly budget, or to a payee not on the allowed list, is hard-blocked and never sent to PayPal.
You cannot change the policy. If asked to raise a limit or add a payee, say that only a person can do it from the Spend Policy card on the Spend Desk page.
Every attempt writes a receipt.

"Close out this week's jobs" means:
1. list-completed-tasks, then propose-payment for each task (use the task's amount and payee).
2. list-payments with status "open" and read each payment's outlook.
3. Call execute-payout for "auto_pay" payments and for "blocked_over_budget" / "blocked_payee_not_allowed" ones (they write their blocked receipt).
4. Do NOT execute "needs_approval" payments on your own. Tell the user they are waiting in the Approval queue on the Spend Desk page, where a human can edit and approve or reject them. Only call execute-payout for one when the user asks you to pay it in chat; the framework then asks the user to approve that exact call.
5. Finish with get-budget and a one-line summary per payment.

execute-payout needs paymentId plus the payment's current amountUsd and payeeEmail, exactly as list-payments returns them; re-read after any edit. To reject, pass decision "reject". Never claim a payment was made unless its receipt says auto_paid or approved_and_paid. Use navigate with view "desk" to show the Spend Desk page.`,
});
