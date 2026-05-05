// @ts-nocheck
import { describe, expect, test } from "bun:test"
import {
  classifyRetrievalMultiturnRecoveryLift,
  renderRetrievalMultiturnRecoveryPromptFailure,
  retrievalMultiturnRecoveryPolicyHint,
} from "../../src/harness/retrieval-multiturn-recovery-benchmark"

describe("retrieval multi-turn recovery lift policy", () => {
  test("classifies strong recovery lift separately from weak output control", () => {
    expect(classifyRetrievalMultiturnRecoveryLift({ looseDecisionLift: 1, decisionLift: 1 })).toBe(
      "strong_recovery_gain_strong_control",
    )
    expect(classifyRetrievalMultiturnRecoveryLift({ looseDecisionLift: 1, decisionLift: 0 })).toBe(
      "strong_recovery_gain_weak_control",
    )
    expect(classifyRetrievalMultiturnRecoveryLift({ looseDecisionLift: 0, decisionLift: 1 })).toBe(
      "control_without_recovery_gain",
    )
    expect(classifyRetrievalMultiturnRecoveryLift({ looseDecisionLift: 0, decisionLift: 0 })).toBe(
      "weak_recovery_gain",
    )
    expect(classifyRetrievalMultiturnRecoveryLift({ looseDecisionLift: -1, decisionLift: -2 })).toBe(
      "weak_recovery_gain",
    )
  })

  test("maps recovery profiles to stable harness hints", () => {
    expect(retrievalMultiturnRecoveryPolicyHint("strong_recovery_gain_strong_control")).toContain("good default")
    expect(retrievalMultiturnRecoveryPolicyHint("strong_recovery_gain_weak_control")).toContain(
      "stricter output control",
    )
    expect(retrievalMultiturnRecoveryPolicyHint("control_without_recovery_gain")).toContain("format-safe")
    expect(retrievalMultiturnRecoveryPolicyHint("weak_recovery_gain")).toContain("do not prioritize")
  })

  test("labels timeout-style prompt failures distinctly", () => {
    expect(renderRetrievalMultiturnRecoveryPromptFailure(new Error("timed out after 20000ms"))).toBe("error_timeout")
    expect(renderRetrievalMultiturnRecoveryPromptFailure(new Error("provider exploded"))).toBe("error")
  })
})
