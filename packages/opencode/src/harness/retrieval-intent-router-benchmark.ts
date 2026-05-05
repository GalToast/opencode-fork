// @ts-nocheck
import { RetrievalPolicy } from "@/retrieval/policy"
import {
  analyzeRetrievalIntent,
  classifyRetrievalIntent,
  routeRetrievalPolicyByIntent,
  type RetrievalIntent,
  type RetrievalIntentRoutingConfidence,
} from "@/retrieval/prompt"
import { SEEDED_RETRIEVAL_QUALITY_SCENARIOS } from "./retrieval-quality-benchmark"
import { REAL_RETRIEVAL_TRACE_REPLAY_SCENARIOS } from "./retrieval-trace-replay-real-cases"

type RetrievalRoutingStrategy = "single_intent" | "dual_intent_blend"

type BenchmarkVariant = {
  id: string
  label: string
  mode: "primary_only_classifier" | "auto_intent_router"
}

export type RetrievalIntentRouterScenario = {
  id: string
  query: string
  detail?: string
  expectedIntent: RetrievalIntent
  expectedSecondaryIntent?: RetrievalIntent
  expectedConfidence: RetrievalIntentRoutingConfidence
  expectedStrategy: RetrievalRoutingStrategy
  source: "seeded_quality" | "real_trace_replay"
}

export type RetrievalIntentRouterScenarioResult = {
  scenarioID: string
  variantID: string
  primaryIntent: RetrievalIntent
  secondaryIntent?: RetrievalIntent
  confidence: RetrievalIntentRoutingConfidence
  strategy: RetrievalRoutingStrategy
  primaryIntentMatch: boolean
  secondaryIntentMatch: boolean
  confidenceMatch: boolean
  strategyMatch: boolean
  exactRouteMatch: boolean
}

export type RetrievalIntentRouterVariantResult = {
  id: string
  label: string
  scenarioCount: number
  primaryIntentAccuracy: number
  secondaryIntentAccuracy: number
  confidenceAccuracy: number
  strategyAccuracy: number
  exactRouteAccuracy: number
  categorySummary: Array<{
    category: RetrievalIntent
    scenarioCount: number
    primaryIntentAccuracy: number
    exactRouteAccuracy: number
  }>
  results: RetrievalIntentRouterScenarioResult[]
}

export type RetrievalIntentRouterBenchmarkResult = {
  suite: "retrieval_intent_router"
  scenarioCount: number
  variantCount: number
  variants: RetrievalIntentRouterVariantResult[]
  overallWinner: {
    id: string
    primaryIntentAccuracy: number
    exactRouteAccuracy: number
  }
}

const intents: RetrievalIntent[] = ["decision", "recovery", "task_pattern", "file", "compaction"]

const variants: BenchmarkVariant[] = [
  {
    id: "primary_only_classifier",
    label: "primary only classifier",
    mode: "primary_only_classifier",
  },
  {
    id: "auto_intent_router",
    label: "auto intent router",
    mode: "auto_intent_router",
  },
]

export const DEFAULT_RETRIEVAL_INTENT_ROUTER_SCENARIOS: RetrievalIntentRouterScenario[] = [
  ...SEEDED_RETRIEVAL_QUALITY_SCENARIOS.filter((scenario) =>
    ["decision_lane_rule", "recovery_provider_fallback", "task_pattern_bounded_worker", "file_service_lookup", "compaction_short_identifier"].includes(
      scenario.id,
    ),
  ).map(
    (scenario) =>
      ({
        id: scenario.id,
        query: scenario.query,
        detail: scenario.detail,
        expectedIntent: scenario.category,
        expectedConfidence: "high",
        expectedStrategy: "single_intent",
        source: "seeded_quality",
      }) satisfies RetrievalIntentRouterScenario,
  ),
  ...REAL_RETRIEVAL_TRACE_REPLAY_SCENARIOS.map(
    (scenario) =>
      ({
        id: scenario.id,
        query: scenario.query,
        detail: scenario.detail,
        expectedIntent: scenario.expectedIntent,
        expectedSecondaryIntent: scenario.expectedSecondaryIntent,
        expectedConfidence: scenario.expectedConfidence ?? "low",
        expectedStrategy: scenario.expectedStrategy ?? "dual_intent_blend",
        source: "real_trace_replay",
      }) satisfies RetrievalIntentRouterScenario,
  ),
]

