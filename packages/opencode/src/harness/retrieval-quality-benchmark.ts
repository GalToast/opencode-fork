// @ts-nocheck
import { RetrievalSearch } from "@/retrieval/search"
import { RetrievalPolicy } from "@/retrieval/policy"
import { getRetrievalPromptPreset, resolveRetrievalInstruction, routeRetrievalPolicyByIntent } from "@/retrieval/prompt"
import type { RetrievalChunkCandidate, RetrievalPolicyName } from "@/retrieval/types"

type WorkspacePreparer = (scenarioID: string) => Promise<string> | string

type RetrievalIntent = "decision" | "recovery" | "task_pattern" | "file" | "compaction"

type BenchmarkVariant = {
  id: string
  label: string
  policy: RetrievalPolicyName
  promptMode?: "preset" | "literal" | "hybrid" | "routed"
  routeByIntent?: boolean
  focusCategory?: RetrievalIntent
  secondaryFocusCategory?: RetrievalIntent
  routingConfidence?: "high" | "low"
  routingStrategy?: "single_intent" | "dual_intent_blend"
  embedderInstructionPreset?: string
  rerankerInstructionPreset?: string
  embedderInstruction?: string
  rerankerInstruction?: string
}

export type RetrievalQualityBenchmarkScenario = {
  id: string
  category: RetrievalIntent
  query: string
  sharedContext: string
  detail: string
  lexicalBleed?: Partial<Record<RetrievalIntent, number>>
}

type SeededCandidate = {
  documentID: string
  intent: RetrievalIntent
  title: string
  content: string
}

export type RetrievalQualityScenarioResult = {
  scenarioID: string
  category: RetrievalIntent
  variantID: string
  topDocumentID?: string
  top3Hit: boolean
  reciprocalRank: number
  elapsedMS: number
}

export type RetrievalQualityVariantResult = {
  id: string
  label: string
  policy: RetrievalPolicyName
  promptMode: "preset" | "literal" | "hybrid" | "routed"
  focusCategory?: RetrievalIntent
  embedderModelID?: string
  rerankerModelID?: string
  embedderInstructionPreset?: string
  rerankerInstructionPreset?: string
  embedderInstruction?: string
  rerankerInstruction?: string
  scenarioCount: number
  top1Accuracy: number
  top3Recall: number
  meanReciprocalRank: number
  averageElapsedMS: number
  categorySummary: Array<{
    category: RetrievalIntent
    scenarioCount: number
    top1Accuracy: number
    top3Recall: number
    meanReciprocalRank: number
  }>
  results: RetrievalQualityScenarioResult[]
}

export type RetrievalQualityBenchmarkResult = {
  suite: "retrieval_quality"
  scenarioCount: number
  variantCount: number
  variants: RetrievalQualityVariantResult[]
  overallWinner: {
    id: string
    top1Accuracy: number
    meanReciprocalRank: number
  }
  categoryLeaders: Array<{
    category: RetrievalIntent
    variantID: string
    top1Accuracy: number
    meanReciprocalRank: number
  }>
}

const intents: RetrievalIntent[] = ["decision", "recovery", "task_pattern", "file", "compaction"]

