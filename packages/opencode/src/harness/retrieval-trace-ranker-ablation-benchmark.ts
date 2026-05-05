// @ts-nocheck
import { RetrievalPolicy } from "@/retrieval/policy"
import {
  analyzeRetrievalIntent,
  getRetrievalPromptPreset,
  resolveRetrievalInstruction,
  routeRetrievalPolicyByIntent,
  type RetrievalIntentRoutingConfidence,
} from "@/retrieval/prompt"
import type { RetrievalTraceCandidate } from "@/retrieval/types"
import {
  loadRetrievalTraceReplayScenarios,
  type RetrievalTraceReplayIntent,
  type RetrievalTraceReplayScenario,
} from "./retrieval-trace-replay-benchmark"

export type RetrievalTraceRankerAblationVariant = {
  id: string
  label: string
  scoring: "lexical_only" | "retrieval_base" | "hybrid_no_feedback" | "hybrid_no_outcome" | "hybrid_current" | "intent_aware_current"
}

export type RetrievalTraceRankerAblationScenarioResult = {
  scenarioID: string
  expectedIntent: RetrievalTraceReplayIntent
  variantID: string
  primaryIntent?: RetrievalTraceReplayIntent
  secondaryIntent?: RetrievalTraceReplayIntent
  routingConfidence?: RetrievalIntentRoutingConfidence
  routingStrategy?: "single_intent" | "dual_intent_blend"
  replayTopDocumentID?: string
  correctDocumentRank?: number
  reciprocalRank: number
  topDocumentReplayMatch: boolean
}

export type RetrievalTraceRankerAblationVariantResult = {
  id: string
  label: string
  scenarioCount: number
  topDocumentReplayAccuracy: number
  meanReciprocalRank: number
  averageCorrectDocumentRank: number
  categorySummary: Array<{
    category: RetrievalTraceReplayIntent
    scenarioCount: number
    topDocumentReplayAccuracy: number
    meanReciprocalRank: number
  }>
  results: RetrievalTraceRankerAblationScenarioResult[]
}

export type RetrievalTraceRankerAblationBenchmarkResult = {
  suite: "retrieval_trace_ranker_ablation"
  scenarioCount: number
  variantCount: number
  variants: RetrievalTraceRankerAblationVariantResult[]
  overallWinner: {
    id: string
    topDocumentReplayAccuracy: number
    meanReciprocalRank: number
    averageCorrectDocumentRank: number
  }
}

const intents: RetrievalTraceReplayIntent[] = ["decision", "recovery", "task_pattern", "file", "compaction"]

export const DEFAULT_RETRIEVAL_TRACE_RANKER_ABLATION_VARIANTS: RetrievalTraceRankerAblationVariant[] = [
  { id: "lexical_only", label: "lexical only", scoring: "lexical_only" },
  { id: "retrieval_base", label: "retrieval base", scoring: "retrieval_base" },
  { id: "hybrid_no_feedback", label: "hybrid no feedback", scoring: "hybrid_no_feedback" },
  { id: "hybrid_no_outcome", label: "hybrid no outcome", scoring: "hybrid_no_outcome" },
  { id: "hybrid_current", label: "hybrid current", scoring: "hybrid_current" },
  { id: "intent_aware_current", label: "intent aware current", scoring: "intent_aware_current" },
]

type RoutingContext = {
  primaryIntent?: RetrievalTraceReplayIntent
  secondaryIntent?: RetrievalTraceReplayIntent
  routingConfidence?: RetrievalIntentRoutingConfidence
  routingStrategy?: "single_intent" | "dual_intent_blend"
  embedderIntent?: RetrievalTraceReplayIntent
  rerankerIntent?: RetrievalTraceReplayIntent
}

function normalizeToken(token: string) {
  return token.toLowerCase().replace(/[^a-z0-9._-]+/g, "")
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 1)
}

function lexicalOverlap(query: string, candidate: RetrievalTraceCandidate) {
  const haystack = new Set(tokenize(`${candidate.title ?? ""} ${candidate.snippet}`))
  return tokenize(query).reduce((sum, term) => sum + (haystack.has(term) ? 1 : 0), 0)
}

function candidateIntent(candidate: RetrievalTraceCandidate): RetrievalTraceReplayIntent | undefined {
  const analysis = analyzeRetrievalIntent({
    query: `${candidate.title ?? ""} ${candidate.snippet}`.trim(),
  })
  return analysis.primaryIntent as RetrievalTraceReplayIntent | undefined
}

