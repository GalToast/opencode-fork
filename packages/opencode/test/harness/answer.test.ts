// @ts-nocheck
import { describe, expect, test } from "bun:test"
import { canonical, isContractViolation, isDecisionMiss, isLooseCorrect, options } from "../../src/harness/answer"

describe("harness answer parsing", () => {
  test("parses declared options from benchmark prompts", () => {
    expect(options("Options: patch_then_verify, plan_first, gather_more_context.")).toEqual([
      "patch_then_verify",
      "plan_first",
      "gather_more_context",
    ])
    expect(options("Labels: stay_local, one_sidecar, parallel_lanes.")).toEqual([
      "stay_local",
      "one_sidecar",
      "parallel_lanes",
    ])
  })

  test("treats explanatory prose as loose-correct when one declared answer is clearly chosen", () => {
    const prompt = [
      "Choose the best first tool.",
      "Options: read, structural_read, edit.",
      "Reply with exactly one option and nothing else.",
    ].join("\n")
    expect(canonical("I'd choose structural_read because the file is large.", prompt)).toBe("structural_read")
    expect(isLooseCorrect("I'd choose structural_read because the file is large.", "structural_read", prompt)).toBe(true)
    expect(isContractViolation("I'd choose structural_read because the file is large.", "structural_read", prompt)).toBe(true)
    expect(isDecisionMiss("I'd choose structural_read because the file is large.", "structural_read", prompt)).toBe(false)
  })

  test("prefers the selected declared answer over earlier restated options", () => {
    const prompt = [
      "Choose the best execution topology.",
      "Options: aggressive, balanced, conservative.",
      "Reply with exactly one option and nothing else.",
    ].join("\n")
    expect(canonical("Options were aggressive, balanced, conservative, but I choose balanced.", prompt)).toBe("balanced")
  })

  test("treats missing or wrong declared answers as decision misses", () => {
    const prompt = [
      "Choose the best next move.",
      "Options: stay_local, one_sidecar, parallel_lanes.",
      "Reply with exactly one option and nothing else.",
    ].join("\n")
    expect(isLooseCorrect("We should research more before acting.", "stay_local", prompt)).toBe(false)
    expect(isDecisionMiss("We should research more before acting.", "stay_local", prompt)).toBe(true)
  })
})
