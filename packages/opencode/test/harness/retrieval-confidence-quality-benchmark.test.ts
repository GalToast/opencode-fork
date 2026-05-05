// @ts-nocheck
import { describe, expect, test } from "bun:test"
import {
  classifyRetrievalConfidenceQualityLift,
  renderRetrievalConfidenceQualityPromptFailure,
  retrievalConfidenceQualityPolicyHint,
} from "../../src/harness/retrieval-confidence-quality-benchmark"

describe("retrieval confidence quality lift policy", () => {
  test("classifies strong confidence lift separately from weak output control", () => {
    expect(classifyRetrievalConfidenceQualityLift({ looseDecisionLift: 1, decisionLift: 1 })).toBe(
      "strong_confidence_gain_strong_control",
    )
    expect(classifyRetrievalConfidenceQualityLift({ looseDecisionLift: 1, decisionLift: 0 })).toBe(
      "strong_confidence_gain_weak_control",
    )
    expect(classifyRetrievalConfidenceQualityLift({ looseDecisionLift: 0, decisionLift: 1 })).toBe(
      "control_without_confidence_gain",
    )
    expect(classifyRetrievalConfidenceQualityLift({ looseDecisionLift: 0, decisionLift: 0 })).toBe(
      "weak_confidence_gain",
    )
    expect(classifyRetrievalConfidenceQualityLift({ looseDecisionLift: -1, decisionLift: -2 })).toBe(
      "weak_confidence_gain",
    )
  })

  test("maps confidence profiles to stable harness hints", () => {
    expect(retrievalConfidenceQualityPolicyHint("strong_confidence_gain_strong_control")).toContain("good default")
    expect(retrievalConfidenceQualityPolicyHint("strong_confidence_gain_weak_control")).toContain(
      "stricter output control",
    )
    expect(retrievalConfidenceQualityPolicyHint("control_without_confidence_gain")).toContain("format-safe")
    expect(retrievalConfidenceQualityPolicyHint("weak_confidence_gain")).toContain("do not prioritize")
  })

  test("labels timeout-style prompt failures distinctly", () => {
    expect(renderRetrievalConfidenceQualityPromptFailure(new Error("timed out after 20000ms"))).toBe("error_timeout")
    expect(renderRetrievalConfidenceQualityPromptFailure(new Error("provider exploded"))).toBe("error")
  })
})
