import { DEFAULT_MODEL } from "@agent-native/core/client/use-chat-models";
import { describe, expect, it } from "vitest";

import {
  type ActiveModelCatalog,
  FALLBACK_MODEL_SELECTION,
  repairStoredSelection,
  sanitizeChatRequest,
  toActiveModelCatalog,
} from "../app/lib/chat-model-guard";

// What the live engine catalog reported for this app (AGENT_ENGINE=anthropic).
const catalog: ActiveModelCatalog = {
  defaultEngine: "anthropic",
  defaultModel: "claude-sonnet-5-5",
  engines: { anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] },
};

// The first-turn request captured from a fresh browser before the fix.
const firstTurn = (model: string) => ({
  threadId: "t1",
  prompt: "close out this week's jobs",
  messages: [{ role: "user", parts: [{ type: "text", text: "use model gpt-6-luna?" }], metadata: { model } }],
  model,
  metadata: { model, mode: "act" },
  options: { model, metadata: { model } },
  submissionPayload: { metadata: { model }, options: { model, metadata: { model } } },
});

describe("sanitizeChatRequest", () => {
  it("omits the framework default model (gpt-6-luna) under the anthropic engine everywhere it is sent", () => {
    expect(DEFAULT_MODEL).toBe("gpt-6-luna");
    const { body, removed } = sanitizeChatRequest(firstTurn(DEFAULT_MODEL), catalog);
    expect(removed).toHaveLength(7);
    const b = body as ReturnType<typeof firstTurn>;
    expect(b.model).toBeUndefined();
    expect(b.metadata).toEqual({ mode: "act" });
    expect(b.options).toEqual({ metadata: {} });
    expect(b.submissionPayload).toEqual({ metadata: {}, options: { metadata: {} } });
  });

  it("leaves message content alone", () => {
    const { body } = sanitizeChatRequest(firstTurn(DEFAULT_MODEL), catalog);
    expect((body as ReturnType<typeof firstTurn>).messages[0]!.metadata.model).toBe(DEFAULT_MODEL);
  });

  it("omits a cross-provider model even when the request names the anthropic engine", () => {
    const { body, removed } = sanitizeChatRequest({ model: "gpt-6-luna", engine: "anthropic" }, catalog);
    expect(body).toEqual({ engine: "anthropic" });
    expect(removed).toEqual(["model=gpt-6-luna"]);
  });

  it("omits every model and engine while the catalog has not loaded", () => {
    const { body } = sanitizeChatRequest({ model: "claude-sonnet-5-5", engine: "anthropic", options: { model: "claude-sonnet-5-5" } }, null);
    expect(body).toEqual({ options: {} });
  });

  it("keeps a model the active engine offers", () => {
    const req = { model: "claude-sonnet-5-5", engine: "anthropic", options: { model: "claude-opus-5-5" } };
    expect(sanitizeChatRequest(req, catalog)).toEqual({ body: req, removed: [] });
  });

  it("drops an engine the catalog does not know, then judges the model against the default engine", () => {
    const { body } = sanitizeChatRequest({ model: "claude-sonnet-5-5", engine: "ai-sdk:openai" }, catalog);
    expect(body).toEqual({ model: "claude-sonnet-5-5" });
  });
});

describe("repairStoredSelection", () => {
  it("fills an empty selection before the catalog loads so the picker has a label", () => {
    expect(repairStoredSelection(null, null)).toEqual(FALLBACK_MODEL_SELECTION);
    expect(repairStoredSelection({}, null)).toEqual(FALLBACK_MODEL_SELECTION);
  });

  it("leaves a saved selection alone until the catalog can judge it", () => {
    expect(repairStoredSelection({ model: "gpt-6-luna" }, null)).toBeNull();
  });

  it("replaces a stale saved model the engine does not offer with the engine default", () => {
    expect(repairStoredSelection({ model: "gpt-6-luna", engine: "", effort: "high" }, catalog)).toEqual({
      model: "claude-sonnet-5-5",
      engine: "anthropic",
      effort: "high",
    });
  });

  it("keeps a valid saved selection", () => {
    expect(repairStoredSelection({ model: "claude-opus-5-5", engine: "anthropic" }, catalog)).toBeNull();
  });
});

describe("toActiveModelCatalog", () => {
  it("maps the framework catalog and rejects one that is unavailable", () => {
    expect(
      toActiveModelCatalog({
        state: "available",
        defaultEngine: "anthropic",
        defaultModel: "claude-sonnet-5-5",
        modelEngines: { anthropic: { supportedModels: ["claude-sonnet-5-5"], selectableModels: ["claude-opus-5-5"] } },
      }),
    ).toEqual({ defaultEngine: "anthropic", defaultModel: "claude-sonnet-5-5", engines: { anthropic: ["claude-sonnet-5-5", "claude-opus-5-5"] } });
    expect(toActiveModelCatalog({ state: "unavailable" })).toBeNull();
  });
});
