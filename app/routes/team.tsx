import { Navigate } from "react-router";

import { pageMeta } from "@/lib/app-config";

export function meta() {
  return pageMeta("Team");
}

export default function TeamRoute() {
  return <Navigate to="/settings/organization" replace />;
}
