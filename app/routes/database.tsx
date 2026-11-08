import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { DbAdminPage } from "@agent-native/toolkit/app/db-admin";
import { pageMeta } from "@/lib/app-config";

export function meta() {
  return pageMeta("Database");
}

export default function DatabasePage() {
  const t = useT();
  useSetPageTitle(t("pages.databaseTitle"));
  return (
    <div className="h-full">
      <DbAdminPage />
    </div>
  );
}