const baseVariants: BenchmarkVariant[] = [
  {
    id: "fast_current",
    label: "fast current",
    policy: "fast",
    promptMode: "preset",
    embedderInstructionPreset: "memory.task_pattern",
    rerankerInstructionPreset: "memory.task_pattern",
  },
  {
    id: "quality_current",
    label: "quality current",
    policy: "quality",
    promptMode: "preset",
    embedderInstructionPreset: "memory.decision",
    rerankerInstructionPreset: "memory.decision",
  },
  {
    id: "auto_current",
    label: "auto current",
    policy: "auto",
    promptMode: "preset",
    embedderInstructionPreset: "memory.task_pattern",
    rerankerInstructionPreset: "memory.decision",
  },
  {
    id: "auto_routed_best_of_category",
    label: "auto routed best of category",
    policy: "auto",
    promptMode: "routed",
    routeByIntent: true,
  },
  {
    id: "fast_decision_tuned",
    label: "fast decision tuned",
    policy: "fast",
    promptMode: "preset",
    focusCategory: "decision",
    embedderInstructionPreset: "memory.decision",
    rerankerInstructionPreset: "memory.decision",
  },
  {
    id: "auto_failure_tuned",
    label: "auto failure tuned",
    policy: "auto",
    promptMode: "preset",
    focusCategory: "recovery",
    embedderInstructionPreset: "memory.failure",
    rerankerInstructionPreset: "memory.failure",
  },
  {
    id: "quality_file_tuned",
    label: "quality file tuned",
    policy: "quality",
    promptMode: "preset",
    focusCategory: "file",
    embedderInstructionPreset: "memory.file",
    rerankerInstructionPreset: "memory.file",
  },
  {
    id: "auto_failure_literal",
    label: "auto failure literal",
    policy: "auto",
    promptMode: "literal",
    focusCategory: "recovery",
    embedderInstruction:
      "Retrieve the closest prior failures, regressions, degraded retrieval runs, and recovery paths. Prefer evidence that exposes the failure mode and the fallback or fix that restored correct behavior.",
    rerankerInstruction:
      "Rank candidates by how well they explain the current failure, degraded retrieval behavior, or recovery path. Prefer prior examples that expose the cause and the fix or fallback that resolved it.",
  },
  {
    id: "quality_file_literal",
    label: "quality file literal",
    policy: "quality",
    promptMode: "literal",
    focusCategory: "file",
    embedderInstruction:
      "Retrieve the files, modules, symbols, and documents most likely to own the current behavior. Prefer concrete file-location evidence, ownership anchors, and exact module matches over thematic similarity.",
    rerankerInstruction:
      "Rank candidates by how directly they identify the file, module, symbol, or document the user probably needs. Prefer exact ownership and location evidence over general semantic similarity.",
  },
]

const decisionSweepVariants: BenchmarkVariant[] = [
  {
    id: "quality_decision_commitments",
    label: "quality decision commitments",
    policy: "quality",
    promptMode: "literal",
    focusCategory: "decision",
    embedderInstruction:
      "Retrieve prior decisions, governing constraints, compatibility commitments, and lane defaults that should still control the current work. Prefer records that preserve settled commitments and block invalid index-space or model-shape changes.",
    rerankerInstruction:
      "Rank candidates by how clearly they capture the governing decision, compatibility rule, or commitment that should constrain the current work. Prefer records that explain why a lane, default, or index-space choice must stay stable.",
  },
  {
    id: "auto_decision_guardrails",
    label: "auto decision guardrails",
    policy: "auto",
    promptMode: "literal",
    focusCategory: "decision",
    embedderInstruction:
      "Retrieve stable guardrails: settled defaults, compatibility rules, lane choices, and constraints that protect the retrieval substrate from invalid changes. Prefer explicit commitments and decision records over general architecture notes.",
    rerankerInstruction:
      "Rank candidates by how directly they state the decision, guardrail, or compatibility commitment the operator should preserve right now. Prefer constraints and preserved defaults over adjacent discussion.",
  },
  {
    id: "quality_decision_hybrid",
    label: "quality decision hybrid",
    policy: "quality",
    promptMode: "hybrid",
    focusCategory: "decision",
    embedderInstructionPreset: "memory.decision",
    rerankerInstruction:
      "Rank candidates by how directly they preserve a settled decision, compatibility rule, or default lane commitment. Prefer evidence that prevents invalid index-space mixing or accidental policy drift.",
  },
]

const fileSweepVariants: BenchmarkVariant[] = [
  {
    id: "quality_file_exact_owner",
    label: "quality file exact owner",
    policy: "quality",
    promptMode: "literal",
    focusCategory: "file",
    embedderInstruction:
      "Retrieve the exact file, module, symbol, or document most likely to own the current behavior. Prefer exact module names, file paths, ownership anchors, and line-of-responsibility clues over thematic similarity.",
    rerankerInstruction:
      "Rank candidates by how directly they identify the exact file, module, symbol, or document the operator should inspect or edit. Prefer exact ownership, exact module, and exact file-path evidence.",
  },
  {
    id: "auto_file_locator",
    label: "auto file locator",
    policy: "auto",
    promptMode: "literal",
    focusCategory: "file",
    embedderInstruction:
      "Retrieve locator evidence for the current behavior: exact file paths, source modules, symbols, and ownership anchors. Prefer exact location evidence and exact module references over broad semantic similarity.",
    rerankerInstruction:
      "Rank candidates by how well they point to the exact file or module that owns the behavior. Prefer exact file-path, exact ownership, and exact symbol cues over general relevance.",
  },
  {
    id: "quality_file_hybrid",
    label: "quality file hybrid",
    policy: "quality",
    promptMode: "hybrid",
    focusCategory: "file",
    embedderInstructionPreset: "memory.file",
    rerankerInstruction:
      "Rank candidates by how directly they identify the exact file, module, symbol, or ownership anchor the operator probably needs. Prefer exact file-location evidence and exact ownership over thematic matches.",
  },
]

