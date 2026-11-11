import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getActivePolicy } from "../server/spend-desk/store.js";
import { policyOut, toPolicy } from "../server/spend-desk/types.js";

export default defineAction({
  description:
    "Get the live Spend Desk policy: monthly budget cap, auto-approve limit and allowed payees (USD). Only a human can change it, from the Spend Policy card in the UI.",
  schema: z.object({}),
  outputSchema: policyOut,
  http: { method: "GET" },
  readOnly: true,
  run: async () => toPolicy(await getActivePolicy()),
});
