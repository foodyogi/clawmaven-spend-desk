import { Navigate } from "react-router";

import { pageMeta } from "@/lib/app-config";

export function meta() {
  return pageMeta("Extensions");
}

export default function ExtensionsRoute() {
  return <Navigate to="/settings/extensions" replace />;
}
