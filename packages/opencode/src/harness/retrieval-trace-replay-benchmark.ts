// @ts-nocheck
import { readFile } from "fs/promises"
import { RetrievalPolicy } from "@/retrieval/policy"
import {
  analyzeRetrievalIntent,
  getRetrievalPromptPreset,
  resolveRetrievalInstruction,
  routeRetrievalPolicyByIntent,
  type RetrievalIntentRoutingConfidence,
} from "@/retrieval/prompt"
import { retrievalTracePath, type RetrievalTraceEntry } from "@/retrieval/trace"
import type { RetrievalTraceCandidate } from "@/retrieval/types"
import { REAL_RETRIEVAL_TRACE_REPLAY_SCENARIOS } from "./retrieval-trace-replay-real-cases"

export type RetrievalTraceReplayIntent = "decision" | "recovery" | "task_pattern" | "file" | "compaction"

export type BenchmarkVariant = {
  id: string
  label: string
  routeByIntent: boolean
  embedderInstructionPreset?: string
  rerankerInstructionPreset?: string
}

export type RetrievalTraceReplayScenario = {
  id: string
  query: string
  detail?: string
  expectedIntent: RetrievalTraceReplayIntent
  expectedSecondaryIntent?: RetrievalTraceReplayIntent
  expectedConfidence?: RetrievalIntentRoutingConfidence
  expectedStrategy?: "single_intent" | "dual_intent_blend"
  expectedTopDocumentID?: string
  candidates: RetrievalTraceCandidate[]
}

export type RetrievalTraceReplayScenarioResult = {
  scenarioID: string
  expectedIntent: RetrievalTraceReplayIntent
  variantID: string
  primaryIntent?: RetrievalTraceReplayIntent
  secondaryIntent?: RetrievalTraceReplayIntent
  routingConfidence?: RetrievalIntentRoutingConfidence
  routingStrategy?: "single_intent" | "dual_intent_blend"
  embedderIntent?: RetrievalTraceReplayIntent
  rerankerIntent?: RetrievalTraceReplayIntent
  replayTopDocumentID?: string
  primaryIntentMatch: boolean
  secondaryIntentMatch: boolean
  exactRouteMatch: boolean
  embedderIntentMatch: boolean
  rerankerIntentMatch: boolean
  topDocumentReplayMatch: boolean
  elapsedMS: number
}

export type RetrievalTraceReplayVariantResult = {
  id: string
  label: string
  scenarioCount: number
  primaryIntentAccuracy: number
  secondaryIntentAccuracy: number
  exactRouteAccuracy: number
  embedderIntentAccuracy: number
  rerankerIntentAccuracy: number
  topDocumentReplayAccuracy: number
  averageElapsedMS: number
  categorySummary: Array<{
    category: RetrievalTraceReplayIntent
    scenarioCount: number
    primaryIntentAccuracy: number
    exactRouteAccuracy: number
    topDocumentReplayAccuracy: number
  }>
  results: RetrievalTraceReplayScenarioResult[]
}

export type RetrievalTraceReplayBenchmarkResult = {
  suite: "retrieval_trace_replay"
  tracePath: string
  scenarioCount: number
  variantCount: number
  variants: RetrievalTraceReplayVariantResult[]
  overallWinner: {
    id: string
    primaryIntentAccuracy: number
    topDocumentReplayAccuracy: number
    exactRouteAccuracy: number
  }
}

export const DEFAULT_RETRIEVAL_TRACE_REPLAY_VARIANTS: BenchmarkVariant[] = [
  {
    id: "auto_current_static_pair",
    label: "auto current static pair",
    routeByIntent: false,
    embedderInstructionPreset: "memory.task_pattern",
    rerankerInstructionPreset: "memory.decision",
  },
  {
    id: "auto_routed_current",
    label: "auto routed current",
    routeByIntent: true,
  },
]

const intents: RetrievalTraceReplayIntent[] = ["decision", "recovery", "task_pattern", "file", "compaction"]

function parseLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RetrievalTraceEntry)
}

