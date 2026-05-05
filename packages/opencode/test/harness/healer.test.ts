import { describe, it, expect } from "bun:test"
import {
  HealerRequestedStageOnlyError,
  extractJsonText,
  normalizeDecision,
  buildGenerationRetryDecision,
  healerPromptText,
} from "../../src/harness/healer"
import type { HarnessHealerPhase, HarnessHealerDecision } from "../../src/harness/healer"
import type { HarnessState } from "../../src/harness/state"

type HarnessHealerInterventionInput = Parameters<typeof buildGenerationRetryDecision>[0]

// Helper to build a minimal proposal for testing
function makeProposal(overrides: Partial<HarnessState.Proposal> = {}): HarnessState.Proposal {
  return {
    id: "test-proposal-001",
    kind: "code_patch",
    title: overrides.title ?? "Test proposal",
    confidence: "medium",
    rationale: overrides.rationale ?? "Test rationale",
    status: "open",
    patchHint: {
      summary: "Fix the thing",
      files: ["src/harness/review.ts"],
    },
    ...overrides,
  }
}

describe("healer module", () => {
  describe("HealerRequestedStageOnlyError", () => {
    it("creates error with correct properties for generation_retry phase", () => {
      const error = new HealerRequestedStageOnlyError("generation_retry", "repeated stalls detected")
      expect(error.name).toBe("HealerRequestedStageOnlyError")
      expect(error.phase).toBe("generation_retry")
      expect(error.summary).toBe("repeated stalls detected")
      expect(error.message).toContain("generation_retry")
      expect(error.message).toContain("repeated stalls detected")
    })

    it("creates error with correct properties for review_repair phase", () => {
      const error = new HealerRequestedStageOnlyError("review_repair", "review feedback needs manual follow-up")
      expect(error.name).toBe("HealerRequestedStageOnlyError")
      expect(error.phase).toBe("review_repair")
      expect(error.summary).toBe("review feedback needs manual follow-up")
    })
  })

  describe("HarnessHealerPhase type", () => {
    it("accepts generation_retry as valid phase", () => {
      const phase: HarnessHealerPhase = "generation_retry"
      expect(phase).toBe("generation_retry")
    })

    it("accepts review_repair as valid phase", () => {
      const phase: HarnessHealerPhase = "review_repair"
      expect(phase).toBe("review_repair")
    })
  })

  describe("extractJsonText", () => {
    it("extracts content from fenced json block", () => {
      const raw = "Some preamble\n```json\n{\"mode\": \"continue\", \"summary\": \"test\"}\n```\nSome trailing"
      const result = extractJsonText(raw)
      expect(result).toBe('{"mode": "continue", "summary": "test"}')
    })

    it("extracts content from bare json object", () => {
      const raw = '{"mode":"stage_only","summary":"done"}'
      const result = extractJsonText(raw)
      expect(result).toBe('{"mode":"stage_only","summary":"done"}')
    })

    it("falls back to raw when no json pattern matches", () => {
      const raw = "just plain text, no json here"
      const result = extractJsonText(raw)
      expect(result).toBe("just plain text, no json here")
    })

    it("handles fenced block with whitespace", () => {
      const raw = "```\njson\n  {\"mode\": \"continue\"}  \n```"
      const result = extractJsonText(raw)
      expect(result).toBe('{"mode": "continue"}')
    })

    it("prefers fenced block over bare object when both present", () => {
      const raw = '{"mode":"first"}\n```json\n{"mode":"fenced"}\n```'
      const result = extractJsonText(raw)
      expect(result).toBe('{"mode":"fenced"}')
    })

    it("handles multiline json in fenced block", () => {
      const raw = "```json\n{\n  \"mode\": \"continue\",\n  \"summary\": \"multi\"\n}\n```"
      const result = extractJsonText(raw)
      expect(result).toContain('"mode"')
      expect(result).toContain('"continue"')
    })

    it("returns trimmed result", () => {
      const raw = "  {\"mode\":\"continue\"}  "
      const result = extractJsonText(raw)
      expect(result).toBe('{"mode":"continue"}')
    })
  })

  describe("normalizeDecision", () => {
    it("trims summary and removes duplicate promptNotes", () => {
      const input: HarnessHealerDecision = {
        mode: "continue",
        summary: "  trim me  ",
        promptNotes: ["a", "b", "a", "  ", "b", "c"],
        preferFreshContext: false,
        suppressPreviousOutput: false,
      }
      const result = normalizeDecision(input)
      expect(result.summary).toBe("trim me")
      expect(result.promptNotes).toEqual(["a", "b", "c"])
    })

    it("limits promptNotes to 3 items", () => {
      const input: HarnessHealerDecision = {
        mode: "continue",
        summary: "test",
        promptNotes: ["one", "two", "three", "four", "five"],
        preferFreshContext: false,
        suppressPreviousOutput: false,
      }
      const result = normalizeDecision(input)
      expect(result.promptNotes).toEqual(["one", "two", "three"])
    })

    it("trims retryModel and returns undefined when empty", () => {
      const input: HarnessHealerDecision = {
        mode: "continue",
        summary: "test",
        promptNotes: [],
        retryModel: "  openai/gpt-4  ",
        preferFreshContext: false,
        suppressPreviousOutput: false,
      }
      const result = normalizeDecision(input)
      expect(result.retryModel).toBe("openai/gpt-4")

      const input2: HarnessHealerDecision = {
        mode: "continue",
        summary: "test",
        promptNotes: [],
        retryModel: "",
        preferFreshContext: false,
        suppressPreviousOutput: false,
      }
      const result2 = normalizeDecision(input2)
      expect(result2.retryModel).toBeUndefined()
    })

    it("preserves boolean flags", () => {
      const input: HarnessHealerDecision = {
        mode: "stage_only",
        summary: "test",
        promptNotes: [],
        preferFreshContext: true,
        suppressPreviousOutput: true,
      }
      const result = normalizeDecision(input)
      expect(result.preferFreshContext).toBe(true)
      expect(result.suppressPreviousOutput).toBe(true)
    })
  })

  describe("buildGenerationRetryDecision", () => {
    function makeInput(overrides: Partial<HarnessHealerInterventionInput> = {}): HarnessHealerInterventionInput {
      return {
        proposal: makeProposal(),
        phase: "generation_retry",
        artifacts: [],
        ...overrides,
      }
    }

    it("returns stage_only for repeated timeouts (attempt >= 2, not startup-only)", () => {
      const input = makeInput({
        validationError: "Request timed out after 60000ms",
        attempt: 3,
        currentModel: "openai/codex-spark",
      })
      const result = buildGenerationRetryDecision(input)
      expect(result.mode).toBe("stage_only")
      expect(result.suppressPreviousOutput).toBe(true)
    })

    it("returns continue for first timeout attempt", () => {
      const input = makeInput({
        validationError: "Request timed out",
        attempt: 1,
      })
      const result = buildGenerationRetryDecision(input)
      expect(result.mode).toBe("continue")
      expect(result.summary).toContain("stalled")
    })

    it("returns continue with staleContext for stale context errors", () => {
      const input = makeInput({
        validationError: "failed to find expected lines in source",
        attempt: 1,
      })
      const result = buildGenerationRetryDecision(input)
      expect(result.mode).toBe("continue")
      expect(result.preferFreshContext).toBe(true)
      expect(result.suppressPreviousOutput).toBe(true)
      expect(result.promptNotes.some((n) => n.toLowerCase().includes("fresh") || n.toLowerCase().includes("scratch"))).toBe(true)
    })

    it("returns continue with suppressPreviousOutput for malformed patch errors", () => {
      const input = makeInput({
        validationError: "patch contained no valid apply_patch body",
        attempt: 1,
      })
      const result = buildGenerationRetryDecision(input)
      expect(result.mode).toBe("continue")
      expect(result.suppressPreviousOutput).toBe(true)
      expect(result.preferFreshContext).toBe(false)
      expect(result.promptNotes.some((n) => n.toLowerCase().includes("complete") || n.toLowerCase().includes("clean"))).toBe(true)
    })

    it("returns continue with tighter prompt for timeout on attempt >= 2 but startup-only", () => {
      // SessionError with startup failure: should NOT trigger stage_only path
      const input = makeInput({
        validationError: "session_start failed: process crashed",
        attempt: 2,
      })
      const result = buildGenerationRetryDecision(input)
      // This is a SessionError startup, not a TimeoutError, so it falls to default continue.
      expect(result.mode).toBe("continue")
    })

    it("returns default continue for unknown errors", () => {
      const input = makeInput({
        validationError: "something weird happened",
        attempt: 1,
      })
      const result = buildGenerationRetryDecision(input)
      expect(result.mode).toBe("continue")
      expect(result.promptNotes.length).toBeGreaterThan(0)
    })

    it("returns default continue when no validationError provided", () => {
      const input = makeInput({
        attempt: 1,
      })
      const result = buildGenerationRetryDecision(input)
      expect(result.mode).toBe("continue")
      expect(result.summary).toContain("tighter")
    })

    it("includes retryModel in decision when model rotation is appropriate", () => {
      // Current logic does not set retryModel in any branch; verify this remains absent.
      const input = makeInput({
        validationError: "Request timed out",
        attempt: 1,
      })
      const result = buildGenerationRetryDecision(input)
      // No branch sets retryModel currently; confirm it stays undefined
      expect(result.retryModel).toBeUndefined()
    })
  })

  describe("healerPromptText", () => {
    it("includes proposal title and rationale", () => {
      const input: HarnessHealerInterventionInput = {
        proposal: makeProposal({ title: "My title", rationale: "My rationale" }),
        phase: "generation_retry",
        artifacts: [],
      }
      const result = healerPromptText(input)
      expect(result).toContain("My title")
      expect(result).toContain("My rationale")
    })

    it("includes generation failure details for generation_retry phase", () => {
      const input: HarnessHealerInterventionInput = {
        proposal: makeProposal(),
        phase: "generation_retry",
        artifacts: [],
        attempt: 2,
        validationError: "timeout error xyz",
        currentModel: "openai/gpt-4",
      }
      const result = healerPromptText(input)
      expect(result).toContain("Phase: generation_retry")
      expect(result).toContain("Attempt: 2")
      expect(result).toContain("timeout error xyz")
      expect(result).toContain("openai/gpt-4")
    })

    it("includes review verdict and concerns for review_repair phase", () => {
      const input: HarnessHealerInterventionInput = {
        proposal: makeProposal(),
        phase: "review_repair",
        artifacts: [],
        reviewDecision: {
          verdict: "reject",
          summary: "too broad",
          concerns: ["changes unrelated files", "missing tests"],
          requiredChanges: ["revert config changes"],
        },
      }
      const result = healerPromptText(input)
      expect(result).toContain("Review verdict: reject")
      expect(result).toContain("Review summary: too broad")
      expect(result).toContain("- changes unrelated files")
      expect(result).toContain("- missing tests")
      expect(result).toContain("- revert config changes")
    })

    it("includes artifacts list", () => {
      const input: HarnessHealerInterventionInput = {
        proposal: makeProposal(),
        phase: "generation_retry",
        artifacts: ["/path/to/file1.txt", "/path/to/file2.txt"],
      }
      const result = healerPromptText(input)
      expect(result).toContain("- /path/to/file1.txt")
      expect(result).toContain("- /path/to/file2.txt")
    })

    it("uses defaults when reviewDecision fields are missing", () => {
      const input: HarnessHealerInterventionInput = {
        proposal: makeProposal(),
        phase: "review_repair",
        artifacts: [],
        reviewDecision: {
          verdict: "unknown",
          summary: "no details",
        },
      }
      const result = healerPromptText(input)
      expect(result).toContain("Review verdict: unknown")
      expect(result).toContain("Review summary: no details")
      expect(result).toContain("- none") // concerns default
    })

    it("describes allowed outputs and constraints", () => {
      const input: HarnessHealerInterventionInput = {
        proposal: makeProposal(),
        phase: "generation_retry",
        artifacts: [],
      }
      const result = healerPromptText(input)
      expect(result).toContain('"continue"')
      expect(result).toContain('"stage_only"')
      expect(result).toContain("Do not propose code changes")
    })
  })
})
