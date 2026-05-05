// @ts-nocheck
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import type { SemanticBenchmarkModel } from "./semantic-benchmark"
import { canonical, isLooseCorrect, normalize } from "./answer"

type WorkspacePreparer = (scenarioID: string) => Promise<string> | string
const PROMPT_TIMEOUT_MS = Number(process.env.HARNESS_BENCH_PROMPT_TIMEOUT_MS ?? "120000")

export type RetrievalParallelToolCallingProgressEvent =
  | {
      type: "scenario_start"
      benchmarkModel: SemanticBenchmarkModel
      scenarioID: string
      category: RetrievalParallelToolCallingScenarioResult["category"]
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

export type RetrievalParallelToolCallingScenarioResult = {
  id: string
  category: "parallel_reads" | "blocking_read" | "mixed_parallel" | "serial_edits" | "scope_gate"
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

export type RetrievalParallelToolCallingBenchmarkResult = {
  suite: "retrieval_parallel_tool_calling_lift"
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
    category: RetrievalParallelToolCallingScenarioResult["category"]
    scenarioCount: number
    baselineCorrectCount: number
    semanticCorrectCount: number
    baselineLooseCorrectCount: number
    semanticLooseCorrectCount: number
    decisionLift: number
    looseDecisionLift: number
  }>
  results: RetrievalParallelToolCallingScenarioResult[]
}

export type RetrievalParallelToolCallingLiftProfile =
  | "strong_parallel_judgment_strong_control"
  | "strong_parallel_judgment_weak_control"
  | "control_without_parallel_gain"
  | "weak_parallel_gain"

type ScenarioDefinition = {
  id: string
  category: RetrievalParallelToolCallingScenarioResult["category"]
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
    id: "two_independent_owner_reads",
    category: "parallel_reads",
    expected: "parallel_now",
    baselinePrompt: [
      "Choose the best same-agent tool-calling posture.",
      "Task: you already know the exact four file paths to inspect. Two read-only opens answer feature A, and two different read-only opens answer feature B. Neither check affects whether the other is needed.",
      "Options: parallel_now, parallel_after_context, stay_serial.",
      "Reply with exactly one bare option token and nothing else. No punctuation.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best same-agent tool-calling posture.",
      "Task: you already know the exact four file paths to inspect. Two read-only opens answer feature A, and two different read-only opens answer feature B. Neither check affects whether the other is needed.",
      "Semantic memory: when the reads are cleanly independent and only gather local context, same-agent parallel reads are the fastest safe move.",
      "Options: parallel_now, parallel_after_context, stay_serial.",
      "Reply with exactly one bare option token and nothing else. No punctuation.",
    ].join("\n"),
  },
  {
    id: "read_owner_before_wider_fanout",
    category: "blocking_read",
    expected: "parallel_after_context",
    baselinePrompt: [
      "Choose the best same-agent tool-calling posture.",
      "Task: one read tells you whether the next reads belong in renderer files or sync files. Until that first read finishes, the other reads may be wasted.",
      "Options: parallel_after_context, parallel_now, gather_more_context_first.",
      "Reply with exactly one bare option token and nothing else. No punctuation.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best same-agent tool-calling posture.",
      "Task: one read tells you whether the next reads belong in renderer files or sync files. Until that first read finishes, the other reads may be wasted.",
      "Semantic memory: do the blocker read first when it determines whether later fanout is necessary; parallelize only after that seam is resolved.",
      "Options: parallel_after_context, parallel_now, gather_more_context_first.",
      "Reply with exactly one bare option token and nothing else. No punctuation.",
    ].join("\n"),
  },
  {
    id: "mixed_local_read_and_log_check",
    category: "mixed_parallel",
    expected: "parallel_now",
    baselinePrompt: [
      "Choose the best same-agent tool-calling posture.",
      "Task: you need one local file read and one log grep to confirm the same claim. Neither result changes whether the other is needed, and both are read-only.",
      "Options: parallel_now, stay_serial, gather_more_context_first.",
      "Reply with exactly one bare option token and nothing else. No punctuation.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best same-agent tool-calling posture.",
      "Task: you need one local file read and one log grep to confirm the same claim. Neither result changes whether the other is needed, and both are read-only.",
      "Semantic memory: mixed tool families can still run in parallel when they are both read-only and neither one gates the other.",
      "Options: parallel_now, stay_serial, gather_more_context_first.",
      "Reply with exactly one bare option token and nothing else. No punctuation.",
    ].join("\n"),
  },
  {
    id: "same_file_edit_sequence",
    category: "serial_edits",
    expected: "stay_serial",
    baselinePrompt: [
      "Choose the best same-agent tool-calling posture.",
      "Task: you need one file edit first, then a second edit and a test update that depend on the exact shape of the first patch.",
      "Options: stay_serial, parallel_now, parallel_after_context.",
      "Reply with exactly one bare option token and nothing else. No punctuation.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best same-agent tool-calling posture.",
      "Task: you need one file edit first, then a second edit and a test update that depend on the exact shape of the first patch.",
      "Semantic memory: same-agent edits should stay serial when later edits depend on the earlier patch shape; parallel reads are fine, parallel edits are not the default optimization.",
      "Options: stay_serial, parallel_now, parallel_after_context.",
      "Reply with exactly one bare option token and nothing else. No punctuation.",
    ].join("\n"),
  },
  {
    id: "scope_unclear_before_parallelism",
    category: "scope_gate",
    expected: "gather_more_context_first",
    baselinePrompt: [
      "Choose the best same-agent tool-calling posture.",
      "Task: you do not yet know whether the fix stays in one module or crosses into a second subsystem. Parallel fanout now may chase the wrong boundary.",
      "Options: gather_more_context_first, parallel_now, stay_serial.",
      "Reply with exactly one bare option token and nothing else. No punctuation.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best same-agent tool-calling posture.",
      "Task: you do not yet know whether the fix stays in one module or crosses into a second subsystem. Parallel fanout now may chase the wrong boundary.",
      "Semantic memory: unresolved scope beats parallelism; re-ground the task boundary first instead of fanning out tools on a maybe-wider fix.",
      "Options: gather_more_context_first, parallel_now, stay_serial.",
      "Reply with exactly one bare option token and nothing else. No punctuation.",
    ].join("\n"),
  },
]

export function renderRetrievalParallelToolCallingPromptFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/timed out/i.test(message)) return "error_timeout"
  return "error"
}

function textFromParts(parts: Array<{ type?: string; text?: string }>) {
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim()
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
      output: renderRetrievalParallelToolCallingPromptFailure(error),
      elapsedMS: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runScenarioWithProgress(
  benchmarkModel: SemanticBenchmarkModel,
  scenario: ScenarioDefinition,
  onProgress?: (event: RetrievalParallelToolCallingProgressEvent) => void,
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
    } satisfies RetrievalParallelToolCallingScenarioResult

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

export function classifyRetrievalParallelToolCallingLift(
  result: Pick<RetrievalParallelToolCallingBenchmarkResult, "decisionLift" | "looseDecisionLift">,
) {
  if (result.looseDecisionLift > 0 && result.decisionLift > 0) {
    return "strong_parallel_judgment_strong_control" satisfies RetrievalParallelToolCallingLiftProfile
  }
  if (result.looseDecisionLift > 0 && result.decisionLift <= 0) {
    return "strong_parallel_judgment_weak_control" satisfies RetrievalParallelToolCallingLiftProfile
  }
  if (result.looseDecisionLift <= 0 && result.decisionLift > 0) {
    return "control_without_parallel_gain" satisfies RetrievalParallelToolCallingLiftProfile
  }
  return "weak_parallel_gain" satisfies RetrievalParallelToolCallingLiftProfile
}

export function retrievalParallelToolCallingPolicyHint(profile: RetrievalParallelToolCallingLiftProfile) {
  switch (profile) {
    case "strong_parallel_judgment_strong_control":
      return "good default for retrieval-influenced parallel tool-calling judgment"
    case "strong_parallel_judgment_weak_control":
      return "useful for parallelism judgment, but pair with stricter enum/output control"
    case "control_without_parallel_gain":
      return "format-safe, but retrieval is not moving parallel tool choices much yet"
    case "weak_parallel_gain":
      return "do not prioritize for retrieval-driven parallel tool-calling routes yet"
  }
}

export async function runRetrievalParallelToolCallingBenchmark(input: {
  benchmarkModel?: SemanticBenchmarkModel
  prepareWorkspace: WorkspacePreparer
  onProgress?: (event: RetrievalParallelToolCallingProgressEvent) => void
}): Promise<RetrievalParallelToolCallingBenchmarkResult> {
  const benchmarkModel = input.benchmarkModel ?? defaultBenchmarkModel
  const results: RetrievalParallelToolCallingScenarioResult[] = []

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
    suite: "retrieval_parallel_tool_calling_lift",
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
