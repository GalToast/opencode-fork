import { describe, it, expect } from "bun:test"
import {
  HarnessGenerate,
} from "../../src/harness/generate"
import { ScopeRefinementRequestedError } from "../../src/harness/generate"

describe("generate module", () => {
  describe("extractPatchText", () => {
    it("extracts patch from markdown fenced block", () => {
      const raw = `Here is the patch:

\`\`\`patch
*** Begin Patch
*** Update File: packages/opencode/src/test.ts
@@
  existing line
*** End Patch
\`\`\`

Let me know if you need anything else.`

      const patch = HarnessGenerate.extractPatchText(raw)
      expect(patch).toContain("*** Begin Patch")
      expect(patch).toContain("*** End Patch")
      expect(patch).toContain("packages/opencode/src/test.ts")
    })

    it("extracts patch from raw begin/end markers", () => {
      const raw = `*** Begin Patch
*** Update File: packages/opencode/src/test.ts
@@
  existing line
*** End Patch`

      const patch = HarnessGenerate.extractPatchText(raw)
      expect(patch).toContain("*** Begin Patch")
      expect(patch).toContain("*** End Patch")
    })

    it("extracts patch from triple backtick block without language", () => {
      const raw = `\`\`\`
*** Begin Patch
*** Add File: packages/opencode/src/new.ts
+ new content
*** End Patch
\`\`\``

      const patch = HarnessGenerate.extractPatchText(raw)
      expect(patch).toContain("*** Begin Patch")
      expect(patch).toContain("*** Add File: packages/opencode/src/new.ts")
    })

    it("handles patch without end marker when valid format detected", () => {
      const raw = `*** Begin Patch
*** Update File: test.ts
@@
  line
*** End Patch`

      const patch = HarnessGenerate.extractPatchText(raw)
      expect(patch).toContain("*** Begin Patch")
      expect(patch).toContain("*** End Patch")
    })

    it("trims excess whitespace", () => {
      const raw = `*** Begin Patch
*** Update File: test.ts
@@
  line
*** End Patch

`

      const patch = HarnessGenerate.extractPatchText(raw)
      expect(patch.endsWith("\n")).toBe(true)
    })
  })

  describe("repairGuidance", () => {
    it("returns default guidance for unknown errors", () => {
      const guidance = HarnessGenerate.repairGuidance("some unknown error")
      expect(guidance.length).toBeGreaterThan(0)
      expect(guidance[0]).toContain("context line")
    })

    it("adds tool call guidance when relevant", () => {
      const guidance = HarnessGenerate.repairGuidance("tool call detected instead of patch")
      expect(guidance.some((g) => g.includes("tool-call") || g.includes("apply_patch body"))).toBe(true)
    })

    it("adds stale context guidance when relevant", () => {
      const guidance = HarnessGenerate.repairGuidance("Failed to find expected lines in test.ts")
      expect(guidance.some((g) => g.includes("stale") || g.includes("context"))).toBe(true)
    })

    it("adds git diff syntax guidance when relevant", () => {
      const guidance = HarnessGenerate.repairGuidance("git diff syntax error")
      expect(guidance.some((g) => g.includes("apply_patch") || g.includes("diff"))).toBe(true)
    })

    it("adds begin/end marker guidance for missing markers", () => {
      const guidance = HarnessGenerate.repairGuidance("missing Begin/End markers")
      expect(guidance.some((g) => g.includes("Begin Patch") && g.includes("End Patch"))).toBe(true)
    })

    it("adds begin/end marker guidance for contained no apply_patch hunks", () => {
      const guidance = HarnessGenerate.repairGuidance("contained no apply_patch hunks")
      expect(guidance.some((g) => g.includes("Begin Patch") && g.includes("End Patch"))).toBe(true)
    })

    it("returns multiple guidance items for compound errors", () => {
      const guidance = HarnessGenerate.repairGuidance("tool call and git diff syntax")
      expect(guidance.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("parseReviewDecision", () => {
    it("parses valid JSON review decision", () => {
      const raw = JSON.stringify({
        verdict: "approve",
        summary: "looks good",
        concerns: [],
        requiredChanges: [],
        verifyCommands: [],
      })

      const decision = HarnessGenerate.parseReviewDecision(raw)
      expect(decision.verdict).toBe("approve")
      expect(decision.summary).toBe("looks good")
      expect(decision.concerns).toEqual([])
      expect(decision.requiredChanges).toEqual([])
    })

    it("parses JSON with extra whitespace", () => {
      const raw = `

    {
      "verdict": "revise",
      "summary": "needs changes",
      "concerns": ["concern 1"],
      "requiredChanges": ["change 1"],
      "verifyCommands": ["bun test"]
    }

  `

      const decision = HarnessGenerate.parseReviewDecision(raw)
      expect(decision.verdict).toBe("revise")
      expect(decision.summary).toBe("needs changes")
      expect(decision.concerns).toEqual(["concern 1"])
      expect(decision.requiredChanges).toEqual(["change 1"])
      expect(decision.verifyCommands).toEqual(["bun test"])
    })

    it("normalizes duplicate concerns and limits count", () => {
      const raw = JSON.stringify({
        verdict: "approve",
        summary: "test",
        concerns: ["a", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"],
        requiredChanges: [],
        verifyCommands: [],
      })

      const decision = HarnessGenerate.parseReviewDecision(raw)
      // Should dedupe and limit to 12
      expect(decision.concerns.length).toBeLessThanOrEqual(12)
    })
  })

  describe("isScopeRefinementRequestedError", () => {
    it("returns true for ScopeRefinementRequestedError", () => {
      const error = new ScopeRefinementRequestedError("scope changed", ["file1.ts", "file2.ts"])
      expect(HarnessGenerate.isScopeRefinementRequestedError(error)).toBe(true)
    })

    it("returns false for regular errors", () => {
      const error = new Error("regular error")
      expect(HarnessGenerate.isScopeRefinementRequestedError(error)).toBe(false)
    })

    it("returns false for null", () => {
      expect(HarnessGenerate.isScopeRefinementRequestedError(null)).toBe(false)
    })
  })

  describe("ScopeRefinementRequestedError", () => {
    it("creates error with files array", () => {
      const error = new ScopeRefinementRequestedError("scope widened", ["a.ts", "b.ts"])
      expect(error.name).toBe("ScopeRefinementRequestedError")
      expect(error.files).toEqual(["a.ts", "b.ts"])
      expect(error.message).toContain("scope widened")
    })
  })
})
