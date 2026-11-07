import { CHAT_MODEL_SELECTION_CHANGED_EVENT, loadChatModelCatalog } from "@agent-native/core/client/use-chat-models";

import {
  type ActiveModelCatalog,
  CHAT_MODEL_SELECTION_KEY,
  repairStoredSelection,
  sanitizeChatRequest,
  type StoredModelSelection,
  toActiveModelCatalog,
} from "./chat-model-guard";

let installed = false;
let catalog: ActiveModelCatalog | null = null;
let loading: Promise<void> | null = null;

function readStored(): StoredModelSelection | null {
  try {
    const raw = window.localStorage.getItem(CHAT_MODEL_SELECTION_KEY);
    return raw ? (JSON.parse(raw) as StoredModelSelection) : null;
  } catch {
    return null;
  }
}

function repairStorage(): void {
  const next = repairStoredSelection(readStored(), catalog);
  if (!next) return;
  try {
    window.localStorage.setItem(CHAT_MODEL_SELECTION_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(CHAT_MODEL_SELECTION_CHANGED_EVENT, { detail: { key: CHAT_MODEL_SELECTION_KEY } }));
  } catch {
    // Storage unavailable (private mode quota, disabled): the request guard still applies.
  }
}

function ensureCatalog(): void {
  if (catalog || loading) return;
  loading = loadChatModelCatalog()
    .then((result) => {
      catalog = toActiveModelCatalog(result);
      if (catalog) repairStorage();
    })
    .catch(() => {})
    .finally(() => {
      loading = null;
    });
}

function isAgentChatPost(input: RequestInfo | URL, init?: RequestInit): boolean {
  if ((init?.method ?? "GET").toUpperCase() !== "POST" || typeof init?.body !== "string") return false;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(url, window.location.href).pathname.endsWith("/_agent-native/agent-chat");
}

/**
 * Call once before hydration. Fills an empty model selection so the picker
 * has a label, strips models the active engine does not offer from chat
 * requests, and replaces a stale saved model once the engine catalog loads.
 */
export function installChatModelGuard(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  repairStorage();
  const baseFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (!isAgentChatPost(input, init)) return baseFetch(input, init);
    ensureCatalog();
    try {
      const { body, removed } = sanitizeChatRequest(JSON.parse(init!.body as string), catalog);
      if (removed.length === 0) return baseFetch(input, init);
      console.info(`[spend-desk] chat request model not offered by the active engine; using the server default (${removed.join(", ")})`);
      return baseFetch(input, { ...init, body: JSON.stringify(body) });
    } catch {
      return baseFetch(input, init);
    }
  };
  ensureCatalog();
}
