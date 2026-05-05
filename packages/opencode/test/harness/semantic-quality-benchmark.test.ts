// @ts-nocheck
import { describe, expect, test } from "bun:test"
import {
  classifySemanticQualityLift,
  semanticQualityPolicyHint,
  summarizeSemanticQualityLiftProfiles,
} from "../../src/harness/semantic-quality-benchmark"

describe("semantic quality lift policy", () => {
  test("classifies strong reasoning and strong control separately from weak control", () => {
    expect(classifySemanticQualityLift({ looseQualityLift: 1, qualityLift: 1 })).toBe(
      "strong_reasoner_strong_controller",
    )
    expect(classifySemanticQualityLift({ looseQualityLift: 1, qualityLift: 0 })).toBe(
      "strong_reasoner_weak_controller",
    )
    expect(classifySemanticQualityLift({ looseQualityLift: 0, qualityLift: 1 })).toBe(
      "controller_without_reasoning_gain",
    )
    expect(classifySemanticQualityLift({ looseQualityLift: 0, qualityLift: 0 })).toBe("weak_semantic_gain")
    expect(classifySemanticQualityLift({ looseQualityLift: -1, qualityLift: -2 })).toBe("weak_semantic_gain")
  })

  test("maps profiles to stable harness policy hints", () => {
    expect(semanticQualityPolicyHint("strong_reasoner_strong_controller")).toContain("good default")
    expect(semanticQualityPolicyHint("strong_reasoner_weak_controller")).toContain("output sanitization")
    expect(semanticQualityPolicyHint("controller_without_reasoning_gain")).toContain("exact-output safe")
    expect(semanticQualityPolicyHint("weak_semantic_gain")).toContain("do not prioritize")
  })

  test("summarizes profile buckets with stable model ids", () => {
    expect(
      summarizeSemanticQualityLiftProfiles([
        { benchmarkModel: { providerID: "opencode" as any, modelID: "minimax-m2.5-free" as any }, looseQualityLift: 1, qualityLift: 1 },
        { benchmarkModel: { providerID: "opencode" as any, modelID: "mimo-v2-pro-free" as any }, looseQualityLift: 1, qualityLift: 0 },
        { benchmarkModel: { providerID: "opencode" as any, modelID: "big-pickle" as any }, looseQualityLift: 1, qualityLift: 1 },
      ]),
    ).toEqual([
      {
        profile: "strong_reasoner_strong_controller",
        count: 2,
        modelIDs: ["big-pickle", "minimax-m2.5-free"],
      },
      {
        profile: "strong_reasoner_weak_controller",
        count: 1,
        modelIDs: ["mimo-v2-pro-free"],
      },
    ])
  })
})
