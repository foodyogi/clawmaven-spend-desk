import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { ObservabilityDashboard } from "@agent-native/toolkit/app/observability";

import enUS from "@/i18n/en-US";
import { pageMeta } from "@/lib/app-config";

export function meta() {
  return pageMeta(enUS.pages.observabilityPageTitle);
}

export default function ObservabilityPage() {
  const t = useT();
  useSetPageTitle(t("pages.observabilityPageTitle"));
  return (
    <div className="p-6">
      <ObservabilityDashboard />
    </div>
  );
}
