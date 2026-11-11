import { createGetDb } from "@agent-native/core/db";
import { registerIdentityColumns } from "@agent-native/core/org";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

const PAYEE_REASON = "Contractor payout address from policy.json, not a member identity.";
registerIdentityColumns([
  { table: "spend_tasks", column: "payee_email", emailChange: "retain", offboard: "retain", reason: PAYEE_REASON },
  { table: "spend_payments", column: "payee_email", emailChange: "retain", offboard: "retain", reason: PAYEE_REASON },
  { table: "spend_receipts", column: "payee_email", emailChange: "retain", offboard: "retain", reason: PAYEE_REASON },
  { table: "spend_policy", column: "updated_by", emailChange: "retain", offboard: "retain", reason: "Audit trail of who last changed the spend policy." },
]);
