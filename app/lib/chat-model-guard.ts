// Keeps chat requests on a model the active agent engine actually offers.
//
// The shared composer starts from the framework default model (an OpenAI
// model) until the engine catalog loads, so a fast first send could ask the
// anthropic engine for a model it does not have. These pure helpers decide
// what may be sent; chat-model-guard.client.ts applies them in the browser.

/** Browser storage key the framework's model picker reads and writes. */
export const CHAT_MODEL_SELECTION_KEY = "agent-native:chat-models:selection";

/**
 * Picker label before the live catalog loads in a browser with nothing saved:
 * this app pins AGENT_ENGINE=anthropic. If the server's engine ever differs,
 * the request guard strips it and the repair below replaces it once loaded.
 */
export const FALLBACK_MODEL_SELECTION = { engine: "anthropic", model: "claude-sonnet-5-5" } as const;

export interface ActiveModelCatalog {
  defaultEngine: string;
  defaultModel: string;
  /** Models each selectable engine offers, keyed by engine name. */
  engines: Record<string, readonly string[]>;
}

export interface StoredModelSelection {
  model?: string;
  engine?: string;
  effort?: string;
}

/** A model may be sent only when the engine it will run on lists it. */
export function isModelAllowed(model: string, engine: string | undefined, catalog: ActiveModelCatalog | null): boolean {
  if (!catalog) return false;
  return catalog.engines[engine || catalog.defaultEngine]?.includes(model) ?? false;
}

// Message content can mention "model"; only request settings are checked.
const CONTENT_KEYS = new Set(["messages", "prompt", "parts", "attachments", "references", "tools", "contextItems", "structuredHistory", "text"]);

/**
 * Returns a copy of a chat request with every `model` the target engine does
 * not offer removed (and any `engine` the catalog does not know), so the server
 * falls back to the engine's default model. With no catalog yet, every model
 * and engine is removed.
 */
export function sanitizeChatRequest(body: unknown, catalog: ActiveModelCatalog | null): { body: unknown; removed: string[] } {
  const removed: string[] = [];
  const visit = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item, i) => visit(item, `${path}[${i}]`));
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = CONTENT_KEYS.has(key) ? value : visit(value, path ? `${path}.${key}` : key);
    }
    const engine = typeof out.engine === "string" ? out.engine : undefined;
    if (engine !== undefined && !(catalog && catalog.engines[engine])) {
      delete out.engine;
      removed.push(`${path ? `${path}.` : ""}engine=${engine}`);
    }
    if (typeof out.model === "string" && !isModelAllowed(out.model, typeof out.engine === "string" ? out.engine : undefined, catalog)) {
      removed.push(`${path ? `${path}.` : ""}model=${out.model}`);
      delete out.model;
    }
    return out;
  };
  return { body: visit(body, ""), removed };
}

/**
 * The selection to store instead of `stored`, or null to leave it alone.
 * Before the catalog loads, only an empty selection is filled (so the picker
 * never shows a blank label). Once it loads, a model the engine does not offer
 * is replaced with the engine default.
 */
export function repairStoredSelection(stored: StoredModelSelection | null, catalog: ActiveModelCatalog | null): StoredModelSelection | null {
  const effort = stored?.effort ? { effort: stored.effort } : {};
  if (!catalog) {
    return stored?.model ? null : { ...FALLBACK_MODEL_SELECTION, ...effort };
  }
  if (stored?.model && isModelAllowed(stored.model, stored.engine, catalog)) return null;
  return { model: catalog.defaultModel, engine: catalog.defaultEngine, ...effort };
}

/** Narrows the framework's loadChatModelCatalog() result to what the guard needs. */
export function toActiveModelCatalog(result: unknown): ActiveModelCatalog | null {
  const r = result as {
    state?: string;
    defaultEngine?: string;
    defaultModel?: string;
    modelEngines?: Record<string, { supportedModels?: string[]; selectableModels?: string[] }>;
  } | null;
  if (r?.state !== "available" || !r.defaultEngine || !r.defaultModel || !r.modelEngines) return null;
  const engines: Record<string, readonly string[]> = {};
  for (const [name, engine] of Object.entries(r.modelEngines)) {
    engines[name] = [...new Set([...(engine.supportedModels ?? []), ...(engine.selectableModels ?? [])])];
  }
  return engines[r.defaultEngine]?.length ? { defaultEngine: r.defaultEngine, defaultModel: r.defaultModel, engines } : null;
}