const compactionSweepVariants: BenchmarkVariant[] = [
  {
    id: "auto_compaction_tuned",
    label: "auto compaction tuned",
    policy: "auto",
    promptMode: "preset",
    focusCategory: "compaction",
    embedderInstructionPreset: "memory.compaction",
    rerankerInstructionPreset: "memory.compaction",
  },
  {
    id: "auto_compaction_literal",
    label: "auto compaction literal",
    policy: "auto",
    promptMode: "literal",
    focusCategory: "compaction",
    embedderInstruction:
      "Retrieve the short technical anchors, operational constraints, identifiers, filenames, and durable commitments that must survive compaction. Prefer terse but durable engineering anchors over general semantic similarity.",
    rerankerInstruction:
      "Rank candidates by how strongly they should survive compaction as durable memory. Prefer short technical anchors, filenames, identifiers, and operational constraints over broader discussion.",
  },
  {
    id: "quality_compaction_literal",
    label: "quality compaction literal",
    policy: "quality",
    promptMode: "literal",
    focusCategory: "compaction",
    embedderInstruction:
      "Retrieve the most durable compactable facts: short technical identifiers, filenames, constraints, and commitments that future turns would regret losing. Prefer compact retention value over thematic breadth.",
    rerankerInstruction:
      "Rank candidates by compaction survival value. Prefer exact technical anchors, filenames, constraints, and commitments that preserve future retrieval utility even when they are short.",
  },
  {
    id: "auto_compaction_hybrid",
    label: "auto compaction hybrid",
    policy: "auto",
    promptMode: "hybrid",
    focusCategory: "compaction",
    embedderInstructionPreset: "memory.compaction",
    rerankerInstruction:
      "Rank candidates by how well they preserve short technical anchors, filenames, identifiers, and operational constraints that should survive compaction. Prefer durable retention value over adjacent context.",
  },
]

const defaultVariants: BenchmarkVariant[] = [
  ...baseVariants,
  ...decisionSweepVariants,
  ...fileSweepVariants,
  ...compactionSweepVariants,
]