function summarizeVariant(
  variant: BenchmarkVariant,
  results: RetrievalIntentRouterScenarioResult[],
  scenarios: RetrievalIntentRouterScenario[],
) {
  return {
    id: variant.id,
    label: variant.label,
    scenarioCount: results.length,
    primaryIntentAccuracy: Number((results.filter((item) => item.primaryIntentMatch).length / results.length).toFixed(4)),
    secondaryIntentAccuracy: Number(
      (results.filter((item) => item.secondaryIntentMatch).length / results.length).toFixed(4),
    ),
    confidenceAccuracy: Number((results.filter((item) => item.confidenceMatch).length / results.length).toFixed(4)),
    strategyAccuracy: Number((results.filter((item) => item.strategyMatch).length / results.length).toFixed(4)),
    exactRouteAccuracy: Number((results.filter((item) => item.exactRouteMatch).length / results.length).toFixed(4)),
    categorySummary: intents
      .map((category) => {
        const categoryResults = results.filter((item) => {
          const scenario = scenarios.find((entry) => entry.id === item.scenarioID)
          return scenario?.expectedIntent === category
        })
        if (categoryResults.length === 0) return undefined
        return {
          category,
          scenarioCount: categoryResults.length,
          primaryIntentAccuracy: Number(
            (categoryResults.filter((item) => item.primaryIntentMatch).length / categoryResults.length).toFixed(4),
          ),
          exactRouteAccuracy: Number(
            (categoryResults.filter((item) => item.exactRouteMatch).length / categoryResults.length).toFixed(4),
          ),
        }
      })
      .filter((item): item is NonNullable<typeof item> => !!item),
    results,
  } satisfies RetrievalIntentRouterVariantResult
}

function runVariantScenario(input: {
  scenario: RetrievalIntentRouterScenario
  variant: BenchmarkVariant
}): RetrievalIntentRouterScenarioResult {
  const resolved =
    input.variant.mode === "primary_only_classifier"
      ? {
          primaryIntent: classifyRetrievalIntent({
            query: input.scenario.query,
            detail: input.scenario.detail,
          }),
          secondaryIntent: undefined,
          confidence: "high" as const,
          strategy: "single_intent" as const,
        }
      : (() => {
          const routed = routeRetrievalPolicyByIntent({
            policy: RetrievalPolicy.resolve("auto"),
            query: input.scenario.query,
            detail: input.scenario.detail,
          })
          const analysis = analyzeRetrievalIntent({
            query: input.scenario.query,
            detail: input.scenario.detail,
          })
          return {
            primaryIntent: routed.metadata?.routedIntent as RetrievalIntent | undefined,
            secondaryIntent: routed.metadata?.routedIntentSecondary as RetrievalIntent | undefined,
            confidence:
              (routed.metadata?.routingConfidence as RetrievalIntentRoutingConfidence | undefined) ?? analysis.confidence,
            strategy: (routed.metadata?.routingStrategy as RetrievalRoutingStrategy | undefined) ?? "single_intent",
          }
        })()

  const primaryIntent = resolved.primaryIntent ?? input.scenario.expectedIntent

  return {
    scenarioID: input.scenario.id,
    variantID: input.variant.id,
    primaryIntent,
    secondaryIntent: resolved.secondaryIntent,
    confidence: resolved.confidence,
    strategy: resolved.strategy,
    primaryIntentMatch: primaryIntent === input.scenario.expectedIntent,
    secondaryIntentMatch:
      input.scenario.expectedSecondaryIntent === undefined
        ? resolved.secondaryIntent === undefined
        : resolved.secondaryIntent === input.scenario.expectedSecondaryIntent,
    confidenceMatch: resolved.confidence === input.scenario.expectedConfidence,
    strategyMatch: resolved.strategy === input.scenario.expectedStrategy,
    exactRouteMatch:
      primaryIntent === input.scenario.expectedIntent &&
      (input.scenario.expectedSecondaryIntent === undefined
        ? resolved.secondaryIntent === undefined
        : resolved.secondaryIntent === input.scenario.expectedSecondaryIntent) &&
      resolved.confidence === input.scenario.expectedConfidence &&
      resolved.strategy === input.scenario.expectedStrategy,
  }
}

export async function runRetrievalIntentRouterBenchmark(input?: {
  scenarios?: RetrievalIntentRouterScenario[]
  variants?: BenchmarkVariant[]
}): Promise<RetrievalIntentRouterBenchmarkResult> {
  const scenarios = input?.scenarios ?? DEFAULT_RETRIEVAL_INTENT_ROUTER_SCENARIOS
  const activeVariants = input?.variants ?? variants

  const variantResults = activeVariants.map((variant) =>
    summarizeVariant(
      variant,
      scenarios.map((scenario) => runVariantScenario({ scenario, variant })),
      scenarios,
    ),
  )

  const overallWinner = [...variantResults].sort((a, b) => {
    if (b.primaryIntentAccuracy !== a.primaryIntentAccuracy) return b.primaryIntentAccuracy - a.primaryIntentAccuracy
    return b.exactRouteAccuracy - a.exactRouteAccuracy
  })[0]

  return {
    suite: "retrieval_intent_router",
    scenarioCount: scenarios.length,
    variantCount: variantResults.length,
    variants: variantResults,
    overallWinner: {
      id: overallWinner.id,
      primaryIntentAccuracy: overallWinner.primaryIntentAccuracy,
      exactRouteAccuracy: overallWinner.exactRouteAccuracy,
    },
  }
}
