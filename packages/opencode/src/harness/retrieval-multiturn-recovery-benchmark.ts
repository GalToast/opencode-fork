// @ts-nocheck
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import type { SemanticBenchmarkModel } from "./semantic-benchmark"
import { canonical, isLooseCorrect, normalize } from "./answer"

type WorkspacePreparer = (scenarioID: string) => Promise<string> | string
const PROMPT_TIMEOUT_MS = Number(process.env.HARNESS_BENCH_PROMPT_TIMEOUT_MS ?? "120000")

export type RetrievalMultiturnRecoveryProgressEvent =
  | {
      type: "scenario_start"
      benchmarkModel: SemanticBenchmarkModel
      scenarioID: string
      category: RetrievalMultiturnRecoveryScenarioResult["category"]
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

export type RetrievalMultiturnRecoveryScenarioResult = {
  id: string
  category: "timeout" | "correction" | "scope" | "partial_progress" | "evidence_conflict"
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

export type RetrievalMultiturnRecoveryBenchmarkResult = {
  suite: "retrieval_multiturn_recovery_lift"
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
    category: RetrievalMultiturnRecoveryScenarioResult["category"]
    scenarioCount: number
    baselineCorrectCount: number
    semanticCorrectCount: number
    baselineLooseCorrectCount: number
    semanticLooseCorrectCount: number
    decisionLift: number
    looseDecisionLift: number
  }>
  results: RetrievalMultiturnRecoveryScenarioResult[]
}

export type RetrievalMultiturnRecoveryLiftProfile =
  | "strong_recovery_gain_strong_control"
  | "strong_recovery_gain_weak_control"
  | "control_without_recovery_gain"
  | "weak_recovery_gain"

type ScenarioDefinition = {
  id: string
  category: RetrievalMultiturnRecoveryScenarioResult["category"]
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
    id: "timeout_then_narrow_retry",
    category: "timeout",
    expected: "rerun_narrow_step",
    baselinePrompt: [
      "Choose the best next recovery action.",
      "Task: one bounded benchmark scenario timed out, but the rest of the lane is healthy and no new evidence changed the scope.",
      "Options: rerun_narrow_step, broad_replan, abandon_lane.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next recovery action.",
      "Task: one bounded benchmark scenario timed out, but the rest of the lane is healthy and no new evidence changed the scope.",
      "Semantic memory: when one step times out in an otherwise healthy lane, recover with a narrow rerun or observability pass instead of broad replanning.",
      "Options: rerun_narrow_step, broad_replan, abandon_lane.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "user_correction_changes_owner",
    category: "correction",
    expected: "replan_from_correction",
    baselinePrompt: [
      "Choose the best next recovery action.",
      "Task: the user corrects your earlier assumption and names the real owning module after you had been investigating the wrong file.",
      "Options: replan_from_correction, continue_old_path, split_parallel_anyway.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next recovery action.",
      "Task: the user corrects your earlier assumption and names the real owning module after you had been investigating the wrong file.",
      "Semantic memory: once the user supplies the corrected owner, throw away the stale path and re-ground the plan from that correction instead of defending the old line of work.",
      "Options: replan_from_correction, continue_old_path, split_parallel_anyway.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "new_evidence_widens_write_set",
    category: "scope",
    expected: "escalate_scope",
    baselinePrompt: [
      "Choose the best next recovery action.",
      "Task: a local fix uncovered evidence that the bug also touches sync policy and a second subsystem outside the agreed slice.",
      "Options: escalate_scope, keep_old_scope, answer_done.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next recovery action.",
      "Task: a local fix uncovered evidence that the bug also touches sync policy and a second subsystem outside the agreed slice.",
      "Semantic memory: when the write set materially widens, recovery means re-grounding scope rather than pretending the old boundary still holds.",
      "Options: escalate_scope, keep_old_scope, answer_done.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "verified_partial_progress_resume",
    category: "partial_progress",
    expected: "resume_from_verified_state",
    baselinePrompt: [
      "Choose the best next recovery action.",
      "Task: one patch and one focused test already landed cleanly, and only the final narrow follow-up step remains.",
      "Options: resume_from_verified_state, restart_from_zero, escalate_scope.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next recovery action.",
      "Task: one patch and one focused test already landed cleanly, and only the final narrow follow-up step remains.",
      "Semantic memory: when partial progress is already verified, continue from that verified state instead of discarding clean work.",
      "Options: resume_from_verified_state, restart_from_zero, escalate_scope.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "conflicting_logs_need_regrounding",
    category: "evidence_conflict",
    expected: "reground_from_evidence",
    baselinePrompt: [
      "Choose the best next recovery action.",
      "Task: the transcript, trace log, and user report now disagree about what happened last, so the current state is no longer trustworthy.",
      "Options: reground_from_evidence, continue_latest_guess, ship_patch_now.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next recovery action.",
      "Task: the transcript, trace log, and user report now disagree about what happened last, so the current state is no longer trustworthy.",
      "Semantic memory: when evidence sources conflict, stop guessing and rebuild the state from the canonical evidence before continuing.",
      "Options: reground_from_evidence, continue_latest_guess, ship_patch_now.",
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

export function renderRetrievalMultiturnRecoveryPromptFailure(error: unknown) {
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
      output: renderRetrievalMultiturnRecoveryPromptFailure(error),
      elapsedMS: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runScenarioWithProgress(
  benchmarkModel: SemanticBenchmarkModel,
  scenario: ScenarioDefinition,
  onProgress?: (event: RetrievalMultiturnRecoveryProgressEvent) => void,
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
    } satisfies RetrievalMultiturnRecoveryScenarioResult
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

export function classifyRetrievalMultiturnRecoveryLift(
  result: Pick<RetrievalMultiturnRecoveryBenchmarkResult, "decisionLift" | "looseDecisionLift">,
) {
  if (result.looseDecisionLift > 0 && result.decisionLift > 0) {
    return "strong_recovery_gain_strong_control" satisfies RetrievalMultiturnRecoveryLiftProfile
  }
  if (result.looseDecisionLift > 0 && result.decisionLift <= 0) {
    return "strong_recovery_gain_weak_control" satisfies RetrievalMultiturnRecoveryLiftProfile
  }
  if (result.looseDecisionLift <= 0 && result.decisionLift > 0) {
    return "control_without_recovery_gain" satisfies RetrievalMultiturnRecoveryLiftProfile
  }
  return "weak_recovery_gain" satisfies RetrievalMultiturnRecoveryLiftProfile
}

export function retrievalMultiturnRecoveryPolicyHint(profile: RetrievalMultiturnRecoveryLiftProfile) {
  switch (profile) {
    case "strong_recovery_gain_strong_control":
      return "good default for retrieval-influenced recovery and replanning"
    case "strong_recovery_gain_weak_control":
      return "useful for recovery choice, but pair with stricter output control"
    case "control_without_recovery_gain":
      return "format-safe, but retrieval is not improving recovery decisions much yet"
    case "weak_recovery_gain":
      return "do not prioritize for retrieval-driven recovery routes yet"
  }
}

export async function runRetrievalMultiturnRecoveryBenchmark(input: {
  benchmarkModel?: SemanticBenchmarkModel
  prepareWorkspace: WorkspacePreparer
  onProgress?: (event: RetrievalMultiturnRecoveryProgressEvent) => void
}): Promise<RetrievalMultiturnRecoveryBenchmarkResult> {
  const benchmarkModel = input.benchmarkModel ?? defaultBenchmarkModel
  const results: RetrievalMultiturnRecoveryScenarioResult[] = []

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
    suite: "retrieval_multiturn_recovery_lift",
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
