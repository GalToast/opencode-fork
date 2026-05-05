// @ts-nocheck
import { describe, expect, test } from "bun:test"
import {
  classifyRetrievalOutcomeLift,
  renderRetrievalOutcomePromptFailure,
  retrievalOutcomePolicyHint,
} from "../../src/harness/retrieval-outcome-benchmark"

describe("retrieval outcome lift policy", () => {
  test("classifies strong outcome lift separately from weak output control", () => {
    expect(classifyRetrievalOutcomeLift({ looseDecisionLift: 1, decisionLift: 1 })).toBe(
      "strong_outcome_gain_strong_control",
    )
    expect(classifyRetrievalOutcomeLift({ looseDecisionLift: 1, decisionLift: 0 })).toBe(
      "strong_outcome_gain_weak_control",
    )
    expect(classifyRetrievalOutcomeLift({ looseDecisionLift: 0, decisionLift: 1 })).toBe(
      "control_without_outcome_gain",
    )
    expect(classifyRetrievalOutcomeLift({ looseDecisionLift: 0, decisionLift: 0 })).toBe("weak_outcome_gain")
    expect(classifyRetrievalOutcomeLift({ looseDecisionLift: -1, decisionLift: -2 })).toBe("weak_outcome_gain")
  })

  test("maps outcome profiles to stable harness hints", () => {
    expect(retrievalOutcomePolicyHint("strong_outcome_gain_strong_control")).toContain("good default")
    expect(retrievalOutcomePolicyHint("strong_outcome_gain_weak_control")).toContain("stricter output control")
    expect(retrievalOutcomePolicyHint("control_without_outcome_gain")).toContain("format-safe")
    expect(retrievalOutcomePolicyHint("weak_outcome_gain")).toContain("do not prioritize")
  })

  test("labels timeout-style prompt failures distinctly", () => {
    expect(renderRetrievalOutcomePromptFailure(new Error("timed out after 20000ms"))).toBe("error_timeout")
    expect(renderRetrievalOutcomePromptFailure(new Error("provider exploded"))).toBe("error")
  })
})
