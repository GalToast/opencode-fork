import {
  compactAttentionPrecedent,
  extractAttentionAvoidPrecedent,
  extractAttentionResolutionPrecedent,
  recommendedMoveFromAttentionPrecedent,
  type TaskAttentionMove,
} from "./semantic-precedent"

export type TaskAttentionSummary = {
  priority: "urgent" | "high" | "normal" | "low"
  summary: string
  contradictions: string[]
  confidence?: "low" | "medium" | "high"
  trustBasis?: string
  resolutionHint?: string
  recommendedMove?: TaskAttentionMove
}

export type TaskAttentionSignals = {
  contradictions: string[]
  semanticContradictions: string[]
  schedulerContradictions: string[]
  notes: string[]
}

export function buildTaskAttentionOverview(input: {
  contradictions: string[]
  notes: string[]
  failedChildrenCount: number
  activeChildrenCount: number
  completedChildrenCount: number
  compact: (text?: string) => string | undefined
}) {
  const priority =
    input.contradictions.length > 0 || input.failedChildrenCount > 0
      ? ("urgent" as const)
      : input.notes.some((note) => /review pending|recovery attention needed|blocked requirement/.test(note))
        ? ("high" as const)
        : input.activeChildrenCount > 0 || input.completedChildrenCount > 0
          ? ("normal" as const)
          : ("low" as const)

  const summary = input.compact(
    [
      input.contradictions.length > 0 ? `contradictions=${input.contradictions.length}` : undefined,
      ...input.notes,
    ]
      .filter(Boolean)
      .join(" | "),
  )

  return {
    priority,
    summary: summary ?? input.contradictions[0] ?? input.notes[0] ?? "attention needed",
  }
}

export function deriveTaskAttentionSignals(input: {
  jobStatus: "queued" | "running" | "completed" | "error" | "canceled"
  activeChildrenCount: number
  failedChildrenCount: number
  completedChildrenCount: number
  completedArtifactCount: number
  artifactTypes: string[]
  normalizedSummaries: string[]
  expectedArtifact?: string
  orchestrationRecallSummary?: string
  reviewStatus?: "idle" | "queued" | "running" | "completed"
  paused?: boolean
  queuedTurns: number
  blockedDependencyCount: number
  checkpointState?: string
  pendingReviewTaskID?: string
  heartbeatState?: "idle" | "fresh" | "stale"
  recoveryAdvisorSummary?: string
}): TaskAttentionSignals {
  const contradictions = [] as string[]
  const semanticContradictions = [] as string[]
  const schedulerContradictions = [] as string[]
  const notes = [] as string[]

  if ((input.jobStatus === "completed" || input.jobStatus === "error" || input.jobStatus === "canceled") && input.activeChildrenCount > 0) {
    const line = `parent_settled_with_${input.activeChildrenCount}_active_child`
    contradictions.push(line)
    schedulerContradictions.push(line)
  }
  if (input.checkpointState === "waiting_on_children" && input.activeChildrenCount === 0) {
    contradictions.push("checkpoint_waiting_without_active_children")
    schedulerContradictions.push("checkpoint_waiting_without_active_children")
  }
  if (input.checkpointState === "awaiting_review" && !input.pendingReviewTaskID) {
    contradictions.push("awaiting_review_without_pending_review_task")
    schedulerContradictions.push("awaiting_review_without_pending_review_task")
  }
  if (input.blockedDependencyCount > 0 && input.queuedTurns > 0) {
    contradictions.push("running_while_marked_blocked_on_requirements")
    schedulerContradictions.push("running_while_marked_blocked_on_requirements")
  }
  if (input.artifactTypes.length > 1) {
    const line = `semantic_child_artifact_type_conflict:${input.artifactTypes.join("_vs_")}`
    contradictions.push(line)
    semanticContradictions.push(line)
  }
  if (input.artifactTypes.length === 1 && input.normalizedSummaries.length > 1 && input.completedArtifactCount > 1) {
    contradictions.push("semantic_child_summary_divergence")
    semanticContradictions.push("semantic_child_summary_divergence")
  }
  if (input.expectedArtifact && input.artifactTypes.length > 0 && input.artifactTypes.some((type) => type !== input.expectedArtifact)) {
    const line = `child_artifact_vs_parent_expectation:${input.expectedArtifact}`
    contradictions.push(line)
    semanticContradictions.push(line)
  }
  const orchestrationRecallSummary = input.orchestrationRecallSummary
  if (
    orchestrationRecallSummary &&
    /patch|fact|summary|critique|warning|draft/i.test(orchestrationRecallSummary) &&
    input.artifactTypes.length > 0 &&
    !input.artifactTypes.some((type) => new RegExp(`\\b${type}\\b`, "i").test(orchestrationRecallSummary))
  ) {
    contradictions.push("child_artifact_vs_orchestration_recall")
    semanticContradictions.push("child_artifact_vs_orchestration_recall")
  }

  if (input.failedChildrenCount > 0) notes.push(`${input.failedChildrenCount} child failure${input.failedChildrenCount === 1 ? "" : "s"}`)
  if (input.activeChildrenCount > 0 && input.completedChildrenCount > 0) notes.push(`mixed child state ${input.completedChildrenCount} done/${input.activeChildrenCount} active`)
  if (input.artifactTypes.length > 1) notes.push(`children diverged on artifact type ${input.artifactTypes.join(" vs ")}`)
  else if (input.normalizedSummaries.length > 1 && input.completedArtifactCount > 1) notes.push("children diverged on artifact summary")
  if (input.reviewStatus === "queued" || input.reviewStatus === "running") notes.push("review pending")
  if (input.paused && input.queuedTurns > 0) notes.push("queued work while paused")
  if (input.recoveryAdvisorSummary && input.heartbeatState === "stale") notes.push("recovery attention needed")
  if (input.blockedDependencyCount > 0) notes.push(`${input.blockedDependencyCount} blocked requirement${input.blockedDependencyCount === 1 ? "" : "s"}`)

  return {
    contradictions,
    semanticContradictions,
    schedulerContradictions,
    notes,
  }
}

