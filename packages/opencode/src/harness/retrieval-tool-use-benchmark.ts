// @ts-nocheck
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import type { SemanticBenchmarkModel } from "./semantic-benchmark"
import { canonical, isLooseCorrect, normalize } from "./answer"

type WorkspacePreparer = (scenarioID: string) => Promise<string> | string
const PROMPT_TIMEOUT_MS = Number(process.env.HARNESS_BENCH_PROMPT_TIMEOUT_MS ?? "120000")
export type RetrievalToolUseProgressEvent =
  | {
      type: "scenario_start"
      benchmarkModel: SemanticBenchmarkModel
      scenarioID: string
      category: RetrievalToolUseScenarioResult["category"]
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

export type RetrievalToolUseScenarioResult = {
  id: string
  category: "inspect_first" | "tool_breadth" | "restraint" | "locality" | "edit_posture"
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

export type RetrievalToolUseBenchmarkResult = {
  suite: "retrieval_tool_use_lift"
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
    category: RetrievalToolUseScenarioResult["category"]
    scenarioCount: number
    baselineCorrectCount: number
    semanticCorrectCount: number
    baselineLooseCorrectCount: number
    semanticLooseCorrectCount: number
    decisionLift: number
    looseDecisionLift: number
  }>
  results: RetrievalToolUseScenarioResult[]
}

export type RetrievalToolUseLiftProfile =
  | "strong_tool_judgment_strong_control"
  | "strong_tool_judgment_weak_control"
  | "control_without_tool_gain"
  | "weak_tool_gain"

type ScenarioDefinition = {
  id: string
  category: RetrievalToolUseScenarioResult["category"]
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
    id: "inspect_before_edit_same_file",
    category: "inspect_first",
    expected: "inspect_first",
    baselinePrompt: [
      "Choose the best next tool-use posture for a code task.",
      "Task: you plan to edit one known file, but the bug report cites old line numbers and the file may have changed since the last attempt.",
      "Options: inspect_first, edit_now, broad_search_then_edit.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next tool-use posture for a code task.",
      "Task: you plan to edit one known file, but the bug report cites old line numbers and the file may have changed since the last attempt.",
      "Semantic memory: when the file may have shifted, read the live seam first instead of editing from stale context.",
      "Options: inspect_first, edit_now, broad_search_then_edit.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "one_targeted_read_not_tool_sweep",
    category: "tool_breadth",
    expected: "single_targeted_tool",
    baselinePrompt: [
      "Choose the best tool-use breadth for a repo task.",
      "Task: the user already named one likely owner file and one likely helper, and you only need to confirm which module owns the behavior.",
      "Options: single_targeted_tool, multi_tool_sweep, no_tool_needed.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best tool-use breadth for a repo task.",
      "Task: the user already named one likely owner file and one likely helper, and you only need to confirm which module owns the behavior.",
      "Semantic memory: when the seam is already narrow, check the most likely owner directly instead of fanning out across a broad tool sweep.",
      "Options: single_targeted_tool, multi_tool_sweep, no_tool_needed.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "no_tool_for_policy_recall",
    category: "restraint",
    expected: "no_tool_needed",
    baselinePrompt: [
      "Choose the best tool-use posture for answering the user.",
      "Task: the user asks for the next benchmarking direction after you just finished running and interpreting replay and router benchmark results in this same turn.",
      "Options: no_tool_needed, single_targeted_tool, multi_tool_sweep.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best tool-use posture for answering the user.",
      "Task: the user asks for the next benchmarking direction after you just finished running and interpreting replay and router benchmark results in this same turn.",
      "Semantic memory: when the needed evidence already exists in the active turn state, the harness should answer directly instead of re-opening files or rerunning searches.",
      "Options: no_tool_needed, single_targeted_tool, multi_tool_sweep.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "prefer_local_repo_over_webfetch",
    category: "locality",
    expected: "local_repo_tool",
    baselinePrompt: [
      "Choose the best first tool family.",
      "Task: answer which local source file defines a retrieval router rule inside the current repo.",
      "Options: local_repo_tool, webfetch_remote, ask_user_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best first tool family.",
      "Task: answer which local source file defines a retrieval router rule inside the current repo.",
      "Semantic memory: previous misses came from reaching for web fetch or remote context even though the answer lived in the checked-out repo and local inspection was faster and safer.",
      "Options: local_repo_tool, webfetch_remote, ask_user_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "bounded_edit_not_broad_refactor",
    category: "edit_posture",
    expected: "bounded_edit",
    baselinePrompt: [
      "Choose the best implementation posture.",
      "Task: fix one TUI crash caused by a color-shape mismatch at a single render seam, while a few nearby style utilities also look inconsistent.",
      "Options: bounded_edit, broad_refactor, inspect_only.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best implementation posture.",
      "Task: fix one TUI crash caused by a color-shape mismatch at a single render seam, while a few nearby style utilities also look inconsistent.",
      "Semantic memory: similar bugs were solved best with a tiny seam-level coercion helper plus focused regression coverage, not a broad style-system rewrite.",
      "Options: bounded_edit, broad_refactor, inspect_only.",
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

export function renderRetrievalToolUsePromptFailure(error: unknown) {
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
      output: renderRetrievalToolUsePromptFailure(error),
      elapsedMS: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runScenarioWithProgress(
  benchmarkModel: SemanticBenchmarkModel,
  scenario: ScenarioDefinition,
  onProgress?: (event: RetrievalToolUseProgressEvent) => void,
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
    } satisfies RetrievalToolUseScenarioResult
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

export function classifyRetrievalToolUseLift(
  result: Pick<RetrievalToolUseBenchmarkResult, "decisionLift" | "looseDecisionLift">,
) {
  if (result.looseDecisionLift > 0 && result.decisionLift > 0) {
    return "strong_tool_judgment_strong_control" satisfies RetrievalToolUseLiftProfile
  }
  if (result.looseDecisionLift > 0 && result.decisionLift <= 0) {
    return "strong_tool_judgment_weak_control" satisfies RetrievalToolUseLiftProfile
  }
  if (result.looseDecisionLift <= 0 && result.decisionLift > 0) {
    return "control_without_tool_gain" satisfies RetrievalToolUseLiftProfile
  }
  return "weak_tool_gain" satisfies RetrievalToolUseLiftProfile
}

export function retrievalToolUsePolicyHint(profile: RetrievalToolUseLiftProfile) {
  switch (profile) {
    case "strong_tool_judgment_strong_control":
      return "good default for retrieval-influenced tool-choice routes"
    case "strong_tool_judgment_weak_control":
      return "useful for tool judgment with enum/output sanitization"
    case "control_without_tool_gain":
      return "output-safe, but retrieval is not moving tool choice much yet"
    case "weak_tool_gain":
      return "do not prioritize for retrieval-driven tool-use routes yet"
  }
}

export async function runRetrievalToolUseBenchmark(input: {
  benchmarkModel?: SemanticBenchmarkModel
  prepareWorkspace: WorkspacePreparer
  onProgress?: (event: RetrievalToolUseProgressEvent) => void
}): Promise<RetrievalToolUseBenchmarkResult> {
  const benchmarkModel = input.benchmarkModel ?? defaultBenchmarkModel
  const results: RetrievalToolUseScenarioResult[] = []
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
    suite: "retrieval_tool_use_lift",
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
