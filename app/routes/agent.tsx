import { buildLegacyAgentSettingsRoute } from "@agent-native/core/client/navigation";
import { Navigate, useLocation } from "react-router";
import { pageMeta } from "@/lib/app-config";

export function meta() {
  return pageMeta("Agent settings"); // i18n-ignore legacy meta fallback; the client title is localized
}

export default function AgentRoute() {
  const location = useLocation();
  return (
    <Navigate
      to={buildLegacyAgentSettingsRoute(location.hash, location.search)}
      replace
    />
  );
}
