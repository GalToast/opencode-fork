import type { RetrievalPolicyConfig, RetrievalPolicyName } from "./policy"

export type RetrievalIntent = "file" | "compaction" | "decision" | "recovery" | "task_pattern" | "evidence" | "general"

export type RetrievalIntentRoutingConfidence = "low" | "medium" | "high"

export type RetrievalRoutingStrategy = "single_intent" | "dual_intent_blend"

export type RetrievalIntentAnalysis = {
  intent: RetrievalIntent
  primaryIntent: RetrievalIntent
  secondaryIntent?: RetrievalIntent
  confidence: RetrievalIntentRoutingConfidence
  strategy: RetrievalRoutingStrategy
}

export type PromptPresetName =
  | "memory.decision"
  | "memory.failure"
  | "memory.evidence"
  | "memory.task_pattern"
  | "memory.code"
  | "memory.compaction"

const FILE_KEYWORDS = [
  "which file owns",
  "what file owns",
  "file owns",
  "which file actually",
  "owner file",
  "exact owner file",
  "file path",
  "module owner",
]

const COMPACTION_KEYWORDS = [
  "compaction",
  "compacted",
  "keep alive",
  "keep the",
  "alive when this gets compacted",
  "alive through compaction",
]

const DECISION_KEYWORDS = [
  "what was the",
  "what exactly",
  "what decision",
  "rule again",
  "rule about",
  "rule made",
  "governing decision",
  "governing facts",
  "settled constraints",
  "decision to",
  "decision did it preserve",
  "defines",
  "exactly defines",
  "what exactly defines",
  "had the rule",
]

const RECOVERY_KEYWORDS = [
  "fallback bug",
  "what fixed it",
  "where did we fix",
  "how we fixed it",
  "regression",
  "diverged",
  "recovery",
  "degraded mode",
  "recall tell the truth",
  "made recall",
  "had that fallback bug",
  "fix stale chunk",
]

const TASK_PATTERN_KEYWORDS = [
  "show the pattern",
  "pattern for",
  "task pattern",
  "production pattern",
  "execution pattern",
  "benchmark first then production pattern",
  "finding the right",
  "patch first",
  "orchard relay",
]

const EVIDENCE_KEYWORDS = [
  "verified evidence",
  "source anchors",
  "trust basis",
  "support the current retrieval",
]

export function classifyRetrievalIntent(input: { query: string; detail?: string }): RetrievalIntent {
  const query = `${input.query} ${input.detail ?? ""}`.toLowerCase()

  if (FILE_KEYWORDS.some((kw) => query.includes(kw))) {
    return "file"
  }

  if (COMPACTION_KEYWORDS.some((kw) => query.includes(kw))) {
    return "compaction"
  }

  if (EVIDENCE_KEYWORDS.some((kw) => query.includes(kw))) {
    return "evidence"
  }

  if (RECOVERY_KEYWORDS.some((kw) => query.includes(kw))) {
    return "recovery"
  }

  if (TASK_PATTERN_KEYWORDS.some((kw) => query.includes(kw))) {
    return "task_pattern"
  }

  if (DECISION_KEYWORDS.some((kw) => query.includes(kw))) {
    return "decision"
  }

  return "general"
}

function checkDualIntent(query: string, detail?: string): { isDual: boolean; primary: RetrievalIntent; secondary: RetrievalIntent } {
  const lowerQuery = `${query} ${detail ?? ""}`.toLowerCase()

  const fileMatch = FILE_KEYWORDS.some((kw) => lowerQuery.includes(kw))
  const recoveryMatch = RECOVERY_KEYWORDS.some((kw) => lowerQuery.includes(kw))
  const taskPatternMatch = TASK_PATTERN_KEYWORDS.some((kw) => lowerQuery.includes(kw))
  const decisionMatch = DECISION_KEYWORDS.some((kw) => lowerQuery.includes(kw))
  const fallbackMatch = lowerQuery.includes("fallback")
  const diagnosticMatch = lowerQuery.includes("diagnostic")

  if (fileMatch && (fallbackMatch || diagnosticMatch || recoveryMatch)) {
    return { isDual: true, primary: "file", secondary: "recovery" }
  }

  if (taskPatternMatch && decisionMatch) {
    return { isDual: true, primary: "task_pattern", secondary: "decision" }
  }

  return { isDual: false, primary: "general", secondary: "general" }
}

export function analyzeRetrievalIntent(input: { query: string; detail?: string }): RetrievalIntentAnalysis {
  const { query, detail } = input
  const intent = classifyRetrievalIntent({ query, detail })
  const dualIntent = checkDualIntent(query, detail)

  if (dualIntent.isDual) {
    return {
      intent: dualIntent.primary,
      primaryIntent: dualIntent.primary,
      secondaryIntent: dualIntent.secondary,
      confidence: "low",
      strategy: "dual_intent_blend",
    }
  }

  return {
    intent,
    primaryIntent: intent,
    confidence: intent === "general" ? "medium" : "high",
    strategy: "single_intent",
  }
}

