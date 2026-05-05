import type { RetrievalChunkCandidate } from "@/retrieval"

export type TaskAttentionMove = "wait" | "message" | "review" | "merge"

type ConflictFamily =
  | "artifact_type_conflict"
  | "summary_divergence"
  | "parent_contract_conflict"
  | "orchestration_recall_conflict"
  | "general_attention_conflict"

function conflictFamilyFromContradictions(contradictionLine: string): ConflictFamily {
  if (/semantic_child_artifact_type_conflict:/i.test(contradictionLine)) return "artifact_type_conflict"
  if (/semantic_child_summary_divergence/i.test(contradictionLine)) return "summary_divergence"
  if (/child_artifact_vs_parent_expectation:/i.test(contradictionLine)) return "parent_contract_conflict"
  if (/child_artifact_vs_orchestration_recall/i.test(contradictionLine)) return "orchestration_recall_conflict"
  return "general_attention_conflict"
}

function conflictLabel(conflictFamily: ConflictFamily) {
  switch (conflictFamily) {
    case "artifact_type_conflict":
      return "divergent child artifact conflicts"
    case "summary_divergence":
      return "divergent child summary conflicts"
    case "parent_contract_conflict":
      return "parent-contract conflicts"
    case "orchestration_recall_conflict":
      return "orchestration-recall conflicts"
    default:
      return "similar attention conflicts"
  }
}

function describeConflictAction(input: { key: string; kind: "resolved" | "avoid"; count: number }) {
  const [family, action] = input.key.split(":") as [ConflictFamily, TaskAttentionMove]
  const label = conflictLabel(family)
  if (input.kind === "avoid") return `avoid ${action} for ${label} (${input.count}x)`
  return `${action} resolved ${label} (${input.count}x)`
}

export function summarizeAttentionLearnedResolution(
  candidates: RetrievalChunkCandidate[],
  compact: (text?: string) => string | undefined,
) {
  const positiveCounts = new Map<string, number>()
  const negativeCounts = new Map<string, number>()
  let strongConflicts = 0
  for (const candidate of candidates) {
    const provenance = (candidate.metadata?.provenance as Record<string, unknown>) ?? {}
    const kind = typeof provenance.kind === "string" ? provenance.kind : undefined
    const text = [candidate.title, candidate.content].filter(Boolean).join("\n")
    const isAttentionOutcome = kind === "task_attention_outcome" || /^Task attention outcome\b/im.test(text)
    if (!isAttentionOutcome) continue
    const actionMatch = text.match(/^attention_resolution_action:\s*(wait|message|review|merge)\b/im)
    const confidenceMatch = text.match(/^attention_confidence:\s*(low|medium|high)\b/im)
    const contradictionLine = text.match(/^attention_contradictions:\s*(.+)$/im)?.[1] ?? ""
    const family = conflictFamilyFromContradictions(contradictionLine)
    if (confidenceMatch?.[1] === "high") strongConflicts += 1
    const action = actionMatch?.[1] as TaskAttentionMove | undefined
    if (!action) continue
    const key = `${family}:${action}`
    const outcomeMatch = text.match(/^outcome:\s*(success|failure|partial)\b/im)
    const outcome = outcomeMatch?.[1] ?? (((candidate.metadata?.outcomeScore as number) ?? 0) < 0 ? "failure" : "success")
    if (outcome === "failure") negativeCounts.set(key, (negativeCounts.get(key) ?? 0) + 1)
    else positiveCounts.set(key, (positiveCounts.get(key) ?? 0) + 1)
  }

  if (positiveCounts.size === 0 && negativeCounts.size === 0) return undefined
  const [bestPositiveKey, bestPositiveCount] = [...positiveCounts.entries()].toSorted((a, b) => b[1] - a[1])[0] ?? []
  const [bestNegativeKey, bestNegativeCount] = [...negativeCounts.entries()].toSorted((a, b) => b[1] - a[1])[0] ?? []
  const parts = [] as string[]
  if (bestPositiveKey && bestPositiveCount) parts.push(describeConflictAction({ key: bestPositiveKey, kind: "resolved", count: bestPositiveCount }))
  if (bestNegativeKey && bestNegativeCount) parts.push(describeConflictAction({ key: bestNegativeKey, kind: "avoid", count: bestNegativeCount }))
  if (parts.length === 0) return undefined
  return compact(
    [
      ...parts,
      strongConflicts > 0 ? `high_conflict_examples=${strongConflicts}` : undefined,
    ]
      .filter(Boolean)
      .join(" | "),
  )
}

export function extractAttentionResolutionPrecedent(...summaries: Array<string | undefined>) {
  for (const summary of summaries) {
    if (!summary) continue
    const match = summary.match(
      /\b((?:message|review|merge|wait) resolved (?:divergent child artifact conflicts|divergent child summary conflicts|parent-contract conflicts|orchestration-recall conflicts|similar attention conflicts)(?: \(\d+x\))?)/i,
    )
    if (match?.[1]) return match[1]
  }
  return undefined
}

export function extractAttentionAvoidPrecedent(...summaries: Array<string | undefined>) {
  for (const summary of summaries) {
    if (!summary) continue
    const match = summary.match(
      /\b(avoid (?:message|review|merge|wait) for (?:divergent child artifact conflicts|divergent child summary conflicts|parent-contract conflicts|orchestration-recall conflicts|similar attention conflicts)(?: \(\d+x\))?)/i,
    )
    if (match?.[1]) return match[1]
  }
  return undefined
}

export function recommendedMoveFromAttentionPrecedent(precedent?: string): TaskAttentionMove | undefined {
  if (!precedent) return undefined
  const normalized = precedent.toLowerCase()
  if (normalized.includes("review resolved")) return "review"
  if (normalized.includes("message resolved")) return "message"
  if (normalized.includes("merge resolved")) return "merge"
  if (normalized.includes("wait resolved")) return "wait"
  return undefined
}

export function compactAttentionPrecedent(precedent?: string, mode: "positive" | "negative" = "positive") {
  if (!precedent) return undefined
  const normalized = precedent.toLowerCase()
  const move =
    normalized.includes("review")
      ? "review"
      : normalized.includes("message")
        ? "message"
        : normalized.includes("merge")
          ? "merge"
          : normalized.includes("wait")
            ? "wait"
            : undefined
  if (!move) return precedent
  if (mode === "negative") return `avoid ${move}`
  return `${move} worked before`
}
