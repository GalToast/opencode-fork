// @ts-nocheck
import { describe, expect, test } from "bun:test"
import {
  classifyRetrievalToolUseLift,
  renderRetrievalToolUsePromptFailure,
  retrievalToolUsePolicyHint,
} from "../../src/harness/retrieval-tool-use-benchmark"

describe("retrieval tool-use lift policy", () => {
  test("classifies strong tool judgment separately from weak output control", () => {
    expect(classifyRetrievalToolUseLift({ looseDecisionLift: 1, decisionLift: 1 })).toBe(
      "strong_tool_judgment_strong_control",
    )
    expect(classifyRetrievalToolUseLift({ looseDecisionLift: 1, decisionLift: 0 })).toBe(
      "strong_tool_judgment_weak_control",
    )
    expect(classifyRetrievalToolUseLift({ looseDecisionLift: 0, decisionLift: 1 })).toBe(
      "control_without_tool_gain",
    )
    expect(classifyRetrievalToolUseLift({ looseDecisionLift: 0, decisionLift: 0 })).toBe("weak_tool_gain")
    expect(classifyRetrievalToolUseLift({ looseDecisionLift: -1, decisionLift: -2 })).toBe("weak_tool_gain")
  })

  test("maps tool-use profiles to stable harness hints", () => {
    expect(retrievalToolUsePolicyHint("strong_tool_judgment_strong_control")).toContain("good default")
    expect(retrievalToolUsePolicyHint("strong_tool_judgment_weak_control")).toContain("sanitization")
    expect(retrievalToolUsePolicyHint("control_without_tool_gain")).toContain("output-safe")
    expect(retrievalToolUsePolicyHint("weak_tool_gain")).toContain("do not prioritize")
  })

  test("labels timeout-style prompt failures distinctly", () => {
    expect(renderRetrievalToolUsePromptFailure(new Error("timed out after 20000ms"))).toBe("error_timeout")
    expect(renderRetrievalToolUsePromptFailure(new Error("provider exploded"))).toBe("error")
  })
})
