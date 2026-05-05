// @ts-nocheck
import { canonical, isLooseCorrect, normalize } from "./answer"

type WorkspacePreparer = (scenarioID: string) => Promise<string> | string
export type RetrievalConfidenceQualityBenchmarkModel = {
  providerID: string
  modelID: string
}
type SemanticBenchmarkModel = RetrievalConfidenceQualityBenchmarkModel
const PROMPT_TIMEOUT_MS = Number(process.env.HARNESS_BENCH_PROMPT_TIMEOUT_MS ?? "120000")

export type RetrievalConfidenceQualityProgressEvent =
  | {
      type: "scenario_start"
      benchmarkModel: SemanticBenchmarkModel
      scenarioID: string
      category: RetrievalConfidenceQualityScenarioResult["category"]
    }
  | {
      type: "baseline_complete" | "semantic_complete"
      benchmarkModel: SemanticBenchmarkModel
      scenarioID: string
      output: string
      canonical: string
      elapsedMS: number
      error?: string
    }
  | {
      type: "scenario_complete"
      benchmarkModel: SemanticBenchmarkModel
      scenarioID: string
      baselineCorrect: boolean
      semanticCorrect: boolean
      baselineLooseCorrect: boolean
      semanticLooseCorrect: boolean
    }

export type RetrievalConfidenceQualityScenarioResult = {
  id: string
  category: "promotion" | "narrowing" | "mixed_evidence" | "retry" | "conflict"
  expected: string
  baselineOutput: string
  semanticOutput: string
  baselineError?: string
  semanticError?: string
  baselineCanonical: string
  semanticCanonical: string
  baselineCorrect: boolean
  semanticCorrect: boolean
  baselineLooseCorrect: boolean
  semanticLooseCorrect: boolean
  baselineElapsedMS: number
  semanticElapsedMS: number
}

export type RetrievalConfidenceQualityBenchmarkResult = {
  suite: "retrieval_confidence_quality_lift"
  benchmarkModel: SemanticBenchmarkModel
  scenarioCount: number
  baselineCorrectCount: number
  semanticCorrectCount: number
  baselineLooseCorrectCount: number
  semanticLooseCorrectCount: number
  decisionLift: number
  looseDecisionLift: number
  baselineAccuracy: number
  semanticAccuracy: number
  baselineLooseAccuracy: number
  semanticLooseAccuracy: number
  averageLatencyDeltaMS: number
  categorySummary: Array<{
    category: RetrievalConfidenceQualityScenarioResult["category"]
    scenarioCount: number
    baselineCorrectCount: number
    semanticCorrectCount: number
    baselineLooseCorrectCount: number
    semanticLooseCorrectCount: number
    decisionLift: number
    looseDecisionLift: number
  }>
  results: RetrievalConfidenceQualityScenarioResult[]
}

export type RetrievalConfidenceQualityLiftProfile =
  | "strong_confidence_gain_strong_control"
  | "strong_confidence_gain_weak_control"
  | "control_without_confidence_gain"
  | "weak_confidence_gain"

type ScenarioDefinition = {
  id: string
  category: RetrievalConfidenceQualityScenarioResult["category"]
  expected: string
  baselinePrompt: string
  semanticPrompt: string
}

const defaultBenchmarkModel: SemanticBenchmarkModel = {
  providerID: "alibaba-coding-plan" as any,
  modelID: "glm-5" as any,
}