export function finalizeTaskAttentionDecision(input: {
  contradictions: string[]
  semanticContradictions: string[]
  schedulerContradictions: string[]
  failedChildrenCount: number
  activeChildrenCount: number
  completedChildrenCount: number
  completedArtifactCount: number
  artifactTypes: string[]
  notes: string[]
  expectedArtifact?: string
  orchestrationRecallSummary?: string
  recoveryAdvisorSummary?: string
  compact: (text?: string) => string | undefined
}) {
  const highSemanticEvidence =
    input.semanticContradictions.length > 0 &&
    (input.completedArtifactCount > 1 ||
      input.contradictions.some((item) => item.startsWith("child_artifact_vs_parent_expectation:")) ||
      input.contradictions.includes("child_artifact_vs_orchestration_recall"))

  const confidence =
    highSemanticEvidence
      ? ("high" as const)
      : input.semanticContradictions.length > 0 || input.schedulerContradictions.length > 0 || input.failedChildrenCount > 0
        ? ("medium" as const)
        : ("low" as const)

  const trustBasis = input.compact(
    highSemanticEvidence
      ? [
          input.completedArtifactCount > 1 ? `semantic evidence from ${input.completedArtifactCount} completed children` : undefined,
          input.contradictions.some((item) => item.startsWith("child_artifact_vs_parent_expectation:")) ? "parent contract mismatch" : undefined,
          input.contradictions.includes("child_artifact_vs_orchestration_recall") ? "orchestration recall mismatch" : undefined,
        ]
          .filter(Boolean)
          .join(" | ")
      : input.semanticContradictions.length > 0
        ? "semantic divergence detected with limited corroboration"
        : input.schedulerContradictions.length > 0 || input.failedChildrenCount > 0
          ? "runtime-state conflict signals only"
          : "light scheduler-state cues only",
  )

  const learnedPrecedent = extractAttentionResolutionPrecedent(input.orchestrationRecallSummary, input.recoveryAdvisorSummary)
  const learnedAvoidPrecedent = extractAttentionAvoidPrecedent(input.orchestrationRecallSummary, input.recoveryAdvisorSummary)
  const precedentRecommendedMove = recommendedMoveFromAttentionPrecedent(learnedPrecedent)

  const withPrecedent = (hint: string) =>
    input.compact(
      [
        hint,
        learnedPrecedent ? `Precedent: ${compactAttentionPrecedent(learnedPrecedent, "positive")}` : undefined,
        learnedAvoidPrecedent ? `Avoid: ${compactAttentionPrecedent(learnedAvoidPrecedent, "negative")}` : undefined,
      ]
        .filter(Boolean)
        .join(" "),
    )

  const resolutionHint = (() => {
    if (input.contradictions.some((item) => item.startsWith("semantic_child_artifact_type_conflict:"))) {
      return withPrecedent(
        `Children landed different artifact types (${input.artifactTypes.join(" vs ")}). Compare the strongest completed child artifacts before choosing one merge direction.`,
      )
    }
    if (input.contradictions.includes("semantic_child_summary_divergence")) {
      return withPrecedent("Children agree on artifact type but diverge semantically. Ask for reconciliation or compare summaries before merging.")
    }
    if (input.contradictions.some((item) => item.startsWith("child_artifact_vs_parent_expectation:"))) {
      return withPrecedent(`Child output conflicts with the parent expected artifact (${input.expectedArtifact}). Steer or merge toward the parent contract explicitly.`)
    }
    if (input.contradictions.includes("child_artifact_vs_orchestration_recall")) {
      return withPrecedent("Child output conflicts with orchestration recall. Re-check the durable constraint before preferring a branch.")
    }
    if (input.contradictions.some((item) => item.startsWith("parent_settled_with_"))) {
      return withPrecedent("Parent looks settled while child work is still active. Decide whether to archive the parent later or explicitly retire the remaining child branch.")
    }
    if (input.failedChildrenCount > 0) {
      return withPrecedent("At least one child branch failed. Inspect the failed child before trusting the surviving branch.")
    }
    if (input.activeChildrenCount > 0 && input.completedChildrenCount > 0) {
      return withPrecedent("Some child work is done while other child work is still active. Wait if the active branch still matters; otherwise message or retire it.")
    }
    if (input.notes.some((note) => note === "review pending")) {
      return withPrecedent("A review branch is pending. Wait for review or inspect it before settling the parent.")
    }
    if (input.notes.some((note) => /blocked requirement/.test(note))) {
      return withPrecedent("The branch is blocked on requirements. Message the child with the missing requirement or resolve the dependency first.")
    }
    return undefined
  })()

  const baselineRecommendedMove =
    input.contradictions.some((item) => item.startsWith("semantic_child_")) || input.contradictions.includes("child_artifact_vs_orchestration_recall")
      ? ("review" as const)
      : input.contradictions.some((item) => item.startsWith("child_artifact_vs_parent_expectation:")) || input.contradictions.some((item) => item.startsWith("parent_settled_with_")) || input.failedChildrenCount > 0
        ? ("message" as const)
        : input.activeChildrenCount > 0 && input.completedChildrenCount > 0
          ? ("wait" as const)
          : input.completedChildrenCount > 1
            ? ("merge" as const)
            : undefined

  const recommendedMove =
    precedentRecommendedMove &&
    (
      input.contradictions.some((item) => item.startsWith("semantic_child_")) ||
      input.contradictions.includes("child_artifact_vs_orchestration_recall") ||
      input.contradictions.some((item) => item.startsWith("child_artifact_vs_parent_expectation:")) ||
      input.failedChildrenCount > 0
    )
      ? precedentRecommendedMove
      : baselineRecommendedMove

  return {
    confidence,
    trustBasis,
    resolutionHint,
    recommendedMove,
  }
}
