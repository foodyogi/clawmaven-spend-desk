import { ExtensionViewerPage } from "@agent-native/toolkit/app/extensions";

import { pageMeta } from "@/lib/app-config";

export function meta() {
  return pageMeta("Extension");
}

export default function ExtensionViewerRoute() {
  return <ExtensionViewerPage />;
}