export const SEEDED_RETRIEVAL_QUALITY_SCENARIOS: RetrievalQualityBenchmarkScenario[] = [
  {
    id: "decision_lane_rule",
    category: "decision",
    query: "preserve the retrieval lane policy and keep mixed embedding sizes isolated",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "lane policy decision and index-space isolation rule",
    lexicalBleed: { file: 2, task_pattern: 1 },
  },
  {
    id: "decision_constraint_memory",
    category: "decision",
    query: "what settled instruction says do not mix embedding sizes in one index",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "settled instruction about embedding compatibility",
    lexicalBleed: { file: 1, compaction: 1 },
  },
  {
    id: "decision_default_lane",
    category: "decision",
    query: "which lane should stay the default matched pair on the laptop gpu profile",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "default auto lane decision for laptop hardware",
    lexicalBleed: { recovery: 1, task_pattern: 1 },
  },
  {
    id: "recovery_provider_fallback",
    category: "recovery",
    query: "find the similar provider fallback failure and recovery path",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "provider fallback degradation and recovery",
    lexicalBleed: { decision: 1, file: 1 },
  },
  {
    id: "recovery_scope_leak",
    category: "recovery",
    query: "where did feedback bias leak across sessions and how was it fixed",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "cross-session feedback leak recovery",
    lexicalBleed: { decision: 1, file: 2 },
  },
  {
    id: "recovery_diagnostics",
    category: "recovery",
    query: "show the retrieval failure diagnostics for degraded rerank mode",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "fallback diagnostics truthfulness",
    lexicalBleed: { file: 1, compaction: 1 },
  },
  {
    id: "task_pattern_bounded_worker",
    category: "task_pattern",
    query: "similar bounded worker patch for a retrieval substrate fix",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "bounded worker execution pattern",
    lexicalBleed: { decision: 1, recovery: 1 },
  },
  {
    id: "task_pattern_narrow_fix",
    category: "task_pattern",
    query: "pattern for keeping the fix narrow and preserving the regression",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "narrow patch execution pattern",
    lexicalBleed: { decision: 1, compaction: 1 },
  },
  {
    id: "file_service_lookup",
    category: "file",
    query: "which file owns scoped feedback bias and retrieval run metadata",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "retrieval service file ownership",
    lexicalBleed: { decision: 2, recovery: 1 },
  },
  {
    id: "file_compaction_lookup",
    category: "file",
    query: "which file owns the short query compaction baton heuristic",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "compaction file ownership",
    lexicalBleed: { compaction: 2, decision: 1 },
  },
  {
    id: "compaction_short_constraint",
    category: "compaction",
    query: "short operational constraint for compaction baton retention",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "short constraint retention baton",
    lexicalBleed: { file: 2, decision: 1 },
  },
  {
    id: "compaction_short_identifier",
    category: "compaction",
    query: "keep foo.ts alive through compaction",
    sharedContext: "cedar route substrate continuity benchmark",
    detail: "short technical identifier retention",
    lexicalBleed: { file: 2, task_pattern: 1 },
  },
]

const intentInstructions: Record<string, RetrievalIntent | undefined> = {
  "memory.decision": "decision",
  "memory.failure": "recovery",
  "memory.task_pattern": "task_pattern",
  "memory.file": "file",
  "memory.compaction": "compaction",
}

const intentLexicon: Record<RetrievalIntent, string[]> = {
  decision: ["policy", "decision", "settled", "default", "index-space", "lane"],
  recovery: ["recovery", "failure", "fallback", "diagnostics", "degraded", "rollback"],
  task_pattern: ["pattern", "worker", "patch", "narrow", "regression", "bounded"],
  file: ["file", "service.ts", "compaction.ts", "owner", "lookup", "module"],
  compaction: ["compaction", "baton", "retention", "short", "identifier", "constraint"],
}

