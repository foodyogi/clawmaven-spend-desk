import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listTasks } from "../server/spend-desk/store.js";
import { taskOut, toTask } from "../server/spend-desk/types.js";

export default defineAction({
  description:
    'List contractor tasks marked done. status "completed" (default) returns tasks ready for a payment proposal; "all" also returns proposed, paid and blocked tasks.',
  schema: z.object({
    status: z
      .enum(["completed", "all"])
      .default("completed")
      .describe('"completed" = ready to pay (default); "all" = every task with its status'),
  }),
  outputSchema: z.object({ tasks: z.array(taskOut) }),
  http: { method: "GET" },
  run: async ({ status }) => {
    const rows = await listTasks(status === "all" ? undefined : ["completed"]);
    return { tasks: rows.map(toTask) };
  },
});
