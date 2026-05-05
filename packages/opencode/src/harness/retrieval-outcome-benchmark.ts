// @ts-nocheck
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import type { SemanticBenchmarkModel } from "./semantic-benchmark"
import { canonical, isLooseCorrect, normalize } from "./answer"

type WorkspacePreparer = (scenarioID: string) => Promise<string> | string
const PROMPT_TIMEOUT_MS = Number(process.env.HARNESS_BENCH_PROMPT_TIMEOUT_MS ?? "120000")

export type RetrievalOutcomeProgressEvent =
  | {
      type: "scenario_start"
      benchmarkModel: SemanticBenchmarkModel
      scenarioID: string
      category: RetrievalOutcomeScenarioResult["category"]
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

export type RetrievalOutcomeScenarioResult = {
  id: string
  category: "answering" | "recovery" | "scope" | "context" | "delivery"
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

export type RetrievalOutcomeBenchmarkResult = {
  suite: "retrieval_outcome_lift"
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
    category: RetrievalOutcomeScenarioResult["category"]
    scenarioCount: number
    baselineCorrectCount: number
    semanticCorrectCount: number
    baselineLooseCorrectCount: number
    semanticLooseCorrectCount: number
    decisionLift: number
    looseDecisionLift: number
  }>
  results: RetrievalOutcomeScenarioResult[]
}

export type RetrievalOutcomeLiftProfile =
  | "strong_outcome_gain_strong_control"
  | "strong_outcome_gain_weak_control"
  | "control_without_outcome_gain"
  | "weak_outcome_gain"

type ScenarioDefinition = {
  id: string
  category: RetrievalOutcomeScenarioResult["category"]
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
    id: "answer_directly_from_live_findings",
    category: "answering",
    expected: "answer_directly",
    baselinePrompt: [
      "Choose the best next outcome action.",
      "Task: you already ran the benchmark, you already have the result, and the user now asks for the result summary.",
      "Options: answer_directly, rerun_benchmark, gather_more_context.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next outcome action.",
      "Task: you already ran the benchmark, you already have the result, and the user now asks for the result summary.",
      "Semantic memory: when the result is already in hand, answer directly instead of rerunning work or pretending more context is needed.",
      "Options: answer_directly, rerun_benchmark, gather_more_context.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "rerun_targeted_check_after_single_failure",
    category: "recovery",
    expected: "rerun_targeted_check",
    baselinePrompt: [
      "Choose the best next outcome action.",
      "Task: one live benchmark lane failed after a single timeout on one scenario, while the rest of the recent harness work is unchanged.",
      "Options: rerun_targeted_check, broad_rework, answer_directly.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next outcome action.",
      "Task: one live benchmark lane failed after a single timeout on one scenario, while the rest of the recent harness work is unchanged.",
      "Semantic memory: when one scenario times out but the lane otherwise looks healthy, the next move is a narrow rerun or observability pass, not a broad rework.",
      "Options: rerun_targeted_check, broad_rework, answer_directly.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "escalate_scope_after_new_write_set",
    category: "scope",
    expected: "escalate_scope",
    baselinePrompt: [
      "Choose the best next outcome action.",
      "Task: while fixing a local retrieval seam, new evidence shows the issue also touches sync policy and transcript recovery in separate modules that were not part of the agreed slice.",
      "Options: escalate_scope, ship_patch_now, gather_more_context.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next outcome action.",
      "Task: while fixing a local retrieval seam, new evidence shows the issue also touches sync policy and transcript recovery in separate modules that were not part of the agreed slice.",
      "Semantic memory: when the write set materially widens beyond the original slice, the seat should re-ground scope before pretending the old patch boundary still holds.",
      "Options: escalate_scope, ship_patch_now, gather_more_context.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "gather_context_before_crosscut_decision",
    category: "context",
    expected: "gather_more_context",
    baselinePrompt: [
      "Choose the best next outcome action.",
      "Task: a regression may live in retrieval routing, candidate ranking, or transcript sync, and no one yet knows which logs or traces are canonical.",
      "Options: gather_more_context, split_parallel_fix, ship_patch_now.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next outcome action.",
      "Task: a regression may live in retrieval routing, candidate ranking, or transcript sync, and no one yet knows which logs or traces are canonical.",
      "Semantic memory: successful harness work did one evidence-building pass first when the root cause and canonical evidence source were still unclear.",
      "Options: gather_more_context, split_parallel_fix, ship_patch_now.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "ship_bounded_patch_after_seam_fix",
    category: "delivery",
    expected: "ship_bounded_patch",
    baselinePrompt: [
      "Choose the best next outcome action.",
      "Task: you isolated one render-seam crash, fixed it with a narrow coercion helper, and added a focused regression test that passes.",
      "Options: ship_bounded_patch, broad_rework, rerun_full_matrix.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next outcome action.",
      "Task: you isolated one render-seam crash, fixed it with a narrow coercion helper, and added a focused regression test that passes.",
      "Semantic memory: similar single-seam fixes shipped best as bounded patches with focused verification, not by reopening nearby cleanups or expanding the lane.",
      "Options: ship_bounded_patch, broad_rework, rerun_full_matrix.",
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

export function renderRetrievalOutcomePromptFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/timed out/i.test(message)) return "error_timeout"
  return "error"
}

async function runPrompt(sessionID: string, model: SemanticBenchmarkModel, text: string) {
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
      output: renderRetrievalOutcomePromptFailure(error),
      elapsedMS: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runScenarioWithProgress(
  benchmarkModel: SemanticBenchmarkModel,
  scenario: ScenarioDefinition,
  onProgress?: (event: RetrievalOutcomeProgressEvent) => void,
) {
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
    } satisfies RetrievalOutcomeScenarioResult
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

export function classifyRetrievalOutcomeLift(
  result: Pick<RetrievalOutcomeBenchmarkResult, "decisionLift" | "looseDecisionLift">,
) {
  if (result.looseDecisionLift > 0 && result.decisionLift > 0) {
    return "strong_outcome_gain_strong_control" satisfies RetrievalOutcomeLiftProfile
  }
  if (result.looseDecisionLift > 0 && result.decisionLift <= 0) {
    return "strong_outcome_gain_weak_control" satisfies RetrievalOutcomeLiftProfile
  }
  if (result.looseDecisionLift <= 0 && result.decisionLift > 0) {
    return "control_without_outcome_gain" satisfies RetrievalOutcomeLiftProfile
  }
  return "weak_outcome_gain" satisfies RetrievalOutcomeLiftProfile
}

export function retrievalOutcomePolicyHint(profile: RetrievalOutcomeLiftProfile) {
  switch (profile) {
    case "strong_outcome_gain_strong_control":
      return "good default for retrieval-influenced next-step decisions"
    case "strong_outcome_gain_weak_control":
      return "useful for outcome choice, but pair with stricter output control"
    case "control_without_outcome_gain":
      return "format-safe, but retrieval is not improving next decisions much yet"
    case "weak_outcome_gain":
      return "do not prioritize for retrieval-driven outcome routing yet"
  }
}

export async function runRetrievalOutcomeBenchmark(input: {
  benchmarkModel?: SemanticBenchmarkModel
  prepareWorkspace: WorkspacePreparer
  onProgress?: (event: RetrievalOutcomeProgressEvent) => void
}): Promise<RetrievalOutcomeBenchmarkResult> {
  const benchmarkModel = input.benchmarkModel ?? defaultBenchmarkModel
  const results: RetrievalOutcomeScenarioResult[] = []

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
    suite: "retrieval_outcome_lift",
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