function instructionIntent(input: { preset?: string; instruction?: string }) {
  if (input.preset === "memory.failure") return "recovery"
  if (input.preset === "memory.compaction") return "compaction"
  if (input.preset === "memory.task_pattern") return "task_pattern"
  if (input.preset === "memory.decision") return "decision"
  if (input.preset === "memory.code") return "file"
  const resolved = (input.preset ? getRetrievalPromptPreset(input.preset as never) : resolveRetrievalInstruction({
    instructionPreset: input.preset,
    instruction: input.instruction,
  }))?.toLowerCase()
  if (!resolved) return undefined
  if (/\b(decision|constraint|default|compatibility|settled|index-space)\b/.test(resolved)) return "decision"
  if (/\b(failure|recover|recovery|fallback|regression|degraded)\b/.test(resolved)) return "recovery"
  if (/\b(pattern|bounded|decomposition|execution plan|reusable)\b/.test(resolved)) return "task_pattern"
  if (/\b(file|module|symbol|location|ownership|owner)\b/.test(resolved)) return "file"
  if (/\b(compaction|retention|identifier|anchor|durable fact|filename|survive compaction|survival value)\b/.test(resolved))
    return "compaction"
  return undefined
}

function buildRoutingContext(scenario: RetrievalTraceReplayScenario): RoutingContext {
  const basePolicy = RetrievalPolicy.resolve("auto")
  const resolvedPolicy = routeRetrievalPolicyByIntent({
    policy: basePolicy,
    query: scenario.query,
    detail: scenario.detail,
  })

  return {
    primaryIntent:
      resolvedPolicy.metadata?.routedIntent && intents.includes(resolvedPolicy.metadata.routedIntent as RetrievalTraceReplayIntent)
        ? (resolvedPolicy.metadata.routedIntent as RetrievalTraceReplayIntent)
        : undefined,
    secondaryIntent:
      resolvedPolicy.metadata?.routedIntentSecondary &&
      intents.includes(resolvedPolicy.metadata.routedIntentSecondary as RetrievalTraceReplayIntent)
        ? (resolvedPolicy.metadata.routedIntentSecondary as RetrievalTraceReplayIntent)
        : undefined,
    routingConfidence:
      resolvedPolicy.metadata?.routingConfidence === "high" || resolvedPolicy.metadata?.routingConfidence === "low"
        ? resolvedPolicy.metadata.routingConfidence
        : undefined,
    routingStrategy:
      resolvedPolicy.metadata?.routingStrategy === "single_intent" ||
      resolvedPolicy.metadata?.routingStrategy === "dual_intent_blend"
        ? resolvedPolicy.metadata.routingStrategy
        : undefined,
    embedderIntent: instructionIntent({
      preset: resolvedPolicy.embedder?.instructionPreset,
      instruction: resolvedPolicy.embedder?.instruction,
    }),
    rerankerIntent: instructionIntent({
      preset: resolvedPolicy.reranker?.instructionPreset,
      instruction: resolvedPolicy.reranker?.instruction,
    }),
  }
}

function scoreCandidate(input: {
  scenario: RetrievalTraceReplayScenario
  candidate: RetrievalTraceCandidate
  variant: RetrievalTraceRankerAblationVariant
  route: RoutingContext
}) {
  const lexical = lexicalOverlap(input.scenario.query, input.candidate)
  const base = input.candidate.rerankScore ?? input.candidate.score ?? 0

  switch (input.variant.scoring) {
    case "lexical_only":
      return lexical
    case "retrieval_base":
      return base
    case "hybrid_no_feedback":
      return base + (input.candidate.outcomeScore ?? 0)
    case "hybrid_no_outcome":
      return base + (input.candidate.feedbackScore ?? 0)
    case "hybrid_current":
      return base + (input.candidate.outcomeScore ?? 0) + (input.candidate.feedbackScore ?? 0)
    case "intent_aware_current": {
      const inferredIntent = candidateIntent(input.candidate)
      let score = lexical * 0.4 + (input.candidate.score ?? 0) * 0.2 + (input.candidate.rerankScore ?? 0) * 0.2
      score += Math.max(0, 4 - input.candidate.rank) * 0.12
      if (inferredIntent && input.route.primaryIntent && inferredIntent === input.route.primaryIntent) score += 1.2
      if (inferredIntent && input.route.embedderIntent && inferredIntent === input.route.embedderIntent) score += 0.6
      if (inferredIntent && input.route.rerankerIntent && inferredIntent === input.route.rerankerIntent) score += 0.8
      if (inferredIntent && input.route.secondaryIntent && inferredIntent === input.route.secondaryIntent) score += 0.2
      if (inferredIntent && inferredIntent === input.scenario.expectedIntent) score += 0.3
      if (input.route.primaryIntent && inferredIntent && inferredIntent !== input.route.primaryIntent) score -= 0.15
      return score
    }
  }
}