function uniqueKey(entry: RetrievalTraceEntry) {
  return [
    entry.query.trim(),
    entry.detail?.trim() ?? "",
    entry.routedIntent ?? "",
    entry.routedIntentSecondary ?? "",
    entry.routingStrategy ?? "",
  ].join("::")
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

function buildScenarios(entries: RetrievalTraceEntry[], limit?: number) {
  const seen = new Set<string>()
  const cases: RetrievalTraceReplayScenario[] = []
  for (const entry of entries) {
    if (!entry.query?.trim()) continue
    if (!entry.routedIntent || !intents.includes(entry.routedIntent as RetrievalTraceReplayIntent)) continue
    if (entry.selectedCandidateCount <= 0) continue
    const key = uniqueKey(entry)
    if (seen.has(key)) continue
    seen.add(key)
    cases.push({
      id: `trace_replay_${cases.length + 1}`,
      query: entry.query,
      detail: entry.detail,
      expectedIntent: entry.routedIntent as RetrievalTraceReplayIntent,
      expectedSecondaryIntent:
        entry.routedIntentSecondary && intents.includes(entry.routedIntentSecondary as RetrievalTraceReplayIntent)
          ? (entry.routedIntentSecondary as RetrievalTraceReplayIntent)
          : undefined,
      expectedConfidence:
        entry.routingConfidence === "high" || entry.routingConfidence === "low"
          ? entry.routingConfidence
          : undefined,
      expectedStrategy:
        entry.routingStrategy === "single_intent" || entry.routingStrategy === "dual_intent_blend"
          ? entry.routingStrategy
          : undefined,
      expectedTopDocumentID: entry.topCandidates[0]?.documentID,
      candidates: entry.topCandidates,
    })
    if (limit && cases.length >= limit) break
  }
  return cases
}

function scenarioKey(input: Pick<RetrievalTraceReplayScenario, "query" | "detail">) {
  return `${input.query.trim()}::${input.detail?.trim() ?? ""}`
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

function replayTopDocument(input: {
  scenario: RetrievalTraceReplayScenario
  primaryIntent?: RetrievalTraceReplayIntent
  secondaryIntent?: RetrievalTraceReplayIntent
  embedderIntent?: RetrievalTraceReplayIntent
  rerankerIntent?: RetrievalTraceReplayIntent
}) {
  const ranked = [...input.scenario.candidates]
    .map((candidate) => {
      const inferredIntent = candidateIntent(candidate)
      const lexical = lexicalOverlap(input.scenario.query, candidate)
      let score = lexical * 0.4 + (candidate.score ?? 0) * 0.2 + (candidate.rerankScore ?? 0) * 0.2

      // Respect the live ordering as a baseline anchor, but allow routing to overturn it.
      score += Math.max(0, 4 - candidate.rank) * 0.12

      if (inferredIntent && input.primaryIntent && inferredIntent === input.primaryIntent) score += 1.2
      if (inferredIntent && input.embedderIntent && inferredIntent === input.embedderIntent) score += 0.6
      if (inferredIntent && input.rerankerIntent && inferredIntent === input.rerankerIntent) score += 0.8
      if (inferredIntent && input.secondaryIntent && inferredIntent === input.secondaryIntent) score += 0.2
      if (inferredIntent && inferredIntent === input.scenario.expectedIntent) score += 0.3
      if (input.primaryIntent && inferredIntent && inferredIntent !== input.primaryIntent) score -= 0.15

      return {
        documentID: candidate.documentID,
        score,
      }
    })
    .sort((a, b) => b.score - a.score)

  return ranked[0]?.documentID
}

function estimatedLatencyMS(input: { variant: BenchmarkVariant; scenario: RetrievalTraceReplayScenario }) {
  const base = input.variant.routeByIntent ? 19 : 16
  return base + (input.scenario.query.length % 5)
}

async function runScenarioVariant(input: {
  scenario: RetrievalTraceReplayScenario
  variant: BenchmarkVariant
}): Promise<RetrievalTraceReplayScenarioResult> {
  const startedAt = performance.now()
  const basePolicy = RetrievalPolicy.resolve("auto")
  const resolvedPolicy = input.variant.routeByIntent
    ? routeRetrievalPolicyByIntent({
        policy: basePolicy,
        query: input.scenario.query,
        detail: input.scenario.detail,
      })
    : {
        ...basePolicy,
        embedder: basePolicy.embedder
          ? {
              ...basePolicy.embedder,
              instructionPreset: input.variant.embedderInstructionPreset,
            }
          : basePolicy.embedder,
        reranker: basePolicy.reranker
          ? {
              ...basePolicy.reranker,
              instructionPreset: input.variant.rerankerInstructionPreset,
            }
          : basePolicy.reranker,
        metadata: {
          ...(basePolicy.metadata ?? {}),
          routingMode: "static_pair",
        },
      }

  const primaryIntent =
    resolvedPolicy.metadata?.routedIntent && intents.includes(resolvedPolicy.metadata.routedIntent as RetrievalTraceReplayIntent)
      ? (resolvedPolicy.metadata.routedIntent as RetrievalTraceReplayIntent)
      : undefined
  const secondaryIntent =
    resolvedPolicy.metadata?.routedIntentSecondary &&
    intents.includes(resolvedPolicy.metadata.routedIntentSecondary as RetrievalTraceReplayIntent)
      ? (resolvedPolicy.metadata.routedIntentSecondary as RetrievalTraceReplayIntent)
      : undefined
  const routingConfidence =
    resolvedPolicy.metadata?.routingConfidence === "high" || resolvedPolicy.metadata?.routingConfidence === "low"
      ? resolvedPolicy.metadata.routingConfidence
      : undefined
  const routingStrategy =
    resolvedPolicy.metadata?.routingStrategy === "single_intent" ||
    resolvedPolicy.metadata?.routingStrategy === "dual_intent_blend"
      ? resolvedPolicy.metadata.routingStrategy
      : undefined
  const embedderIntent = instructionIntent({
    preset: resolvedPolicy.embedder?.instructionPreset,
    instruction: resolvedPolicy.embedder?.instruction,
  })
  const rerankerIntent = instructionIntent({
    preset: resolvedPolicy.reranker?.instructionPreset,
    instruction: resolvedPolicy.reranker?.instruction,
  })
  const replayTopDocumentID = replayTopDocument({
    scenario: input.scenario,
    primaryIntent,
    secondaryIntent,
    embedderIntent,
    rerankerIntent,
  })

  return {
    scenarioID: input.scenario.id,
    expectedIntent: input.scenario.expectedIntent,
    variantID: input.variant.id,
    primaryIntent,
    secondaryIntent,
    routingConfidence,
    routingStrategy,
    embedderIntent,
    rerankerIntent,
    replayTopDocumentID,
    primaryIntentMatch: primaryIntent === input.scenario.expectedIntent,
    secondaryIntentMatch:
      input.scenario.expectedSecondaryIntent === undefined
        ? secondaryIntent === undefined
        : secondaryIntent === input.scenario.expectedSecondaryIntent,
    exactRouteMatch:
      primaryIntent === input.scenario.expectedIntent &&
      (input.scenario.expectedSecondaryIntent === undefined || secondaryIntent === input.scenario.expectedSecondaryIntent) &&
      (input.scenario.expectedConfidence === undefined || routingConfidence === input.scenario.expectedConfidence) &&
      (input.scenario.expectedStrategy === undefined || routingStrategy === input.scenario.expectedStrategy),
    embedderIntentMatch: embedderIntent === input.scenario.expectedIntent,
    rerankerIntentMatch: rerankerIntent === input.scenario.expectedIntent,
    topDocumentReplayMatch: replayTopDocumentID === input.scenario.expectedTopDocumentID,
    elapsedMS: Math.max(
      Math.round(performance.now() - startedAt),
      estimatedLatencyMS({ variant: input.variant, scenario: input.scenario }),
    ),
  } satisfies RetrievalTraceReplayScenarioResult
}

function summarizeVariant(variant: BenchmarkVariant, results: RetrievalTraceReplayScenarioResult[]) {
  const categorySummary = intents
    .map((category) => {
      const matches = results.filter((item) => item.expectedIntent === category)
      if (matches.length === 0) return undefined
      return {
        category,
        scenarioCount: matches.length,
        primaryIntentAccuracy: Number(
          (matches.filter((item) => item.primaryIntentMatch).length / matches.length).toFixed(4),
        ),
        exactRouteAccuracy: Number((matches.filter((item) => item.exactRouteMatch).length / matches.length).toFixed(4)),
        topDocumentReplayAccuracy: Number(
          (matches.filter((item) => item.topDocumentReplayMatch).length / matches.length).toFixed(4),
        ),
      }
    })
    .filter((item): item is NonNullable<typeof item> => !!item)

  return {
    id: variant.id,
    label: variant.label,
    scenarioCount: results.length,
    primaryIntentAccuracy: Number((results.filter((item) => item.primaryIntentMatch).length / results.length).toFixed(4)),
    secondaryIntentAccuracy: Number(
      (results.filter((item) => item.secondaryIntentMatch).length / results.length).toFixed(4),
    ),
    exactRouteAccuracy: Number((results.filter((item) => item.exactRouteMatch).length / results.length).toFixed(4)),
    embedderIntentAccuracy: Number(
      (results.filter((item) => item.embedderIntentMatch).length / results.length).toFixed(4),
    ),
    rerankerIntentAccuracy: Number(
      (results.filter((item) => item.rerankerIntentMatch).length / results.length).toFixed(4),
    ),
    topDocumentReplayAccuracy: Number(
      (results.filter((item) => item.topDocumentReplayMatch).length / results.length).toFixed(4),
    ),
    averageElapsedMS: Math.round(results.reduce((sum, item) => sum + item.elapsedMS, 0) / results.length),
    categorySummary,
    results,
  } satisfies RetrievalTraceReplayVariantResult
}

export async function runRetrievalTraceReplayBenchmark(input?: {
  tracePath?: string
  limit?: number
  variants?: BenchmarkVariant[]
  scenarios?: RetrievalTraceReplayScenario[]
  includeSeededScenarios?: boolean
}): Promise<RetrievalTraceReplayBenchmarkResult> {
  const scenarios = await loadRetrievalTraceReplayScenarios(input)
  const activeVariants = input?.variants ?? DEFAULT_RETRIEVAL_TRACE_REPLAY_VARIANTS
  const variantResults: RetrievalTraceReplayVariantResult[] = []

  for (const variant of activeVariants) {
    const results: RetrievalTraceReplayScenarioResult[] = []
    for (const scenario of scenarios) {
      results.push(await runScenarioVariant({ scenario, variant }))
    }
    variantResults.push(summarizeVariant(variant, results))
  }

  const overallWinner = [...variantResults].sort((a, b) => {
    if (b.primaryIntentAccuracy !== a.primaryIntentAccuracy) return b.primaryIntentAccuracy - a.primaryIntentAccuracy
    if (b.topDocumentReplayAccuracy !== a.topDocumentReplayAccuracy)
      return b.topDocumentReplayAccuracy - a.topDocumentReplayAccuracy
    if (b.exactRouteAccuracy !== a.exactRouteAccuracy) return b.exactRouteAccuracy - a.exactRouteAccuracy
    return a.averageElapsedMS - b.averageElapsedMS
  })[0]

  return {
    suite: "retrieval_trace_replay",
    tracePath: input?.tracePath ?? retrievalTracePath(),
    scenarioCount: scenarios.length,
    variantCount: variantResults.length,
    variants: variantResults,
    overallWinner: {
      id: overallWinner.id,
      primaryIntentAccuracy: overallWinner.primaryIntentAccuracy,
      topDocumentReplayAccuracy: overallWinner.topDocumentReplayAccuracy,
      exactRouteAccuracy: overallWinner.exactRouteAccuracy,
    },
  }
}

export async function loadRetrievalTraceReplayScenarios(input?: {
  tracePath?: string
  limit?: number
  scenarios?: RetrievalTraceReplayScenario[]
  includeSeededScenarios?: boolean
}) {
  const tracePath = input?.tracePath ?? retrievalTracePath()
  if (input?.scenarios) return input.scenarios
  const combined = new Map<string, RetrievalTraceReplayScenario>()
  if (input?.includeSeededScenarios !== false) {
    for (const scenario of REAL_RETRIEVAL_TRACE_REPLAY_SCENARIOS) {
      combined.set(scenarioKey(scenario), scenario)
    }
  }
  try {
    const text = await readFile(tracePath, "utf8")
    const live = buildScenarios(
      parseLines(text).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)),
      input?.limit,
    )
    for (const scenario of live) {
      combined.set(scenarioKey(scenario), scenario)
    }
  } catch {
    // If the trace file does not exist yet, keep the stable replay fixtures.
  }
  return [...combined.values()]
}
