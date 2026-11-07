import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import { loadPolicy } from "../server/spend-desk/policy.js";
import { getBudgetRow } from "../server/spend-desk/store.js";
import { budgetOut, toBudget } from "../server/spend-desk/types.js";

const errors = defineActionErrors("budget_missing");

export default defineAction({
  description:
    "Get this month's Spend Desk budget: monthly cap, spent, remaining, and the auto-approve limit (all USD).",
  schema: z.object({}),
  outputSchema: budgetOut,
  errors,
  http: { method: "GET" },
  run: async () => {
    const month = loadPolicy().demoMonth;
    const row = await getBudgetRow(month);
    if (!row) return errors.fail(`No budget for ${month}. Run reset-demo to seed it.`, "budget_missing");
    return toBudget(row);
  },
});