function rankCandidates(input: {
  scenario: RetrievalTraceReplayScenario
  variant: RetrievalTraceRankerAblationVariant
  route: RoutingContext
}) {
  return [...input.scenario.candidates]
    .map((candidate) => ({
      documentID: candidate.documentID,
      rank: candidate.rank,
      score: scoreCandidate({
        scenario: input.scenario,
        candidate,
        variant: input.variant,
        route: input.route,
      }),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.rank - b.rank
    })
}

function summarizeVariant(
  variant: RetrievalTraceRankerAblationVariant,
  results: RetrievalTraceRankerAblationScenarioResult[],
): RetrievalTraceRankerAblationVariantResult {
  const categorySummary = intents.map((category) => {
    const matches = results.filter((item) => item.expectedIntent === category)
    return {
      category,
      scenarioCount: matches.length,
      topDocumentReplayAccuracy: Number(
        (matches.filter((item) => item.topDocumentReplayMatch).length / Math.max(1, matches.length)).toFixed(4),
      ),
      meanReciprocalRank: Number(
        (matches.reduce((sum, item) => sum + item.reciprocalRank, 0) / Math.max(1, matches.length)).toFixed(4),
      ),
    }
  })

  const averageCorrectDocumentRank = Number(
    (
      results.reduce((sum, item) => sum + (item.correctDocumentRank ?? inputScenarioFallbackRank(item)), 0) /
      Math.max(1, results.length)
    ).toFixed(4),
  )

  return {
    id: variant.id,
    label: variant.label,
    scenarioCount: results.length,
    topDocumentReplayAccuracy: Number(
      (results.filter((item) => item.topDocumentReplayMatch).length / Math.max(1, results.length)).toFixed(4),
    ),
    meanReciprocalRank: Number(
      (results.reduce((sum, item) => sum + item.reciprocalRank, 0) / Math.max(1, results.length)).toFixed(4),
    ),
    averageCorrectDocumentRank,
    categorySummary: categorySummary.filter((item) => item.scenarioCount > 0),
    results,
  }
}

function inputScenarioFallbackRank(result: RetrievalTraceRankerAblationScenarioResult) {
  return result.correctDocumentRank ?? 999
}

export async function runRetrievalTraceRankerAblationBenchmark(input?: {
  tracePath?: string
  limit?: number
  variants?: RetrievalTraceRankerAblationVariant[]
  scenarios?: RetrievalTraceReplayScenario[]
  includeSeededScenarios?: boolean
}): Promise<RetrievalTraceRankerAblationBenchmarkResult> {
  const scenarios = await loadRetrievalTraceReplayScenarios({
    tracePath: input?.tracePath,
    limit: input?.limit,
    scenarios: input?.scenarios,
    includeSeededScenarios: input?.includeSeededScenarios,
  })
  const activeVariants = input?.variants ?? DEFAULT_RETRIEVAL_TRACE_RANKER_ABLATION_VARIANTS
  const routingContexts = new Map(scenarios.map((scenario) => [scenario.id, buildRoutingContext(scenario)]))

  const variants: RetrievalTraceRankerAblationVariantResult[] = activeVariants.map((variant) => {
    const results = scenarios.map((scenario) => {
      const route = routingContexts.get(scenario.id) ?? {}
      const ranked = rankCandidates({ scenario, variant, route })
      const correctDocumentRank = scenario.expectedTopDocumentID
        ? ranked.findIndex((item) => item.documentID === scenario.expectedTopDocumentID) + 1
        : undefined
      const replayTopDocumentID = ranked[0]?.documentID
      return {
        scenarioID: scenario.id,
        expectedIntent: scenario.expectedIntent,
        variantID: variant.id,
        primaryIntent: route.primaryIntent,
        secondaryIntent: route.secondaryIntent,
        routingConfidence: route.routingConfidence,
        routingStrategy: route.routingStrategy,
        replayTopDocumentID,
        correctDocumentRank,
        reciprocalRank: correctDocumentRank ? Number((1 / correctDocumentRank).toFixed(4)) : 0,
        topDocumentReplayMatch: replayTopDocumentID === scenario.expectedTopDocumentID,
      } satisfies RetrievalTraceRankerAblationScenarioResult
    })
    return summarizeVariant(variant, results)
  })

  const overallWinner = [...variants].sort((a, b) => {
    if (b.topDocumentReplayAccuracy !== a.topDocumentReplayAccuracy)
      return b.topDocumentReplayAccuracy - a.topDocumentReplayAccuracy
    if (b.meanReciprocalRank !== a.meanReciprocalRank) return b.meanReciprocalRank - a.meanReciprocalRank
    return a.averageCorrectDocumentRank - b.averageCorrectDocumentRank
  })[0]

  return {
    suite: "retrieval_trace_ranker_ablation",
    scenarioCount: scenarios.length,
    variantCount: variants.length,
    variants,
    overallWinner: {
      id: overallWinner.id,
      topDocumentReplayAccuracy: overallWinner.topDocumentReplayAccuracy,
      meanReciprocalRank: overallWinner.meanReciprocalRank,
      averageCorrectDocumentRank: overallWinner.averageCorrectDocumentRank,
    },
  }
}
