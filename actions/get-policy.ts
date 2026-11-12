import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { nearContractId } from "../server/spend-desk/near.js";
import { getActivePolicy } from "../server/spend-desk/store.js";
import { policyOut, toPolicy } from "../server/spend-desk/types.js";

export default defineAction({
  description:
    "Get the live Spend Desk policy: monthly budget cap and auto-approve limit (USD), allowed PayPal payees, the payout rail (paypal or near), allowed NEAR testnet payees and the demo-only USD-to-NEAR rate. Only a human can change it, from the Spend Policy card in the UI.",
  schema: z.object({}),
  outputSchema: policyOut,
  http: { method: "GET" },
  readOnly: true,
  run: async () => toPolicy(await getActivePolicy(), nearContractId()),
});
