import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listReceiptRows } from "../server/spend-desk/store.js";
import { receiptOut, toReceipt } from "../server/spend-desk/types.js";

export default defineAction({
  description:
    "List payout receipts, newest first: policy result, approver, PayPal batch/item ids and budget left. Optionally filter by paymentId.",
  schema: z.object({
    paymentId: z.string().optional().describe("Only receipts for this payment id; omit for all receipts"),
  }),
  outputSchema: z.object({ receipts: z.array(receiptOut) }),
  http: { method: "GET" },
  run: async ({ paymentId }) => {
    const rows = await listReceiptRows(paymentId);
    return { receipts: rows.map(toReceipt) };
  },
});