export function routeRetrievalPolicyByIntent(input: {
  policy: RetrievalPolicyConfig
  query: string
  detail?: string
}): RetrievalPolicyConfig {
  const { policy, query, detail } = input

  if (policy.name !== "auto") {
    return policy
  }

  const intent = classifyRetrievalIntent({ query, detail })
  const dualIntent = checkDualIntent(query, detail)

  const metadataDefaults = {
    strategy: policy.metadata?.strategy ?? "matched_pair",
    indexSpace: policy.metadata?.indexSpace ?? "unknown",
  }

  const result: RetrievalPolicyConfig = {
    name: policy.name,
    embedder: policy.embedder ? { ...policy.embedder } : undefined,
    reranker: policy.reranker ? { ...policy.reranker } : undefined,
    metadata: {
      ...metadataDefaults,
      ...policy.metadata,
      routingMode: "intent_router",
      routingApplied: true,
      routedIntent: intent,
      routingConfidence: intent === "general" ? "medium" : "high",
      routingStrategy: "single_intent",
    },
  }

  if (dualIntent.isDual) {
    result.metadata = {
      ...metadataDefaults,
      ...result.metadata,
      routingConfidence: "low",
      routingStrategy: "dual_intent_blend",
      routedIntentSecondary: dualIntent.secondary,
    }

    const primaryPreset = getIntentPreset(dualIntent.primary)
    const secondaryPreset = getIntentPreset(dualIntent.secondary)
    const primaryInstruction = getRetrievalPromptPreset(primaryPreset)
    const secondaryInstruction = getRetrievalPromptPreset(secondaryPreset)

    const blendInstruction = `Ambiguous retrieval query between ${dualIntent.primary} and ${dualIntent.secondary}
Primary ${dualIntent.primary}: ${primaryInstruction}
Secondary ${dualIntent.secondary}: ${secondaryInstruction}`

    if (result.embedder) {
      result.embedder = {
        ...result.embedder,
        instruction: blendInstruction,
      }
    }

    if (result.reranker) {
      result.reranker = {
        ...result.reranker,
        instruction: blendInstruction,
      }
    }
  } else {
    const preset = getIntentPreset(intent)
    const instruction = getRetrievalPromptPreset(preset)

    if (intent === "file") {
      result.metadata = {
        ...metadataDefaults,
        ...result.metadata,
        baseEmbedderInstructionPreset: "memory.task_pattern",
        baseRerankerInstructionPreset: "memory.decision",
      }

      if (result.embedder) {
        result.embedder = {
          ...result.embedder,
          instruction: instruction,
        }
      }

      if (result.reranker) {
        result.reranker = {
          ...result.reranker,
          instruction: getRetrievalPromptPreset("memory.decision"),
        }
      }
    } else if (intent !== "general") {
      result.metadata = {
        ...metadataDefaults,
        ...result.metadata,
        baseEmbedderInstructionPreset: preset,
        baseRerankerInstructionPreset: preset,
      }

      if (result.embedder) {
        result.embedder = {
          ...result.embedder,
          instructionPreset: preset,
          instruction: instruction,
        }
      }

      if (result.reranker) {
        result.reranker = {
          ...result.reranker,
          instructionPreset: preset,
          instruction: instruction,
        }
      }
    }
  }

  return result
}

function getIntentPreset(intent: RetrievalIntent): PromptPresetName {
  switch (intent) {
    case "file":
      return "memory.code"
    case "compaction":
      return "memory.compaction"
    case "decision":
      return "memory.decision"
    case "recovery":
      return "memory.failure"
    case "task_pattern":
      return "memory.task_pattern"
    case "evidence":
      return "memory.evidence"
    case "general":
      return "memory.code"
  }
}

export function getRetrievalPromptPreset(name: PromptPresetName): string {
  const presets: Record<PromptPresetName, string> = {
    "memory.decision":
      "Retrieve exact file or module that contains the governing decision, rule, or constraint. Prioritize sources that define settled constraints, architectural decisions, or governing facts that support the current plan.",

    "memory.failure":
      "Retrieve sources documenting failure modes, bugs, degraded behavior, and their fixes. Focus on what broke, why it broke, and what rule or fix resolved the issue.",

    "memory.evidence":
      "Retrieve verified evidence, source anchors, and trust basis that support retrieval-first continuity plans. Prioritize sources with concrete verification, test outcomes, or validated constraints.",

    "memory.task_pattern":
      "Retrieve patterns for finding the right patch first, then the right file to touch. Focus on step-by-step task patterns, diagnostic workflows, and patch-first strategies.",

    "memory.code":
      "Retrieve exact file paths, module ownership, and code structure. Prioritize sources that identify which file owns specific functionality or contains specific rules.",

    "memory.compaction":
      "Retrieve sources that must be kept alive through compaction. Focus on critical notes, index space rules, owner notes, and constraints that should survive summarization.",
  }

  return presets[name]
}

export function resolveRetrievalInstruction(input: { preset: PromptPresetName }): string {
  return getRetrievalPromptPreset(input.preset)
}