const scenarios: ScenarioDefinition[] = [
  {
    id: "promote_after_narrow_verified_evidence",
    category: "promotion",
    expected: "promote_confidence",
    baselinePrompt: [
      "Choose the best confidence action for a staged proposal.",
      "Task: the proposal is narrow, the source files are present, and the evidence now clearly supports the fix.",
      "Options: promote_confidence, keep_confidence, narrow_scope.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best confidence action for a staged proposal.",
      "Task: the proposal is narrow, the source files are present, and the evidence now clearly supports the fix.",
      "Semantic memory: when a proposal is already narrow and source-backed, promote confidence instead of leaving it stuck.",
      "Options: promote_confidence, keep_confidence, narrow_scope.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "narrow_when_scope_is_too_broad",
    category: "narrowing",
    expected: "narrow_scope",
    baselinePrompt: [
      "Choose the best confidence action for a staged proposal.",
      "Task: the idea may be good, but the current proposal touches too many files and mixes two different fixes in one patch summary.",
      "Options: narrow_scope, promote_confidence, keep_confidence.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best confidence action for a staged proposal.",
      "Task: the idea may be good, but the current proposal touches too many files and mixes two different fixes in one patch summary.",
      "Semantic memory: broad proposals mature faster when the harness narrows scope first instead of promoting confidence on a fuzzy change.",
      "Options: narrow_scope, promote_confidence, keep_confidence.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "mixed_evidence_hold_steady",
    category: "mixed_evidence",
    expected: "keep_confidence",
    baselinePrompt: [
      "Choose the best confidence action for a staged proposal.",
      "Task: some observations support the fix, but others still point to an alternate cause and the evidence is not yet clean.",
      "Options: keep_confidence, promote_confidence, downgrade_confidence.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best confidence action for a staged proposal.",
      "Task: some observations support the fix, but others still point to an alternate cause and the evidence is not yet clean.",
      "Semantic memory: when evidence is mixed but not disproven, keep confidence flat rather than promoting too early or panicking downward.",
      "Options: keep_confidence, promote_confidence, downgrade_confidence.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "retry_helped_clarify_fix",
    category: "retry",
    expected: "promote_confidence",
    baselinePrompt: [
      "Choose the best confidence action for a staged proposal.",
      "Task: an earlier attempt was fuzzy, but one narrow retry clarified the seam and now the current proposal is specific and source-backed.",
      "Options: promote_confidence, keep_confidence, defer_for_more_evidence.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best confidence action for a staged proposal.",
      "Task: an earlier attempt was fuzzy, but one narrow retry clarified the seam and now the current proposal is specific and source-backed.",
      "Semantic memory: a retry that resolves ambiguity and tightens the patch is exactly when confidence should rise.",
      "Options: promote_confidence, keep_confidence, defer_for_more_evidence.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "conflicting_evidence_back_off",
    category: "conflict",
    expected: "defer_for_more_evidence",
    baselinePrompt: [
      "Choose the best confidence action for a staged proposal.",
      "Task: the latest observations now conflict with the proposal rationale, and no one can yet explain which evidence source is trustworthy.",
      "Options: defer_for_more_evidence, promote_confidence, keep_confidence.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best confidence action for a staged proposal.",
      "Task: the latest observations now conflict with the proposal rationale, and no one can yet explain which evidence source is trustworthy.",
      "Semantic memory: when confidence is undermined by conflicting evidence, the harness should defer and gather more evidence instead of promoting or pretending nothing changed.",
      "Options: defer_for_more_evidence, promote_confidence, keep_confidence.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
]

function textFromParts(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim()
}

export function renderRetrievalConfidenceQualityPromptFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/timed out/i.test(message)) return "error_timeout"
  return "error"
}

async function runPrompt(sessionID: string, model: SemanticBenchmarkModel, text: string) {
  const { SessionPrompt } = await import("@/session/prompt")
  const startedAt = performance.now()
  const response = await Promise.race([
    SessionPrompt.prompt({
      sessionID,
      agent: "build",
      model,
      parts: [{ type: "text", text }],
    }),
    Bun.sleep(PROMPT_TIMEOUT_MS).then(() => {
      throw new Error(`timed out after ${PROMPT_TIMEOUT_MS}ms`)
    }),
  ])
  return {
    output: textFromParts(response.parts as any),
    elapsedMS: Math.round(performance.now() - startedAt),
  }
}

async function runPromptSafely(sessionID: string, model: SemanticBenchmarkModel, text: string) {
  const startedAt = performance.now()
  try {
    const result = await runPrompt(sessionID, model, text)
    return {
      output: result.output,
      elapsedMS: result.elapsedMS,
      error: undefined as string | undefined,
    }
  } catch (error) {
    return {
      output: renderRetrievalConfidenceQualityPromptFailure(error),
      elapsedMS: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runScenarioWithProgress(
  benchmarkModel: SemanticBenchmarkModel,
  scenario: ScenarioDefinition,
  onProgress?: (event: RetrievalConfidenceQualityProgressEvent) => void,
) {
  const { Session } = await import("@/session")
  const baselineSession = await Session.create({ title: `${scenario.id}-baseline` })
  const semanticSession = await Session.create({ title: `${scenario.id}-semantic` })

  try {
    onProgress?.({
      type: "scenario_start",
      benchmarkModel,
      scenarioID: scenario.id,
      category: scenario.category,
    })
    const baseline = await runPromptSafely(baselineSession.id, benchmarkModel, scenario.baselinePrompt)
    onProgress?.({
      type: "baseline_complete",
      benchmarkModel,
      scenarioID: scenario.id,
      output: baseline.output,
      canonical: canonical(baseline.output, scenario.baselinePrompt),
      elapsedMS: baseline.elapsedMS,
      error: baseline.error,
    })
    const semantic = await runPromptSafely(semanticSession.id, benchmarkModel, scenario.semanticPrompt)
    onProgress?.({
      type: "semantic_complete",
      benchmarkModel,
      scenarioID: scenario.id,
      output: semantic.output,
      canonical: canonical(semantic.output, scenario.semanticPrompt),
      elapsedMS: semantic.elapsedMS,
      error: semantic.error,
    })

    const result = {
      id: scenario.id,
      category: scenario.category,
      expected: scenario.expected,
      baselineOutput: baseline.output,
      semanticOutput: semantic.output,
      baselineError: baseline.error,
      semanticError: semantic.error,
      baselineCanonical: canonical(baseline.output, scenario.baselinePrompt),
      semanticCanonical: canonical(semantic.output, scenario.semanticPrompt),
      baselineCorrect: normalize(baseline.output) === scenario.expected,
      semanticCorrect: normalize(semantic.output) === scenario.expected,
      baselineLooseCorrect: isLooseCorrect(baseline.output, scenario.expected, scenario.baselinePrompt),
      semanticLooseCorrect: isLooseCorrect(semantic.output, scenario.expected, scenario.semanticPrompt),
      baselineElapsedMS: baseline.elapsedMS,
      semanticElapsedMS: semantic.elapsedMS,
    } satisfies RetrievalConfidenceQualityScenarioResult
    onProgress?.({
      type: "scenario_complete",
      benchmarkModel,
      scenarioID: scenario.id,
      baselineCorrect: result.baselineCorrect,
      semanticCorrect: result.semanticCorrect,
      baselineLooseCorrect: result.baselineLooseCorrect,
      semanticLooseCorrect: result.semanticLooseCorrect,
    })
    return result
  } finally {
    await Session.remove(baselineSession.id).catch(() => {})
    await Session.remove(semanticSession.id).catch(() => {})
  }
}

export function classifyRetrievalConfidenceQualityLift(
  result: Pick<RetrievalConfidenceQualityBenchmarkResult, "decisionLift" | "looseDecisionLift">,
) {
  if (result.looseDecisionLift > 0 && result.decisionLift > 0) {
    return "strong_confidence_gain_strong_control" satisfies RetrievalConfidenceQualityLiftProfile
  }
  if (result.looseDecisionLift > 0 && result.decisionLift <= 0) {
    return "strong_confidence_gain_weak_control" satisfies RetrievalConfidenceQualityLiftProfile
  }
  if (result.looseDecisionLift <= 0 && result.decisionLift > 0) {
    return "control_without_confidence_gain" satisfies RetrievalConfidenceQualityLiftProfile
  }
  return "weak_confidence_gain" satisfies RetrievalConfidenceQualityLiftProfile
}

export function retrievalConfidenceQualityPolicyHint(profile: RetrievalConfidenceQualityLiftProfile) {
  switch (profile) {
    case "strong_confidence_gain_strong_control":
      return "good default for retrieval-influenced confidence promotion"
    case "strong_confidence_gain_weak_control":
      return "useful for confidence decisions, but pair with stricter output control"
    case "control_without_confidence_gain":
      return "format-safe, but retrieval is not improving confidence quality much yet"
    case "weak_confidence_gain":
      return "do not prioritize for retrieval-driven confidence routes yet"
  }
}

export async function runRetrievalConfidenceQualityBenchmark(input: {
  benchmarkModel?: SemanticBenchmarkModel
  prepareWorkspace: WorkspacePreparer
  onProgress?: (event: RetrievalConfidenceQualityProgressEvent) => void
}): Promise<RetrievalConfidenceQualityBenchmarkResult> {
  const benchmarkModel = input.benchmarkModel ?? defaultBenchmarkModel
  const results: RetrievalConfidenceQualityScenarioResult[] = []

  for (const scenario of scenarios) {
    await input.prepareWorkspace(scenario.id)
    results.push(await runScenarioWithProgress(benchmarkModel, scenario, input.onProgress))
  }

  const baselineCorrectCount = results.filter((result) => result.baselineCorrect).length
  const semanticCorrectCount = results.filter((result) => result.semanticCorrect).length
  const baselineLooseCorrectCount = results.filter((result) => result.baselineLooseCorrect).length
  const semanticLooseCorrectCount = results.filter((result) => result.semanticLooseCorrect).length
  const averageLatencyDeltaMS = results.length
    ? Math.round(results.reduce((sum, result) => sum + (result.semanticElapsedMS - result.baselineElapsedMS), 0) / results.length)
    : 0
  const categories = [...new Set(results.map((result) => result.category))]

  return {
    suite: "retrieval_confidence_quality_lift",
    benchmarkModel,
    scenarioCount: results.length,
    baselineCorrectCount,
    semanticCorrectCount,
    baselineLooseCorrectCount,
    semanticLooseCorrectCount,
    decisionLift: semanticCorrectCount - baselineCorrectCount,
    looseDecisionLift: semanticLooseCorrectCount - baselineLooseCorrectCount,
    baselineAccuracy: results.length ? baselineCorrectCount / results.length : 0,
    semanticAccuracy: results.length ? semanticCorrectCount / results.length : 0,
    baselineLooseAccuracy: results.length ? baselineLooseCorrectCount / results.length : 0,
    semanticLooseAccuracy: results.length ? semanticLooseCorrectCount / results.length : 0,
    averageLatencyDeltaMS,
    categorySummary: categories.map((category) => {
      const categoryResults = results.filter((result) => result.category === category)
      const categoryBaselineCorrectCount = categoryResults.filter((result) => result.baselineCorrect).length
      const categorySemanticCorrectCount = categoryResults.filter((result) => result.semanticCorrect).length
      const categoryBaselineLooseCorrectCount = categoryResults.filter((result) => result.baselineLooseCorrect).length
      const categorySemanticLooseCorrectCount = categoryResults.filter((result) => result.semanticLooseCorrect).length
      return {
        category,
        scenarioCount: categoryResults.length,
        baselineCorrectCount: categoryBaselineCorrectCount,
        semanticCorrectCount: categorySemanticCorrectCount,
        baselineLooseCorrectCount: categoryBaselineLooseCorrectCount,
        semanticLooseCorrectCount: categorySemanticLooseCorrectCount,
        decisionLift: categorySemanticCorrectCount - categoryBaselineCorrectCount,
        looseDecisionLift: categorySemanticLooseCorrectCount - categoryBaselineLooseCorrectCount,
      }
    }),
    results,
  }
}
