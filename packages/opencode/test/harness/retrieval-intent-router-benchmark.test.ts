// @ts-nocheck
import { describe, expect, test } from "bun:test"
import {
  runRetrievalIntentRouterBenchmark,
  type RetrievalIntentRouterScenario,
} from "../../src/harness/retrieval-intent-router-benchmark"

const scenarios: RetrievalIntentRouterScenario[] = [
  {
    id: "single_intent_file",
    query: "which file actually routes auto retrieval prompts by query intent",
    detail: "exact owner file lookup",
    expectedIntent: "file",
    expectedConfidence: "high",
    expectedStrategy: "single_intent",
    source: "seeded_quality",
  },
  {
    id: "ambiguous_task_pattern_vs_decision",
    query: "what was our benchmark first then production pattern and what decision did it preserve",
    detail: "ambiguous between execution pattern and governing decision",
    expectedIntent: "task_pattern",
    expectedSecondaryIntent: "decision",
    expectedConfidence: "low",
    expectedStrategy: "dual_intent_blend",
    source: "real_trace_replay",
  },
]

describe("harness retrieval intent router benchmark", () => {
  test("full auto router beats a primary-only classifier on exact route behavior", async () => {
    const result = await runRetrievalIntentRouterBenchmark({ scenarios })

    expect(result.suite).toBe("retrieval_intent_router")
    expect(result.scenarioCount).toBe(2)
    expect(result.variantCount).toBe(2)
    expect(result.overallWinner.id).toBe("auto_intent_router")

    const byID = new Map(result.variants.map((variant) => [variant.id, variant]))
    expect(byID.get("primary_only_classifier")?.primaryIntentAccuracy).toBe(1)
    expect(byID.get("primary_only_classifier")?.exactRouteAccuracy).toBeCloseTo(0.5, 4)
    expect(byID.get("auto_intent_router")?.primaryIntentAccuracy).toBe(1)
    expect(byID.get("auto_intent_router")?.secondaryIntentAccuracy).toBe(1)
    expect(byID.get("auto_intent_router")?.confidenceAccuracy).toBe(1)
    expect(byID.get("auto_intent_router")?.strategyAccuracy).toBe(1)
    expect(byID.get("auto_intent_router")?.exactRouteAccuracy).toBe(1)
  })
})
