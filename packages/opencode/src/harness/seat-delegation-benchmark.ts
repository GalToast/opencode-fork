// @ts-nocheck
import { Instance } from "@/project/instance"
import { SessionPrompt } from "@/session/prompt"
import { canonical, isContractViolation, isDecisionMiss, isLooseCorrect, normalize } from "./answer"

type WorkspacePreparer = (scenarioID: string) => Promise<string> | string
type SemanticBenchmarkModel = {
  providerID: string
  modelID: string
}
const PROMPT_TIMEOUT_MS = Number(process.env.HARNESS_BENCH_PROMPT_TIMEOUT_MS ?? "120000")
type SeatDelegationProgressEvent =
  | {
      type: "scenario_start"
      benchmarkModel: SemanticBenchmarkModel
      scenarioID: string
      category: SeatDelegationScenarioResult["category"]
      difficulty: SeatDelegationScenarioResult["difficulty"]
    }
  | {
      type: "baseline_complete" | "semantic_complete"
      benchmarkModel: SemanticBenchmarkModel
      scenarioID: string
      output: string
      canonical: string
      elapsedMS: number
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

export type SeatDelegationDecision =
  | "stay_solo"
  | "split_parallel"
  | "delegate_bounded_worker"
  | "gather_more_context_first"

export type SeatDelegationScenarioResult = {
  id: string
  category: "solo" | "parallel" | "delegate" | "context"
  difficulty: "medium" | "hard"
  expected: SeatDelegationDecision
  baselineOutput: string
  semanticOutput: string
  baselineCanonical: string
  semanticCanonical: string
  baselineCorrect: boolean
  semanticCorrect: boolean
  baselineLooseCorrect: boolean
  semanticLooseCorrect: boolean
  baselineContractViolation: boolean
  semanticContractViolation: boolean
  baselineDecisionMiss: boolean
  semanticDecisionMiss: boolean
  baselineElapsedMS: number
  semanticElapsedMS: number
}

export type SeatDelegationBenchmarkResult = {
  suite: "seat_delegation_judgment"
  benchmarkModel: SemanticBenchmarkModel
  scenarioCount: number
  baselineCorrectCount: number
  semanticCorrectCount: number
  baselineLooseCorrectCount: number
  semanticLooseCorrectCount: number
  baselineContractViolationCount: number
  semanticContractViolationCount: number
  baselineDecisionMissCount: number
  semanticDecisionMissCount: number
  qualityLift: number
  looseQualityLift: number
  contractViolationLift: number
  decisionLift: number
  baselineAccuracy: number
  semanticAccuracy: number
  baselineLooseAccuracy: number
  semanticLooseAccuracy: number
  averageLatencyDeltaMS: number
  categorySummary: Array<{
    category: SeatDelegationScenarioResult["category"]
    scenarioCount: number
    baselineCorrectCount: number
    semanticCorrectCount: number
    baselineLooseCorrectCount: number
    semanticLooseCorrectCount: number
    baselineContractViolationCount: number
    semanticContractViolationCount: number
    baselineDecisionMissCount: number
    semanticDecisionMissCount: number
    qualityLift: number
    looseQualityLift: number
    contractViolationLift: number
    decisionLift: number
  }>
  difficultySummary: Array<{
    difficulty: SeatDelegationScenarioResult["difficulty"]
    scenarioCount: number
    baselineCorrectCount: number
    semanticCorrectCount: number
    baselineLooseCorrectCount: number
    semanticLooseCorrectCount: number
    baselineContractViolationCount: number
    semanticContractViolationCount: number
    baselineDecisionMissCount: number
    semanticDecisionMissCount: number
    qualityLift: number
    looseQualityLift: number
    contractViolationLift: number
    decisionLift: number
  }>
  results: SeatDelegationScenarioResult[]
}

type ScenarioDefinition = {
  id: string
  category: SeatDelegationScenarioResult["category"]
  difficulty: SeatDelegationScenarioResult["difficulty"]
  expected: SeatDelegationDecision
  baselinePrompt: string
  semanticPrompt: string
}

const scenarios: ScenarioDefinition[] = [
  {
    id: "single_seam_hotfix",
    category: "solo",
    difficulty: "medium",
    expected: "stay_solo",
    baselinePrompt: [
      "Scenario: single_seam_hotfix",
      "You are the seated agent deciding whether to split work.",
      "Task: patch one scheduler stale-check in a tightly coupled file and verify the same seam immediately after.",
      "The next step depends directly on the result of the edit.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: single_seam_hotfix",
      "You are the seated agent deciding whether to split work.",
      "Task: patch one scheduler stale-check in a tightly coupled file and verify the same seam immediately after.",
      "The next step depends directly on the result of the edit.",
      "Semantic memory: similar single-seam hotfixes regressed when the seat agent fragmented them; they shipped cleanly when the seat agent stayed local and verified directly.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "independent_ui_and_docs",
    category: "parallel",
    difficulty: "medium",
    expected: "split_parallel",
    baselinePrompt: [
      "Scenario: independent_ui_and_docs",
      "You are the seated agent deciding whether to split work.",
      "Task: update a landing-page hero and refresh a separate docs page. The write sets are disjoint and neither blocks the other.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: independent_ui_and_docs",
      "You are the seated agent deciding whether to split work.",
      "Task: update a landing-page hero and refresh a separate docs page. The write sets are disjoint and neither blocks the other.",
      "Semantic memory: successful analogs used two parallel bounded lanes because the slices were independent and did not gate the seat agent's next move.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "bounded_sidecar_probe",
    category: "delegate",
    difficulty: "hard",
    expected: "delegate_bounded_worker",
    baselinePrompt: [
      "Scenario: bounded_sidecar_probe",
      "You are the seated agent deciding whether to split work.",
      "Task: keep implementing the main recovery fix while a helper checks three candidate regression tests in a separate folder.",
      "That verification is useful but does not block the next local implementation step.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: bounded_sidecar_probe",
      "You are the seated agent deciding whether to split work.",
      "Task: keep implementing the main recovery fix while a helper checks three candidate regression tests in a separate folder.",
      "That verification is useful but does not block the next local implementation step.",
      "Semantic memory: the best pattern here was to keep the recovery fix local and send one bounded verification helper instead of fragmenting the whole job.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "shared_file_false_parallel",
    category: "solo",
    difficulty: "hard",
    expected: "stay_solo",
    baselinePrompt: [
      "Scenario: shared_file_false_parallel",
      "You are the seated agent deciding whether to split work.",
      "Task: one change updates API validation and another updates response formatting, but both edits land in the same handler and the second depends on the first shape being correct.",
      "It sounds like two slices, but both touch the same file and the validation change determines what the formatter can safely do next.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: shared_file_false_parallel",
      "You are the seated agent deciding whether to split work.",
      "Task: one change updates API validation and another updates response formatting, but both edits land in the same handler and the second depends on the first shape being correct.",
      "It sounds like two slices, but both touch the same file and the validation change determines what the formatter can safely do next.",
      "Semantic memory: prior attempts over-split same-file dependent edits and created merge churn; the seat agent needed to keep the seam local until the dependency was resolved.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "architecture_uncertainty",
    category: "context",
    difficulty: "hard",
    expected: "gather_more_context_first",
    baselinePrompt: [
      "Scenario: architecture_uncertainty",
      "You are the seated agent deciding whether to split work.",
      "Task: investigate a cross-cutting regression that may span session state, provider transforms, and tracker replay, but ownership and root cause are still unclear.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: architecture_uncertainty",
      "You are the seated agent deciding whether to split work.",
      "Task: investigate a cross-cutting regression that may span session state, provider transforms, and tracker replay, but ownership and root cause are still unclear.",
      "Semantic memory: over-splitting this shape caused redundant work and merge confusion; the seat agent needed one context-building pass before deciding whether to fragment anything.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "delegate_before_context_trap",
    category: "context",
    difficulty: "hard",
    expected: "gather_more_context_first",
    baselinePrompt: [
      "Scenario: delegate_before_context_trap",
      "You are the seated agent deciding whether to split work.",
      "Task: a flaky build might be caused by CI config, generated types, or provider env setup, and there is pressure to send one worker to each theory immediately.",
      "No one yet knows which theory is most plausible or which logs are canonical.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: delegate_before_context_trap",
      "You are the seated agent deciding whether to split work.",
      "Task: a flaky build might be caused by CI config, generated types, or provider env setup, and there is pressure to send one worker to each theory immediately.",
      "No one yet knows which theory is most plausible or which logs are canonical.",
      "Semantic memory: similar incidents wasted time when the seat agent fanned out before establishing the real evidence source; one context-building pass came first.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "critical_path_dependency",
    category: "solo",
    difficulty: "hard",
    expected: "stay_solo",
    baselinePrompt: [
      "Scenario: critical_path_dependency",
      "You are the seated agent deciding whether to split work.",
      "Task: the next command depends on understanding the exact output of a single failing benchmark run; no side task matters until that seam is understood.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: critical_path_dependency",
      "You are the seated agent deciding whether to split work.",
      "Task: the next command depends on understanding the exact output of a single failing benchmark run; no side task matters until that seam is understood.",
      "Semantic memory: prior attempts wasted time by delegating the critical-path blocker; the seat agent needed to keep the blocking seam local until it was resolved.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "one_sidecar_better_than_two_workers",
    category: "delegate",
    difficulty: "hard",
    expected: "delegate_bounded_worker",
    baselinePrompt: [
      "Scenario: one_sidecar_better_than_two_workers",
      "You are the seated agent deciding whether to split work.",
      "Task: the seat agent is rewriting one central state transition while it would help to confirm one old telemetry assertion and one fixture path in a separate test directory.",
      "There are two tiny verification chores available, but neither blocks the local rewrite and both fit in one bounded verification pass.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: one_sidecar_better_than_two_workers",
      "You are the seated agent deciding whether to split work.",
      "Task: the seat agent is rewriting one central state transition while it would help to confirm one old telemetry assertion and one fixture path in a separate test directory.",
      "There are two tiny verification chores available, but neither blocks the local rewrite and both fit in one bounded verification pass.",
      "Semantic memory: strong analogs kept the core rewrite local and used one bounded verification lane instead of fragmenting into multiple workers.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "recursive_subsystem_owner",
    category: "delegate",
    difficulty: "hard",
    expected: "delegate_bounded_worker",
    baselinePrompt: [
      "Scenario: recursive_subsystem_owner",
      "You are the seated agent deciding whether to split work.",
      "Task: the root seat has already isolated the problem to the retrieval router package.",
      "One bounded owner could take that package end to end, and inside that scope they may need to ask a child lane to inspect fixture drift.",
      "The root seat still keeps final user-facing authority and does not need to decompose the package at the top level first.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: recursive_subsystem_owner",
      "You are the seated agent deciding whether to split work.",
      "Task: the root seat has already isolated the problem to the retrieval router package.",
      "One bounded owner could take that package end to end, and inside that scope they may need to ask a child lane to inspect fixture drift.",
      "The root seat still keeps final user-facing authority and does not need to decompose the package at the top level first.",
      "Semantic memory: when a bounded subsystem already has a clean owner, the seat agent should delegate one local seat for that scope and let recursion happen inside the boundary if needed.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "locked_root_cause_clean_parallel",
    category: "parallel",
    difficulty: "hard",
    expected: "split_parallel",
    baselinePrompt: [
      "Scenario: locked_root_cause_clean_parallel",
      "You are the seated agent deciding whether to split work.",
      "Task: the seat agent has already finished the context pass and locked the root cause.",
      "Two follow-ups remain: patch a Windows path helper under src/tool and refresh a migration note under docs/.",
      "The write sets are disjoint, the approval boundary is already settled, and neither follow-up blocks the other.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: locked_root_cause_clean_parallel",
      "You are the seated agent deciding whether to split work.",
      "Task: the seat agent has already finished the context pass and locked the root cause.",
      "Two follow-ups remain: patch a Windows path helper under src/tool and refresh a migration note under docs/.",
      "The write sets are disjoint, the approval boundary is already settled, and neither follow-up blocks the other.",
      "Semantic memory: once the blocking seam and approval boundary were already resolved, the best analogs used parallel lanes for the remaining disjoint follow-ups.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "scope_escalation_discovery",
    category: "context",
    difficulty: "hard",
    expected: "gather_more_context_first",
    baselinePrompt: [
      "Scenario: scope_escalation_discovery",
      "You are the seated agent deciding whether to split work.",
      "Task: a supposedly test-only cleanup now appears to require auth-session runtime edits and a new approval-sensitive config change.",
      "The likely fix widened the write set materially beyond the original boundary before the root seat confirmed the new scope.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: scope_escalation_discovery",
      "You are the seated agent deciding whether to split work.",
      "Task: a supposedly test-only cleanup now appears to require auth-session runtime edits and a new approval-sensitive config change.",
      "The likely fix widened the write set materially beyond the original boundary before the root seat confirmed the new scope.",
      "Semantic memory: when the branch discovered a material scope expansion, the winning pattern was to escalate and re-ground the boundary first instead of immediately fragmenting execution.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "shared_approval_gate",
    category: "context",
    difficulty: "hard",
    expected: "gather_more_context_first",
    baselinePrompt: [
      "Scenario: shared_approval_gate",
      "You are the seated agent deciding whether to split work.",
      "Task: two edits look independent, but both depend on one unresolved policy choice about keeping backward compatibility for a legacy JSON shape.",
      "Until that policy is pinned down, neither branch knows the real success criteria.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Scenario: shared_approval_gate",
      "You are the seated agent deciding whether to split work.",
      "Task: two edits look independent, but both depend on one unresolved policy choice about keeping backward compatibility for a legacy JSON shape.",
      "Until that policy is pinned down, neither branch knows the real success criteria.",
      "Semantic memory: attempts to parallelize before the shared approval gate was resolved created thrash, because both lanes had to be redone after the root decision changed.",
      "Options: stay_solo, split_parallel, delegate_bounded_worker, gather_more_context_first.",
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

async function runScenario(
  benchmarkModel: SemanticBenchmarkModel,
  scenario: ScenarioDefinition,
  onProgress?: (event: SeatDelegationProgressEvent) => void,
) {
  const baselineSessionID = `seat-benchmark-${scenario.id}-baseline`
  const semanticSessionID = `seat-benchmark-${scenario.id}-semantic`

  onProgress?.({
    type: "scenario_start",
    benchmarkModel,
    scenarioID: scenario.id,
    category: scenario.category,
    difficulty: scenario.difficulty,
  })
  const baseline = await runPrompt(baselineSessionID, benchmarkModel, scenario.baselinePrompt)
  onProgress?.({
    type: "baseline_complete",
    benchmarkModel,
    scenarioID: scenario.id,
    output: baseline.output,
    canonical: canonical(baseline.output, scenario.baselinePrompt),
    elapsedMS: baseline.elapsedMS,
  })
  const semantic = await runPrompt(semanticSessionID, benchmarkModel, scenario.semanticPrompt)
  onProgress?.({
    type: "semantic_complete",
    benchmarkModel,
    scenarioID: scenario.id,
    output: semantic.output,
    canonical: canonical(semantic.output, scenario.semanticPrompt),
    elapsedMS: semantic.elapsedMS,
  })

  const result = {
    id: scenario.id,
    category: scenario.category,
    difficulty: scenario.difficulty,
    expected: scenario.expected,
    baselineOutput: baseline.output,
    semanticOutput: semantic.output,
    baselineCanonical: canonical(baseline.output, scenario.baselinePrompt),
    semanticCanonical: canonical(semantic.output, scenario.semanticPrompt),
    baselineCorrect: normalize(baseline.output) === scenario.expected,
    semanticCorrect: normalize(semantic.output) === scenario.expected,
    baselineLooseCorrect: isLooseCorrect(baseline.output, scenario.expected, scenario.baselinePrompt),
    semanticLooseCorrect: isLooseCorrect(semantic.output, scenario.expected, scenario.semanticPrompt),
    baselineContractViolation: isContractViolation(baseline.output, scenario.expected, scenario.baselinePrompt),
    semanticContractViolation: isContractViolation(semantic.output, scenario.expected, scenario.semanticPrompt),
    baselineDecisionMiss: isDecisionMiss(baseline.output, scenario.expected, scenario.baselinePrompt),
    semanticDecisionMiss: isDecisionMiss(semantic.output, scenario.expected, scenario.semanticPrompt),
    baselineElapsedMS: baseline.elapsedMS,
    semanticElapsedMS: semantic.elapsedMS,
  } satisfies SeatDelegationScenarioResult
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
}

export async function runSeatDelegationBenchmark(input: {
  benchmarkModel: SemanticBenchmarkModel
  prepareWorkspace: WorkspacePreparer
  onProgress?: (event: SeatDelegationProgressEvent) => void
}): Promise<SeatDelegationBenchmarkResult> {
  const results: SeatDelegationScenarioResult[] = []
  for (const scenario of scenarios) {
    const directory = await input.prepareWorkspace(scenario.id)
    results.push(
      await Instance.provide({
        directory,
        fn: async () => runScenario(input.benchmarkModel, scenario, input.onProgress),
      }),
    )
  }

  const baselineCorrectCount = results.filter((result) => result.baselineCorrect).length
  const semanticCorrectCount = results.filter((result) => result.semanticCorrect).length
  const baselineLooseCorrectCount = results.filter((result) => result.baselineLooseCorrect).length
  const semanticLooseCorrectCount = results.filter((result) => result.semanticLooseCorrect).length
  const baselineContractViolationCount = results.filter((result) => result.baselineContractViolation).length
  const semanticContractViolationCount = results.filter((result) => result.semanticContractViolation).length
  const baselineDecisionMissCount = results.filter((result) => result.baselineDecisionMiss).length
  const semanticDecisionMissCount = results.filter((result) => result.semanticDecisionMiss).length
  const averageLatencyDeltaMS = results.length
    ? Math.round(results.reduce((sum, result) => sum + (result.semanticElapsedMS - result.baselineElapsedMS), 0) / results.length)
    : 0
  const categories = [...new Set(results.map((result) => result.category))]
  const difficulties = [...new Set(results.map((result) => result.difficulty))]

  return {
    suite: "seat_delegation_judgment",
    benchmarkModel: input.benchmarkModel,
    scenarioCount: results.length,
    baselineCorrectCount,
    semanticCorrectCount,
    baselineLooseCorrectCount,
    semanticLooseCorrectCount,
    baselineContractViolationCount,
    semanticContractViolationCount,
    baselineDecisionMissCount,
    semanticDecisionMissCount,
    qualityLift: semanticCorrectCount - baselineCorrectCount,
    looseQualityLift: semanticLooseCorrectCount - baselineLooseCorrectCount,
    contractViolationLift: baselineContractViolationCount - semanticContractViolationCount,
    decisionLift: baselineDecisionMissCount - semanticDecisionMissCount,
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
      const categoryBaselineContractViolationCount = categoryResults.filter((result) => result.baselineContractViolation).length
      const categorySemanticContractViolationCount = categoryResults.filter((result) => result.semanticContractViolation).length
      const categoryBaselineDecisionMissCount = categoryResults.filter((result) => result.baselineDecisionMiss).length
      const categorySemanticDecisionMissCount = categoryResults.filter((result) => result.semanticDecisionMiss).length
      return {
        category,
        scenarioCount: categoryResults.length,
        baselineCorrectCount: categoryBaselineCorrectCount,
        semanticCorrectCount: categorySemanticCorrectCount,
        baselineLooseCorrectCount: categoryBaselineLooseCorrectCount,
        semanticLooseCorrectCount: categorySemanticLooseCorrectCount,
        baselineContractViolationCount: categoryBaselineContractViolationCount,
        semanticContractViolationCount: categorySemanticContractViolationCount,
        baselineDecisionMissCount: categoryBaselineDecisionMissCount,
        semanticDecisionMissCount: categorySemanticDecisionMissCount,
        qualityLift: categorySemanticCorrectCount - categoryBaselineCorrectCount,
        looseQualityLift: categorySemanticLooseCorrectCount - categoryBaselineLooseCorrectCount,
        contractViolationLift: categoryBaselineContractViolationCount - categorySemanticContractViolationCount,
        decisionLift: categoryBaselineDecisionMissCount - categorySemanticDecisionMissCount,
      }
    }),
    difficultySummary: difficulties.map((difficulty) => {
      const difficultyResults = results.filter((result) => result.difficulty === difficulty)
      const difficultyBaselineCorrectCount = difficultyResults.filter((result) => result.baselineCorrect).length
      const difficultySemanticCorrectCount = difficultyResults.filter((result) => result.semanticCorrect).length
      const difficultyBaselineLooseCorrectCount = difficultyResults.filter((result) => result.baselineLooseCorrect).length
      const difficultySemanticLooseCorrectCount = difficultyResults.filter((result) => result.semanticLooseCorrect).length
      const difficultyBaselineContractViolationCount = difficultyResults.filter((result) => result.baselineContractViolation).length
      const difficultySemanticContractViolationCount = difficultyResults.filter((result) => result.semanticContractViolation).length
      const difficultyBaselineDecisionMissCount = difficultyResults.filter((result) => result.baselineDecisionMiss).length
      const difficultySemanticDecisionMissCount = difficultyResults.filter((result) => result.semanticDecisionMiss).length
      return {
        difficulty,
        scenarioCount: difficultyResults.length,
        baselineCorrectCount: difficultyBaselineCorrectCount,
        semanticCorrectCount: difficultySemanticCorrectCount,
        baselineLooseCorrectCount: difficultyBaselineLooseCorrectCount,
        semanticLooseCorrectCount: difficultySemanticLooseCorrectCount,
        baselineContractViolationCount: difficultyBaselineContractViolationCount,
        semanticContractViolationCount: difficultySemanticContractViolationCount,
        baselineDecisionMissCount: difficultyBaselineDecisionMissCount,
        semanticDecisionMissCount: difficultySemanticDecisionMissCount,
        qualityLift: difficultySemanticCorrectCount - difficultyBaselineCorrectCount,
        looseQualityLift: difficultySemanticLooseCorrectCount - difficultyBaselineLooseCorrectCount,
        contractViolationLift: difficultyBaselineContractViolationCount - difficultySemanticContractViolationCount,
        decisionLift: difficultyBaselineDecisionMissCount - difficultySemanticDecisionMissCount,
      }
    }),
    results,
  }
}
