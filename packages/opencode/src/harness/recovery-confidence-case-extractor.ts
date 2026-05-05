// @ts-nocheck
import type { HarnessState } from "./state"

type Proposal = HarnessState.Proposal
type Observation = HarnessState.Observation

export type HarnessReplayBenchmarkFamily = "retrieval_confidence_quality" | "retrieval_multiturn_recovery"

export type HarnessReplayCandidateCategory =
  | "confidence_promotion"
  | "confidence_retry"
  | "confidence_failure"
  | "timeout_retry"
  | "scope_deferred"
  | "resume_after_partial_progress"
  | "evidence_regrounding"

export type HarnessReplayCandidate = {
  id: string
  benchmarkFamily: HarnessReplayBenchmarkFamily
  category: HarnessReplayCandidateCategory
  proposalID?: string
  title: string
  detail: string
  expectedActionHint: string
  currentConfidence?: Proposal["confidence"]
  effectiveConfidence?: Proposal["confidence"]
  confidenceResearchStatus?: Proposal["confidenceResearchStatus"]
  proposalStatus?: Proposal["status"]
  autoStatus?: Proposal["autoStatus"]
  firstObservationAt?: number
  lastObservationAt?: number
  observationCount: number
  observationKinds: string[]
  observationDigest: string[]
  signals: {
    hadTimeout: boolean
    hadRetry: boolean
    hadDeferral: boolean
    hadApply: boolean
    hadConfidencePromotion: boolean
    hadConfidenceFailure: boolean
  }
}

export type HarnessReplayExtractionSummary = {
  observationCount: number
  proposalGroupCount: number
  candidateCount: number
  byFamily: Record<HarnessReplayBenchmarkFamily, number>
  byCategory: Record<HarnessReplayCandidateCategory, number>
}

export type HarnessReplayExtractionResult = {
  summary: HarnessReplayExtractionSummary
  candidates: HarnessReplayCandidate[]
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
}

function lower(input: unknown) {
  return typeof input === "string" ? input.trim().toLowerCase() : ""
}

function proposalIDFromObservation(item: Observation) {
  return typeof item.data?.proposalID === "string" && item.data.proposalID.trim() ? item.data.proposalID.trim() : undefined
}

function uniqueKinds(items: Observation[]) {
  return [...new Set(items.map((item) => item.kind))]
}

function observationDigest(items: Observation[]) {
  return items
    .slice(-6)
    .map((item) => `[${item.kind}] ${item.message}`)
}

function includesTimeout(item: Observation) {
  const message = `${lower(item.message)} ${lower(item.data?.error)} ${lower(item.data?.validationError)}`
  return message.includes("timed out") || message.includes("timeout") || message.includes("session_start")
}

function classifyEpisode(input: { proposal?: Proposal; observations: Observation[] }): {
  benchmarkFamily: HarnessReplayBenchmarkFamily
  category: HarnessReplayCandidateCategory
  expectedActionHint: string
  detail: string
} | null {
  const { proposal, observations } = input
  const kinds = uniqueKinds(observations)
  const has = (kind: string) => kinds.includes(kind)
  const hasRetry = has("patch.generation_retry") || has("proposal.confidence_retry")
  const hasConfidencePromotion = has("proposal.confidence_promoted")
  const hasConfidenceFailure = has("proposal.confidence_failed")
  const hasConfidenceResearch = has("proposal.confidence_researched")
  const hasAutopatchFailure = has("proposal.autopatch_failed")
  const hasAutopatchApplied =
    has("proposal.autopatch_applied") || has("self_edit.applied") || has("proposal.autopatch_promoted")
  const hasDeferred =
    has("proposal.autopatch_deferred") ||
    observations.some(
      (item) =>
        item.kind === "proposal.autopatch_skipped" &&
        ["foreground_active", "foreground_cooldown", "large_single_flight_active", "failure_cooldown"].includes(
          lower(item.data?.reason),
        ),
    )
  const hasTimeout = observations.some(includesTimeout)

  if (hasConfidencePromotion) {
    return {
      benchmarkFamily: "retrieval_confidence_quality",
      category: "confidence_promotion",
      expectedActionHint: "promote_confidence",
      detail:
        proposal?.confidenceResearchSummary?.trim() ||
        "real harness episode where research promoted confidence after narrower, source-backed evidence",
    }
  }

  if (hasConfidenceFailure) {
    return {
      benchmarkFamily: "retrieval_confidence_quality",
      category: "confidence_failure",
      expectedActionHint: "defer_for_more_evidence",
      detail:
        proposal?.confidenceResearchError?.trim() ||
        "real harness episode where confidence research failed and the safer next move was to defer instead of over-promoting",
    }
  }

  if (hasRetry && (hasConfidenceResearch || proposal?.confidenceResearchStatus === "promoted")) {
    return {
      benchmarkFamily: "retrieval_confidence_quality",
      category: "confidence_retry",
      expectedActionHint: "promote_confidence",
      detail:
        proposal?.confidenceResearchSummary?.trim() ||
        "real harness episode where one retry clarified the proposal enough for confidence research to succeed",
    }
  }

  if (hasTimeout && hasRetry) {
    return {
      benchmarkFamily: "retrieval_multiturn_recovery",
      category: "timeout_retry",
      expectedActionHint: "rerun_narrow_step",
      detail:
        proposal?.lastAutoExecutionError?.trim() ||
        "real harness episode where a timeout triggered a narrow retry path instead of broad replanning",
    }
  }

  if (hasDeferred) {
    return {
      benchmarkFamily: "retrieval_multiturn_recovery",
      category: "scope_deferred",
      expectedActionHint: "escalate_scope",
      detail:
        "real harness episode where autopatch work was deferred because foreground or scope conditions made the previous boundary unsafe to keep",
    }
  }

  if (hasAutopatchApplied && (hasRetry || hasAutopatchFailure)) {
    return {
      benchmarkFamily: "retrieval_multiturn_recovery",
      category: "resume_after_partial_progress",
      expectedActionHint: "resume_from_verified_state",
      detail:
        "real harness episode where work resumed from verified partial progress rather than restarting after a stall or earlier failure",
    }
  }

  if (hasAutopatchFailure) {
    return {
      benchmarkFamily: "retrieval_multiturn_recovery",
      category: "evidence_regrounding",
      expectedActionHint: "reground_from_evidence",
      detail:
        proposal?.lastAutoExecutionError?.trim() ||
        "real harness episode where conflicting evidence or validation failure required re-grounding before continuing",
    }
  }

  return null
}

