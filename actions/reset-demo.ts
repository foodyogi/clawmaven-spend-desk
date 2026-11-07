import { defineAction } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { z } from "zod";

import { loadPolicy } from "../server/spend-desk/policy.js";
import { resetDemo } from "../server/spend-desk/seed.js";
import { getBudgetRow, listTasks } from "../server/spend-desk/store.js";
import { budgetOut, taskOut, toBudget, toTask } from "../server/spend-desk/types.js";

export default defineAction({
  description:
    "Reset the Spend Desk demo: delete all payments and receipts, set spent to 0 and restore the four seed tasks.",
  // UI button and CLI only: the agent must never wipe the ledger on its own.
  agentTool: false,
  schema: z.object({}),
  outputSchema: z.object({ budget: budgetOut, tasks: z.array(taskOut), message: z.string() }),
  run: async () => {
    await resetDemo(getDbExec());
    const budget = await getBudgetRow(loadPolicy().demoMonth);
    const tasks = await listTasks();
    return { budget: toBudget(budget!), tasks: tasks.map(toTask), message: "Demo reset: 4 tasks, $0 spent." };
  },
});