const policyLatencyBaseline: Record<RetrievalPolicyName, number> = {
  fast: 13,
  auto: 17,
  quality: 23,
  fallback: 16,
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

function classifyInstructionIntent(text?: string): RetrievalIntent | undefined {
  if (!text) return undefined
  const normalized = text.toLowerCase()
  const ambiguousMatch = normalized.match(/\bambiguous retrieval query between (decision|recovery|task_pattern|file|compaction) and (decision|recovery|task_pattern|file|compaction)\b/)
  if (ambiguousMatch?.[1]) return ambiguousMatch[1] as RetrievalIntent
  const primaryMatch = normalized.match(/\bprimary (decision|recovery|task_pattern|file|compaction):\b/)
  if (primaryMatch?.[1]) return primaryMatch[1] as RetrievalIntent
  if (/\b(decision|constraint|default|compatibility|settled|index-space)\b/.test(normalized)) return "decision"
  if (/\b(failure|recover|recovery|fallback|regression|degraded)\b/.test(normalized)) return "recovery"
  if (/\b(pattern|bounded|decomposition|execution plan|reusable)\b/.test(normalized)) return "task_pattern"
  if (/\b(file|module|symbol|location|ownership|owner)\b/.test(normalized)) return "file"
  if (/\b(compaction|retention|identifier|anchor|durable fact|filename|survive compaction|survival value)\b/.test(normalized)) return "compaction"
  return undefined
}

function resolveVariantForScenario(input: { variant: BenchmarkVariant; scenario: RetrievalQualityBenchmarkScenario }): BenchmarkVariant {
  if (!input.variant.routeByIntent) return input.variant
  const routedPolicy = routeRetrievalPolicyByIntent({
    policy: RetrievalPolicy.resolve(input.variant.policy),
    query: input.scenario.query,
    detail: input.scenario.detail,
  })
  return {
    ...input.variant,
    focusCategory: routedPolicy.metadata?.routedIntent as RetrievalIntent | undefined,
    secondaryFocusCategory: routedPolicy.metadata?.routedIntentSecondary as RetrievalIntent | undefined,
    routingConfidence: routedPolicy.metadata?.routingConfidence as "high" | "low" | undefined,
    routingStrategy: routedPolicy.metadata?.routingStrategy as "single_intent" | "dual_intent_blend" | undefined,
    embedderInstructionPreset: routedPolicy.embedder?.instructionPreset,
    rerankerInstructionPreset: routedPolicy.reranker?.instructionPreset,
    embedderInstruction: routedPolicy.embedder?.instruction,
    rerankerInstruction: routedPolicy.reranker?.instruction,
  }
}

function resolvedInstruction(input: { preset?: string; instruction?: string }) {
  return resolveRetrievalInstruction({
    instructionPreset: input.preset,
    instruction: input.instruction,
  })
}

function instructionIntent(input: { preset?: string; instruction?: string }) {
  if (input.preset && intentInstructions[input.preset]) return intentInstructions[input.preset]
  return classifyInstructionIntent(resolvedInstruction(input))
}

function instructionStrength(input: {
  variant: BenchmarkVariant
  lane: "embedder" | "reranker"
  category: RetrievalIntent
}) {
  const preset = input.lane === "embedder" ? input.variant.embedderInstructionPreset : input.variant.rerankerInstructionPreset
  const instruction = input.lane === "embedder" ? input.variant.embedderInstruction : input.variant.rerankerInstruction
  const resolved = resolvedInstruction({ preset, instruction })?.toLowerCase() ?? ""
  const matchedPreset = preset ? getRetrievalPromptPreset(preset) : undefined
  let score = matchedPreset?.retrievalIntent === input.category ? 0.2 : 0
  if (input.category === "recovery" && /\b(fix|fallback path|resolved|cause)\b/.test(resolved)) score += 0.2
  if (input.category === "file" && /\b(file-location|ownership|exact module|exact ownership|location evidence)\b/.test(resolved)) score += 0.25
  if (input.category === "decision" && /\b(commitment|compatibility|govern|constraints?)\b/.test(resolved)) score += 0.15
  if (input.category === "compaction" && /\b(durable|technical anchors?|survive compaction|filenames?|retention value|survival value)\b/.test(resolved)) score += 0.25
  return Number(score.toFixed(4))
}

function policyQualityBias(policy: RetrievalPolicyName, category: RetrievalIntent) {
  if (policy === "quality" && (category === "decision" || category === "file" || category === "compaction")) return 0.4
  if (policy === "auto" && (category === "decision" || category === "recovery" || category === "compaction")) return 0.25
  if (policy === "fast" && category === "task_pattern") return 0.45
  return 0
}

function semanticAffinity(input: {
  scenario: RetrievalQualityBenchmarkScenario
  candidateIntent: RetrievalIntent
  variant: BenchmarkVariant
}) {
  const { scenario, candidateIntent, variant } = input
  const embedderIntent = instructionIntent({
    preset: variant.embedderInstructionPreset,
    instruction: variant.embedderInstruction,
  })
  const rerankerIntent = instructionIntent({
    preset: variant.rerankerInstructionPreset,
    instruction: variant.rerankerInstruction,
  })
  const secondaryIntent = variant.secondaryFocusCategory
  const isDualIntentBlend = variant.routingStrategy === "dual_intent_blend"
  const relevant = candidateIntent === scenario.category
  const alignedToScenario =
    embedderIntent === scenario.category ||
    rerankerIntent === scenario.category ||
    variant.focusCategory === scenario.category ||
    secondaryIntent === scenario.category

  let score = relevant ? 0.9 : 0.25
  if (!relevant && candidateIntent === "file" && scenario.category === "compaction") score += 0.25
  if (!relevant && candidateIntent === "decision" && scenario.category === "file") score += 0.2

  if (embedderIntent === scenario.category && relevant) score += 0.4
  if (embedderIntent && embedderIntent !== scenario.category && candidateIntent === embedderIntent) score += 0.55
  if (rerankerIntent === scenario.category && relevant) score += 0.2
  if (variant.focusCategory === scenario.category && relevant) score += 0.25
  if (secondaryIntent === scenario.category && relevant) score += isDualIntentBlend ? 0.08 : 0.15
  if (variant.focusCategory && variant.focusCategory !== scenario.category && candidateIntent === variant.focusCategory) score += 0.35
  if (secondaryIntent && secondaryIntent !== scenario.category && candidateIntent === secondaryIntent) {
    score += isDualIntentBlend ? 0.08 : 0.2
  }
  if (
    isDualIntentBlend &&
    variant.focusCategory &&
    secondaryIntent &&
    candidateIntent === secondaryIntent &&
    scenario.category === variant.focusCategory
  ) {
    score -= 0.12
  }
  if (relevant && !alignedToScenario) score -= 0.25
  score += instructionStrength({ variant, lane: "embedder", category: scenario.category })
  score += instructionStrength({ variant, lane: "reranker", category: scenario.category }) * 0.45

  score += policyQualityBias(variant.policy, scenario.category)

  return Number(score.toFixed(4))
}

function lexicalBias(input: { scenario: RetrievalQualityBenchmarkScenario; candidateIntent: RetrievalIntent }) {
  return input.scenario.lexicalBleed?.[input.candidateIntent] ?? 0
}

function buildScenarioCandidates(scenario: RetrievalQualityBenchmarkScenario): SeededCandidate[] {
  const queryTokens = tokenize(scenario.query)
  return intents.map((intent) => {
    const shared = scenario.sharedContext
    const detail = scenario.detail
    const intentTerms = intentLexicon[intent].join(" ")
    const overlap = queryTokens.slice(0, Math.min(lexicalBias({ scenario, candidateIntent: intent }), queryTokens.length)).join(" ")
    const content = [
      shared,
      `[intent:${intent}]`,
      detail,
      `Focus: ${intentTerms}.`,
      overlap ? `Bleed terms: ${overlap}.` : "",
      `This benchmark note targets ${intent.replace("_", " ")} retrieval for ${scenario.query}.`,
    ]
      .filter(Boolean)
      .join(" ")

    return {
      documentID: `${scenario.id}-${intent}`,
      intent,
      title: `${scenario.id} ${intent.replace("_", " ")}`,
      content,
    }
  })
}

function relevantDocumentID(scenario: RetrievalQualityBenchmarkScenario) {
  return `${scenario.id}-${scenario.category}`
}

function lexicalScore(query: string, candidate: SeededCandidate) {
  const haystack = new Set(tokenize(`${candidate.title} ${candidate.content}`))
  const queryTerms = tokenize(query)
  return queryTerms.reduce((sum, term) => sum + (haystack.has(term) ? 1 : 0), 0)
}

function rerankScore(input: {
  scenario: RetrievalQualityBenchmarkScenario
  candidate: SeededCandidate
  variant: BenchmarkVariant
  lexical: number
  semantic: number
}) {
  const rerankerIntent = instructionIntent({
    preset: input.variant.rerankerInstructionPreset,
    instruction: input.variant.rerankerInstruction,
  })
  const isDualIntentBlend = input.variant.routingStrategy === "dual_intent_blend"
  const relevant = input.candidate.intent === input.scenario.category
  const alignedToScenario =
    instructionIntent({
      preset: input.variant.embedderInstructionPreset,
      instruction: input.variant.embedderInstruction,
    }) === input.scenario.category ||
    rerankerIntent === input.scenario.category
  let score = input.lexical * 0.35 + input.semantic

  if (relevant) score += 0.55
  if (rerankerIntent === input.scenario.category && relevant) score += 0.45
  if (rerankerIntent && rerankerIntent !== input.scenario.category && input.candidate.intent === rerankerIntent) {
    score += 0.55
  }
  if (
    isDualIntentBlend &&
    input.variant.focusCategory &&
    input.variant.secondaryFocusCategory &&
    input.candidate.intent === input.variant.secondaryFocusCategory &&
    input.scenario.category === input.variant.focusCategory
  ) {
    score -= 0.18
  }
  if (rerankerIntent && rerankerIntent !== input.scenario.category && relevant) score -= 0.25
  if (relevant && !alignedToScenario) score -= 0.2
  score += instructionStrength({ variant: input.variant, lane: "reranker", category: input.scenario.category })

  return Number(score.toFixed(4))
}

function estimatedLatencyMS(input: { scenario: RetrievalQualityBenchmarkScenario; variant: BenchmarkVariant }) {
  const base = policyLatencyBaseline[input.variant.policy]
  const embedderIntent = instructionIntent({
    preset: input.variant.embedderInstructionPreset,
    instruction: input.variant.embedderInstruction,
  })
  const rerankerIntent = instructionIntent({
    preset: input.variant.rerankerInstructionPreset,
    instruction: input.variant.rerankerInstruction,
  })
  const specializationCost =
    (embedderIntent && embedderIntent !== input.scenario.category ? 1 : 0) +
    (rerankerIntent && rerankerIntent !== input.scenario.category ? 1 : 0)
  const literalPromptCost =
    (input.variant.embedderInstruction && !input.variant.embedderInstructionPreset ? 1 : 0) +
    (input.variant.rerankerInstruction && !input.variant.rerankerInstructionPreset ? 1 : 0)
  return base + specializationCost + literalPromptCost + (input.scenario.id.length % 3)
}

async function runScenarioVariant(input: {
  scenario: RetrievalQualityBenchmarkScenario
  variant: BenchmarkVariant
}): Promise<RetrievalQualityScenarioResult> {
  const scenarioVariant = resolveVariantForScenario(input)
  const candidates = buildScenarioCandidates(input.scenario).map((seeded) => {
    const lexical = lexicalScore(input.scenario.query, seeded)
    const semantic = semanticAffinity({
      scenario: input.scenario,
      candidateIntent: seeded.intent,
      variant: scenarioVariant,
    })
    const candidate: RetrievalChunkCandidate = {
      chunkID: `${seeded.documentID}-chunk-0`,
      documentID: seeded.documentID,
      sourceType: "note",
      title: seeded.title,
      content: seeded.content,
      score: Number((lexical + semantic).toFixed(4)),
      rerankScore: rerankScore({
        scenario: input.scenario,
        candidate: seeded,
        variant: scenarioVariant,
        lexical,
        semantic,
      }),
      outcomeScore: seeded.intent === input.scenario.category ? 0.05 : 0,
      feedbackScore:
        (scenarioVariant.id === "auto_failure_tuned" || scenarioVariant.id === "auto_routed_best_of_category") &&
        input.scenario.category === "recovery" &&
        seeded.intent === "recovery"
          ? 0.2
          : 0,
    }
    return candidate
  })

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      score: Number(
        (
          candidate.score +
          (candidate.rerankScore ?? 0) +
          (candidate.outcomeScore ?? 0) +
          (candidate.feedbackScore ?? 0)
        ).toFixed(4),
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
  const expected = relevantDocumentID(input.scenario)
  const rank = ranked.findIndex((candidate) => candidate.documentID === expected)

  return {
    scenarioID: input.scenario.id,
    category: input.scenario.category,
    variantID: input.variant.id,
    topDocumentID: ranked[0]?.documentID,
    top3Hit: rank >= 0,
    reciprocalRank: rank >= 0 ? 1 / (rank + 1) : 0,
    elapsedMS: estimatedLatencyMS({ scenario: input.scenario, variant: scenarioVariant }),
  } satisfies RetrievalQualityScenarioResult
}

function summarizeVariant(
  variant: BenchmarkVariant,
  results: RetrievalQualityScenarioResult[],
  scenarios: RetrievalQualityBenchmarkScenario[],
): RetrievalQualityVariantResult {
  const resolved = RetrievalPolicy.resolve(variant.policy)
  const top1Correct = results.filter((item) => item.topDocumentID === relevantDocumentID(scenarios.find((scenario) => scenario.id === item.scenarioID)!)).length
  const top3Correct = results.filter((item) => item.top3Hit).length

  const categorySummary = intents
    .map((category) => {
      const matches = results.filter((item) => item.category === category)
      if (matches.length === 0) return undefined
      const top1 = matches.filter(
        (item) => item.topDocumentID === relevantDocumentID(scenarios.find((scenario) => scenario.id === item.scenarioID)!),
      ).length
      const top3 = matches.filter((item) => item.top3Hit).length
      const mrr = matches.reduce((sum, item) => sum + item.reciprocalRank, 0) / matches.length
      return {
        category,
        scenarioCount: matches.length,
        top1Accuracy: Number((top1 / matches.length).toFixed(4)),
        top3Recall: Number((top3 / matches.length).toFixed(4)),
        meanReciprocalRank: Number(mrr.toFixed(4)),
      }
    })
    .filter((item): item is NonNullable<typeof item> => !!item)

  return {
    id: variant.id,
    label: variant.label,
    policy: variant.policy,
    promptMode:
      variant.promptMode ??
      (variant.embedderInstruction || variant.rerankerInstruction
        ? "literal"
        : variant.embedderInstructionPreset && variant.rerankerInstructionPreset
          ? "preset"
          : "hybrid"),
    focusCategory: variant.focusCategory,
    embedderModelID: resolved.embedder?.modelID,
    rerankerModelID: resolved.reranker?.modelID,
    embedderInstructionPreset: variant.embedderInstructionPreset,
    rerankerInstructionPreset: variant.rerankerInstructionPreset,
    embedderInstruction: variant.embedderInstruction,
    rerankerInstruction: variant.rerankerInstruction,
    scenarioCount: results.length,
    top1Accuracy: Number((top1Correct / results.length).toFixed(4)),
    top3Recall: Number((top3Correct / results.length).toFixed(4)),
    meanReciprocalRank: Number((results.reduce((sum, item) => sum + item.reciprocalRank, 0) / results.length).toFixed(4)),
    averageElapsedMS: Math.round(results.reduce((sum, item) => sum + item.elapsedMS, 0) / results.length),
    categorySummary,
    results,
  }
}

export async function runRetrievalQualityBenchmark(input: {
  prepareWorkspace: WorkspacePreparer
  variants?: BenchmarkVariant[]
  scenarios?: RetrievalQualityBenchmarkScenario[]
}): Promise<RetrievalQualityBenchmarkResult> {
  const variants = input.variants ?? defaultVariants
  const scenarios = input.scenarios ?? SEEDED_RETRIEVAL_QUALITY_SCENARIOS
  const variantResults: RetrievalQualityVariantResult[] = []

  for (const variant of variants) {
    const scenarioResults: RetrievalQualityScenarioResult[] = []
    for (const scenario of scenarios) {
      await input.prepareWorkspace(`${variant.id}__${scenario.id}`)
      scenarioResults.push(
        await runScenarioVariant({
          scenario,
          variant,
        }),
      )
    }
    variantResults.push(summarizeVariant(variant, scenarioResults, scenarios))
  }

  const overallWinner = [...variantResults].sort((a, b) => {
    if (b.top1Accuracy !== a.top1Accuracy) return b.top1Accuracy - a.top1Accuracy
    if (b.meanReciprocalRank !== a.meanReciprocalRank) return b.meanReciprocalRank - a.meanReciprocalRank
    return a.averageElapsedMS - b.averageElapsedMS
  })[0]

  const categoryLeaders = intents.map((category) => {
    const winner = [...variantResults].sort((a, b) => {
      const aCategory = a.categorySummary.find((item) => item.category === category)
      const bCategory = b.categorySummary.find((item) => item.category === category)
      const aTop1 = aCategory?.top1Accuracy ?? 0
      const bTop1 = bCategory?.top1Accuracy ?? 0
      if (bTop1 !== aTop1) return bTop1 - aTop1
      const aMRR = aCategory?.meanReciprocalRank ?? 0
      const bMRR = bCategory?.meanReciprocalRank ?? 0
      if (bMRR !== aMRR) return bMRR - aMRR
      return a.averageElapsedMS - b.averageElapsedMS
    })[0]
    const winnerCategory = winner.categorySummary.find((item) => item.category === category)!
    return {
      category,
      variantID: winner.id,
      top1Accuracy: winnerCategory.top1Accuracy,
      meanReciprocalRank: winnerCategory.meanReciprocalRank,
    }
  })

  return {
    suite: "retrieval_quality",
    scenarioCount: scenarios.length,
    variantCount: variants.length,
    variants: variantResults,
    overallWinner: {
      id: overallWinner.id,
      top1Accuracy: overallWinner.top1Accuracy,
      meanReciprocalRank: overallWinner.meanReciprocalRank,
    },
    categoryLeaders,
  }
}
