// @ts-nocheck
import { describe, expect, test } from "bun:test"
import { extractHarnessRecoveryConfidenceCases } from "../../src/harness/recovery-confidence-case-extractor"
import type { HarnessState } from "../../src/harness/state"

function makeProposal(overrides: Partial<HarnessState.Proposal>): HarnessState.Proposal {
  return {
    id: "part_defaultproposalid000000000000",
    kind: "code_patch",
    title: "Default proposal",
    confidence: "low",
    rationale: "default rationale",
    status: "open",
    patchHint: {
      summary: "default patch",
      files: ["src/default.ts"],
    },
    ...overrides,
  }
}

function makeObservation(
  time: number,
  kind: string,
  proposalID: string,
  message: string,
  data?: Record<string, unknown>,
): HarnessState.Observation {
  return {
    time,
    source: "analyzer",
    kind,
    message,
    data: {
      proposalID,
      ...data,
    },
  }
}

describe("recovery confidence case extractor", () => {
  test("extracts confidence-promotion and timeout-retry episodes from harness observations", () => {
    const proposals: HarnessState.Proposal[] = [
      makeProposal({
        id: "part_confidencepromotion000000000",
        title: "Promote confidence after narrow evidence",
        confidence: "low",
        confidenceOverride: "medium",
        confidenceResearchStatus: "promoted",
        confidenceResearchSummary: "Research confirmed the narrow fix and promoted confidence.",
      }),
      makeProposal({
        id: "part_timeoutrecovery000000000000",
        title: "Retry a timed-out narrow step",
        confidence: "medium",
        autoStatus: "failed",
        lastAutoExecutionError: "timed out after 15000ms",
      }),
    ]

    const observations: HarnessState.Observation[] = [
      makeObservation(
        1_000,
        "proposal.confidence_retry",
        "part_confidencepromotion000000000",
        "Retrying confidence research after a startup stall",
        { attempt: 1, error: "session_start stalled" },
      ),
      makeObservation(
        2_000,
        "proposal.confidence_promoted",
        "part_confidencepromotion000000000",
        "Raised proposal confidence through research",
        { previousConfidence: "low", nextConfidence: "medium", promoted: true },
      ),
      makeObservation(
        3_000,
        "proposal.autopatch_failed",
        "part_timeoutrecovery000000000000",
        "Autopatch timed out",
        { error: "timed out after 15000ms" },
      ),
      makeObservation(
        4_000,
        "patch.generation_retry",
        "part_timeoutrecovery000000000000",
        "Retrying patch generation after timeout",
        { validationError: "timeout while waiting for verification" },
      ),
    ]

    const result = extractHarnessRecoveryConfidenceCases({
      snapshot: { proposals },
      observations,
    })

    expect(result.summary.observationCount).toBe(4)
    expect(result.summary.proposalGroupCount).toBe(2)
    expect(result.summary.candidateCount).toBe(2)
    expect(result.summary.byFamily.retrieval_confidence_quality).toBe(1)
    expect(result.summary.byFamily.retrieval_multiturn_recovery).toBe(1)
    expect(result.summary.byCategory.confidence_promotion).toBe(1)
    expect(result.summary.byCategory.timeout_retry).toBe(1)

    const byCategory = new Map(result.candidates.map((item) => [item.category, item]))
    expect(byCategory.get("confidence_promotion")?.expectedActionHint).toBe("promote_confidence")
    expect(byCategory.get("confidence_promotion")?.signals.hadConfidencePromotion).toBe(true)
    expect(byCategory.get("timeout_retry")?.expectedActionHint).toBe("rerun_narrow_step")
    expect(byCategory.get("timeout_retry")?.signals.hadTimeout).toBe(true)
    expect(byCategory.get("timeout_retry")?.signals.hadRetry).toBe(true)
  })
})
