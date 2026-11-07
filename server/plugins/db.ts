import { runMigrations } from "@agent-native/core/db";

import { SPEND_DESK_MIGRATIONS } from "../db/migrations.js";

export default runMigrations(SPEND_DESK_MIGRATIONS, { table: "spend_desk_migrations" });
