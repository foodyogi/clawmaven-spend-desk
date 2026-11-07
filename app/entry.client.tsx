import { configureClientRouterBasename } from "@agent-native/core/client/api-path";
import { installRouteChunkRecovery } from "@agent-native/core/client/route-chunk-recovery";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { installChatModelGuard } from "./lib/chat-model-guard.client";

installRouteChunkRecovery();

configureClientRouterBasename();

installChatModelGuard();

hydrateRoot(document, <HydratedRouter />);
