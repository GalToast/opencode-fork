// @ts-nocheck
import { describe, expect, test } from "bun:test"
import { runRetrievalTraceRankerAblationBenchmark } from "../../src/harness/retrieval-trace-ranker-ablation-benchmark"
import type { RetrievalTraceReplayScenario } from "../../src/harness/retrieval-trace-replay-benchmark"

const scenarios: RetrievalTraceReplayScenario[] = [
  {
    id: "outcome_rescues_correct_doc",
    query: "find the fallback recovery parity fix",
    detail: "recovery over decision",
    expectedIntent: "recovery",
    expectedTopDocumentID: "doc-recovery-correct",
    candidates: [
      {
        rank: 1,
        documentID: "doc-decision-wrong",
        chunkID: "doc-decision-wrong-chunk-0",
        sourceType: "note",
        title: "fallback parity decision rule",
        snippet: "decision note about fallback parity fix and compatibility defaults after the recovery incident",
        score: 6.2,
        rerankScore: 6.2,
        outcomeScore: 0,
        feedbackScore: 0,
      },
      {
        rank: 2,
        documentID: "doc-recovery-correct",
        chunkID: "doc-recovery-correct-chunk-0",
        sourceType: "note",
        title: "fallback recovery parity fix",
        snippet: "provider fallback recovery parity fix and regression recovery notes",
        score: 5,
        rerankScore: 5,
        outcomeScore: 1.5,
        feedbackScore: 0,
      },
    ],
  },
  {
    id: "feedback_rescues_correct_doc",
    query: "which file routes auto retrieval prompts by query intent",
    detail: "owner file lookup",
    expectedIntent: "file",
    expectedTopDocumentID: "doc-file-correct",
    candidates: [
      {
        rank: 1,
        documentID: "doc-decision-wrong-2",
        chunkID: "doc-decision-wrong-2-chunk-0",
        sourceType: "note",
        title: "query intent routing decision",
        snippet: "decision memo about which file route and query intent defaults we kept for retrieval prompts",
        score: 6,
        rerankScore: 6,
        outcomeScore: 0,
        feedbackScore: 0,
      },
      {
        rank: 2,
        documentID: "doc-file-correct",
        chunkID: "doc-file-correct-chunk-0",
        sourceType: "note",
        title: "retrieval prompt router owner file",
        snippet: "prompt.ts file owner that routes auto retrieval prompts by query intent",
        score: 5.1,
        rerankScore: 5.1,
        outcomeScore: 0,
        feedbackScore: 1.1,
      },
    ],
  },
  {
    id: "intent_aware_rescues_correct_doc",
    query: "what was the benchmark first then production pattern we kept",
    detail: "task pattern over decision recall",
    expectedIntent: "task_pattern",
    expectedTopDocumentID: "doc-pattern-correct",
    candidates: [
      {
        rank: 1,
        documentID: "doc-decision-wrong-3",
        chunkID: "doc-decision-wrong-3-chunk-0",
        sourceType: "note",
        title: "benchmark first decision rule",
        snippet: "decision note using benchmark first then production wording for a settled compatibility rule",
        score: 5.8,
        rerankScore: 5.8,
        outcomeScore: 0,
        feedbackScore: 0,
      },
      {
        rank: 2,
        documentID: "doc-pattern-correct",
        chunkID: "doc-pattern-correct-chunk-0",
        sourceType: "note",
        title: "benchmark first then production pattern",
        snippet: "task pattern for benchmark first then production rollout",
        score: 4.7,
        rerankScore: 4.9,
        outcomeScore: 0,
        feedbackScore: 0,
      },
    ],
  },
]

describe("harness retrieval trace ranker ablation benchmark", () => {
  test("separates base hybrid ingredients from the current intent-aware replay formula", async () => {
    const result = await runRetrievalTraceRankerAblationBenchmark({
      scenarios,
      includeSeededScenarios: false,
    })

    expect(result.suite).toBe("retrieval_trace_ranker_ablation")
    expect(result.scenarioCount).toBe(3)
    expect(result.variantCount).toBe(6)
    expect(result.overallWinner.topDocumentReplayAccuracy).toBeCloseTo(2 / 3, 4)

    const byID = new Map(result.variants.map((variant) => [variant.id, variant]))
    expect(byID.get("lexical_only")?.topDocumentReplayAccuracy).toBeCloseTo(2 / 3, 4)
    expect(byID.get("retrieval_base")?.topDocumentReplayAccuracy).toBe(0)
    expect(byID.get("hybrid_no_feedback")?.topDocumentReplayAccuracy).toBeCloseTo(1 / 3, 4)
    expect(byID.get("hybrid_no_outcome")?.topDocumentReplayAccuracy).toBeCloseTo(1 / 3, 4)
    expect(byID.get("hybrid_current")?.topDocumentReplayAccuracy).toBeCloseTo(2 / 3, 4)
    expect(byID.get("hybrid_current")?.meanReciprocalRank).toBeGreaterThan(
      byID.get("retrieval_base")?.meanReciprocalRank ?? 0,
    )
    expect(byID.get("intent_aware_current")?.topDocumentReplayAccuracy).toBeCloseTo(2 / 3, 4)
  })
})
