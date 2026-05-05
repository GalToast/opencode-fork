import { expect, test } from "bun:test"
import {
  parsePersistedModelSelectionState,
  resolveStartupModelSelection,
  serializePersistedModelSelectionState,
  shouldHydrateAgentDefaultModel,
} from "../../src/cli/cmd/tui/util/model-selection"

test("hydrates an agent default model when no selection has been stored yet", () => {
  expect(
    shouldHydrateAgentDefaultModel({
      stored: undefined,
      storedValid: false,
      agentDefault: { providerID: "alibaba-coding-plan", modelID: "qwen3.5-plus" },
      agentDefaultValid: true,
    }),
  ).toBe(true)
})

test("does not overwrite a valid user-selected model when switching back to the agent", () => {
  expect(
    shouldHydrateAgentDefaultModel({
      stored: { providerID: "anthropic", modelID: "claude-4.1" },
      storedValid: true,
      agentDefault: { providerID: "opencode", modelID: "minimax-m2.5-free" },
      agentDefaultValid: true,
    }),
  ).toBe(false)
})

test("falls back to the agent default when the stored model is no longer valid", () => {
  expect(
    shouldHydrateAgentDefaultModel({
      stored: { providerID: "legacy", modelID: "missing-model" },
      storedValid: false,
      agentDefault: { providerID: "alibaba-coding-plan", modelID: "glm-5" },
      agentDefaultValid: true,
    }),
  ).toBe(true)
})

test("persisted model state keeps per-agent selections across restart", () => {
  const serialized = serializePersistedModelSelectionState({
    model: {
      build: { providerID: "alibaba-coding-plan", modelID: "qwen3.5-plus" },
      plan: { providerID: "opencode", modelID: "minimax-m2.5-free" },
    },
    recent: [{ providerID: "alibaba-coding-plan", modelID: "glm-5" }],
    favorite: [{ providerID: "opencode", modelID: "minimax-m2.5-free" }],
    variant: { "alibaba-coding-plan/qwen3.5-plus": "fast" },
  })

  const parsed = parsePersistedModelSelectionState(serialized)

  expect(parsed.model.build).toEqual({ providerID: "alibaba-coding-plan", modelID: "qwen3.5-plus" })
  expect(parsed.model.plan).toEqual({ providerID: "opencode", modelID: "minimax-m2.5-free" })
  expect(parsed.recent).toEqual([{ providerID: "alibaba-coding-plan", modelID: "glm-5" }])
  expect(parsed.favorite).toEqual([{ providerID: "opencode", modelID: "minimax-m2.5-free" }])
  expect(parsed.variant["alibaba-coding-plan/qwen3.5-plus"]).toBe("fast")
})

test("keeps an explicit startup model pending until providers finish loading", () => {
  expect(
    resolveStartupModelSelection({
      requested: { providerID: "opencode", modelID: "minimax-m2.5-free" },
      requestedValid: false,
      providerCatalogReady: false,
    }),
  ).toEqual({
    state: "pending",
    model: { providerID: "opencode", modelID: "minimax-m2.5-free" },
  })
})

test("applies an explicit startup model once the provider catalog confirms it", () => {
  expect(
    resolveStartupModelSelection({
      requested: { providerID: "alibaba-coding-plan", modelID: "qwen3.5-plus" },
      requestedValid: true,
      providerCatalogReady: true,
    }),
  ).toEqual({
    state: "apply",
    model: { providerID: "alibaba-coding-plan", modelID: "qwen3.5-plus" },
  })
})

test("warns when an explicit startup model is still invalid after providers load", () => {
  expect(
    resolveStartupModelSelection({
      requested: { providerID: "opencode", modelID: "missing-free-model" },
      requestedValid: false,
      providerCatalogReady: true,
    }),
  ).toEqual({
    state: "invalid",
    model: { providerID: "opencode", modelID: "missing-free-model" },
  })
})