function summarizeCounts<T extends string>(items: T[]): Record<T, number> {
  return items.reduce(
    (acc, item) => {
      acc[item] = (acc[item] ?? 0) + 1
      return acc
    },
    {} as Record<T, number>,
  )
}

export function extractHarnessRecoveryConfidenceCases(input: {
  snapshot: { proposals: Proposal[] }
  observations: Observation[]
  limit?: number
}): HarnessReplayExtractionResult {
  const proposalsByID = new Map(input.snapshot.proposals.map((proposal) => [proposal.id, proposal]))
  const grouped = new Map<string, Observation[]>()

  for (const item of input.observations) {
    const proposalID = proposalIDFromObservation(item)
    if (!proposalID) continue
    const existing = grouped.get(proposalID)
    if (existing) existing.push(item)
    else grouped.set(proposalID, [item])
  }

  const candidates = [...grouped.entries()]
    .map(([proposalID, observations]) => {
      const proposal = proposalsByID.get(proposalID)
      const classification = classifyEpisode({ proposal, observations })
      if (!classification) return undefined
      const kinds = uniqueKinds(observations)
      const firstObservationAt = observations[0]?.time
      const lastObservationAt = observations[observations.length - 1]?.time
      const title =
        proposal?.title ||
        `${classification.benchmarkFamily === "retrieval_confidence_quality" ? "confidence" : "recovery"} episode ${proposalID}`
      return {
        id: `${classification.category}_${slugify(title)}_${slugify(proposalID)}`,
        benchmarkFamily: classification.benchmarkFamily,
        category: classification.category,
        proposalID,
        title,
        detail: classification.detail,
        expectedActionHint: classification.expectedActionHint,
        currentConfidence: proposal?.confidence,
        effectiveConfidence: proposal ? (proposal.confidenceOverride ?? proposal.confidence) : undefined,
        confidenceResearchStatus: proposal?.confidenceResearchStatus,
        proposalStatus: proposal?.status,
        autoStatus: proposal?.autoStatus,
        firstObservationAt,
        lastObservationAt,
        observationCount: observations.length,
        observationKinds: kinds,
        observationDigest: observationDigest(observations),
        signals: {
          hadTimeout: observations.some(includesTimeout),
          hadRetry: kinds.includes("patch.generation_retry") || kinds.includes("proposal.confidence_retry"),
          hadDeferral:
            kinds.includes("proposal.autopatch_deferred") ||
            observations.some((item) => item.kind === "proposal.autopatch_skipped"),
          hadApply:
            kinds.includes("proposal.autopatch_applied") ||
            kinds.includes("self_edit.applied") ||
            kinds.includes("proposal.autopatch_promoted"),
          hadConfidencePromotion: kinds.includes("proposal.confidence_promoted"),
          hadConfidenceFailure: kinds.includes("proposal.confidence_failed"),
        },
      } satisfies HarnessReplayCandidate
    })
    .filter((item): item is HarnessReplayCandidate => !!item)
    .toSorted((a, b) => (b.lastObservationAt ?? 0) - (a.lastObservationAt ?? 0))

  const limited = input.limit && input.limit > 0 ? candidates.slice(0, input.limit) : candidates
  const familyCounts = summarizeCounts(limited.map((item) => item.benchmarkFamily))
  const categoryCounts = summarizeCounts(limited.map((item) => item.category))

  return {
    summary: {
      observationCount: input.observations.length,
      proposalGroupCount: grouped.size,
      candidateCount: limited.length,
      byFamily: {
        retrieval_confidence_quality: familyCounts.retrieval_confidence_quality ?? 0,
        retrieval_multiturn_recovery: familyCounts.retrieval_multiturn_recovery ?? 0,
      },
      byCategory: {
        confidence_promotion: categoryCounts.confidence_promotion ?? 0,
        confidence_retry: categoryCounts.confidence_retry ?? 0,
        confidence_failure: categoryCounts.confidence_failure ?? 0,
        timeout_retry: categoryCounts.timeout_retry ?? 0,
        scope_deferred: categoryCounts.scope_deferred ?? 0,
        resume_after_partial_progress: categoryCounts.resume_after_partial_progress ?? 0,
        evidence_regrounding: categoryCounts.evidence_regrounding ?? 0,
      },
    },
    candidates: limited,
  }
}
