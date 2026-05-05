// @ts-nocheck
import { describe, expect, test } from "bun:test"
import {
  classifyRetrievalParallelToolCallingLift,
  renderRetrievalParallelToolCallingPromptFailure,
  retrievalParallelToolCallingPolicyHint,
} from "../../src/harness/retrieval-parallel-tool-calling-benchmark"

describe("retrieval parallel tool-calling lift policy", () => {
  test("classifies strong parallel judgment separately from weak output control", () => {
    expect(classifyRetrievalParallelToolCallingLift({ looseDecisionLift: 1, decisionLift: 1 })).toBe(
      "strong_parallel_judgment_strong_control",
    )
    expect(classifyRetrievalParallelToolCallingLift({ looseDecisionLift: 1, decisionLift: 0 })).toBe(
      "strong_parallel_judgment_weak_control",
    )
    expect(classifyRetrievalParallelToolCallingLift({ looseDecisionLift: 0, decisionLift: 1 })).toBe(
      "control_without_parallel_gain",
    )
    expect(classifyRetrievalParallelToolCallingLift({ looseDecisionLift: 0, decisionLift: 0 })).toBe("weak_parallel_gain")
    expect(classifyRetrievalParallelToolCallingLift({ looseDecisionLift: -1, decisionLift: -2 })).toBe("weak_parallel_gain")
  })

  test("maps parallel-calling profiles to stable harness hints", () => {
    expect(retrievalParallelToolCallingPolicyHint("strong_parallel_judgment_strong_control")).toContain("good default")
    expect(retrievalParallelToolCallingPolicyHint("strong_parallel_judgment_weak_control")).toContain("stricter")
    expect(retrievalParallelToolCallingPolicyHint("control_without_parallel_gain")).toContain("format-safe")
    expect(retrievalParallelToolCallingPolicyHint("weak_parallel_gain")).toContain("do not prioritize")
  })

  test("labels timeout-style prompt failures distinctly", () => {
    expect(renderRetrievalParallelToolCallingPromptFailure(new Error("timed out after 20000ms"))).toBe("error_timeout")
    expect(renderRetrievalParallelToolCallingPromptFailure(new Error("provider exploded"))).toBe("error")
  })
})
