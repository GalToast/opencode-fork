import { describe, it, expect } from "bun:test"
import { HarnessState } from "../../src/harness/state"

// Helper to generate valid proposal IDs
const makeProposalID = (suffix: string) => `prt_test${suffix}`

describe("state module", () => {
  describe("effectiveConfidence", () => {
    it("returns confidenceOverride when set", () => {
      const result = HarnessState.effectiveConfidence({
        confidence: "high",
        confidenceOverride: "low",
      })
      expect(result).toBe("low")
    })

    it("returns original confidence when no override", () => {
      const result = HarnessState.effectiveConfidence({
        confidence: "medium",
        confidenceOverride: undefined,
      })
      expect(result).toBe("medium")
    })

    it("returns original confidence when override is undefined", () => {
      const result = HarnessState.effectiveConfidence({
        confidence: "low",
        confidenceOverride: undefined,
      })
      expect(result).toBe("low")
    })
  })

  describe("type enums", () => {
    it("Source accepts valid values", () => {
      const sources: HarnessState.Source[] = ["wrapper", "runtime", "analyzer", "manual"]
      for (const source of sources) {
        expect(HarnessState.Source.parse(source)).toBe(source)
      }
    })

    it("ProposalConfidence accepts valid values", () => {
      const confidences: HarnessState.ProposalConfidence[] = ["high", "medium", "low"]
      for (const confidence of confidences) {
        expect(HarnessState.ProposalConfidence.parse(confidence)).toBe(confidence)
      }
    })

    it("ProposalKind accepts valid values", () => {
      const kinds: HarnessState.ProposalKind[] = ["config_overlay", "code_patch"]
      for (const kind of kinds) {
        expect(HarnessState.ProposalKind.parse(kind)).toBe(kind)
      }
    })

    it("ProposalStatus accepts valid values", () => {
      const statuses: HarnessState.ProposalStatus[] = ["open", "materialized", "applied", "dismissed"]
      for (const status of statuses) {
        expect(HarnessState.ProposalStatus.parse(status)).toBe(status)
      }
    })

    it("ProposalRisk accepts valid values", () => {
      const risks: HarnessState.ProposalRisk[] = ["small", "medium", "large", "core"]
      for (const risk of risks) {
        expect(HarnessState.ProposalRisk.parse(risk)).toBe(risk)
      }
    })

    it("ProposalAutonomy accepts valid values", () => {
      const autonomies: HarnessState.ProposalAutonomy[] = ["manual", "stage_only", "autonomous_overlay", "autonomous_patch"]
      for (const autonomy of autonomies) {
        expect(HarnessState.ProposalAutonomy.parse(autonomy)).toBe(autonomy)
      }
    })

    it("ProposalAutoStatus accepts valid values", () => {
      const statuses: HarnessState.ProposalAutoStatus[] = ["idle", "running", "validated", "applied", "failed", "staged"]
      for (const status of statuses) {
        expect(HarnessState.ProposalAutoStatus.parse(status)).toBe(status)
      }
    })

    it("ReviewVerdict accepts valid values", () => {
      const verdicts: HarnessState.ReviewVerdict[] = ["approve", "revise", "reject"]
      for (const verdict of verdicts) {
        expect(HarnessState.ReviewVerdict.parse(verdict)).toBe(verdict)
      }
    })
  })

  describe("Observation type", () => {
    it("validates correct observation structure", () => {
      const observation = {
        time: Date.now(),
        source: "analyzer" as const,
        kind: "test.kind",
        message: "Test message",
        data: { key: "value" },
      }

      const result = HarnessState.Observation.safeParse(observation)
      expect(result.success).toBe(true)
    })

    it("rejects observation with invalid source", () => {
      const observation = {
        time: Date.now(),
        source: "invalid_source",
        kind: "test.kind",
        message: "Test message",
      }

      const result = HarnessState.Observation.safeParse(observation)
      expect(result.success).toBe(false)
    })
  })

  describe("Proposal type", () => {
    it("validates minimal valid proposal", () => {
      const proposal = {
        id: makeProposalID("001"),
        kind: "code_patch" as const,
        title: "Test",
        confidence: "medium" as const,
        rationale: "Test rationale",
        status: "open" as const,
      }

      const result = HarnessState.Proposal.safeParse(proposal)
      expect(result.success).toBe(true)
    })

    it("validates proposal with all optional fields", () => {
      const proposal = {
        id: makeProposalID("002"),
        kind: "code_patch",
        title: "Test",
        confidence: "high",
        rationale: "Test rationale",
        status: "open",
        risk: "small",
        autonomy: "autonomous_patch",
        riskReasons: ["reason 1"],
        expectedFiles: ["file1.ts"],
        sensitivePaths: ["secret"],
        maxFiles: 5,
        maxChangedLines: 100,
        allowMove: true,
        allowDelete: false,
        requirePriorValidation: true,
        overlay: { key: "value" },
        patchHint: {
          summary: "test summary",
          files: ["test.ts"],
        },
      }

      const result = HarnessState.Proposal.safeParse(proposal)
      expect(result.success).toBe(true)
    })

    it("rejects proposal with invalid id format (not starting with prt_)", () => {
      const proposal = {
        id: "test-proposal-1",
        kind: "code_patch",
        title: "Test",
        confidence: "medium",
        rationale: "Test rationale",
        status: "open",
      }

      const result = HarnessState.Proposal.safeParse(proposal)
      expect(result.success).toBe(false)
    })

    it("rejects proposal with invalid kind", () => {
      const proposal = {
        id: makeProposalID("003"),
        kind: "invalid_kind",
        title: "Test",
        confidence: "medium",
        rationale: "Test rationale",
        status: "open",
      }

      const result = HarnessState.Proposal.safeParse(proposal)
      expect(result.success).toBe(false)
    })

    it("rejects proposal with invalid confidence", () => {
      const proposal = {
        id: makeProposalID("004"),
        kind: "code_patch",
        title: "Test",
        confidence: "invalid",
        rationale: "Test rationale",
        status: "open",
      }

      const result = HarnessState.Proposal.safeParse(proposal)
      expect(result.success).toBe(false)
    })

    it("accepts config_overlay kind", () => {
      const proposal = {
        id: makeProposalID("005"),
        kind: "config_overlay",
        title: "Test",
        confidence: "medium",
        rationale: "Test rationale",
        status: "open",
      }

      const result = HarnessState.Proposal.safeParse(proposal)
      expect(result.success).toBe(true)
    })
  })
})
