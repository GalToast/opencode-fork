// @ts-nocheck
import { describe, expect, test } from "bun:test"
import { retrievalTraceAmbiguityFlags } from "../../src/retrieval/trace"

describe("retrieval trace ambiguity flags", () => {
  test("flags low-confidence dual-intent traces with tight score races", () => {
    const flags = retrievalTraceAmbiguityFlags({
      routedIntent: "file",
      routedIntentSecondary: "decision",
      routingConfidence: "low",
      routingStrategy: "dual_intent_blend",
      routingScoreSpread: 0.9,
      topCandidateScoreGap: 0.18,
      topCandidateRerankGap: 0.11,
      topCandidates: [{} as any],
      selectedCandidateCount: 1,
    })

    expect(flags).toEqual(
      expect.arrayContaining([
        "low_routing_confidence",
        "dual_intent_blend",
        "tight_intent_race",
        "tight_top_candidate_gap",
        "tight_top_rerank_gap",
        "competing_secondary_intent",
      ]),
    )
  })

  test("stays quiet for clear high-confidence traces", () => {
    const flags = retrievalTraceAmbiguityFlags({
      routedIntent: "recovery",
      routedIntentSecondary: undefined,
      routingConfidence: "high",
      routingStrategy: "single_intent",
      routingScoreSpread: 4.2,
      topCandidateScoreGap: 1.3,
      topCandidateRerankGap: 0.8,
      topCandidates: [{} as any],
      selectedCandidateCount: 1,
    })

    expect(flags).toEqual([])
  })
})
