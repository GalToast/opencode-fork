// @ts-nocheck
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import type { SemanticBenchmarkModel } from "./semantic-benchmark"
import { canonical, isLooseCorrect, normalize } from "./answer"

type WorkspacePreparer = (scenarioID: string) => Promise<string> | string
const PROMPT_TIMEOUT_MS = Number(process.env.HARNESS_BENCH_PROMPT_TIMEOUT_MS ?? "120000")

export type SemanticQualityScenarioResult = {
  id: string
  category: "routing" | "planning" | "recovery" | "coding"
  difficulty: "medium" | "hard"
  expected: string
  baselineOutput: string
  semanticOutput: string
  baselineCanonical: string
  semanticCanonical: string
  baselineCorrect: boolean
  semanticCorrect: boolean
  baselineLooseCorrect: boolean
  semanticLooseCorrect: boolean
  baselineElapsedMS: number
  semanticElapsedMS: number
}

export type SemanticQualityBenchmarkResult = {
  suite: "semantic_quality_lift"
  benchmarkModel: SemanticBenchmarkModel
  scenarioCount: number
  baselineCorrectCount: number
  semanticCorrectCount: number
  baselineLooseCorrectCount: number
  semanticLooseCorrectCount: number
  qualityLift: number
  looseQualityLift: number
  baselineAccuracy: number
  semanticAccuracy: number
  baselineLooseAccuracy: number
  semanticLooseAccuracy: number
  averageLatencyDeltaMS: number
  categorySummary: Array<{
    category: SemanticQualityScenarioResult["category"]
    scenarioCount: number
    baselineCorrectCount: number
    semanticCorrectCount: number
    baselineLooseCorrectCount: number
    semanticLooseCorrectCount: number
    qualityLift: number
    looseQualityLift: number
  }>
  difficultySummary: Array<{
    difficulty: SemanticQualityScenarioResult["difficulty"]
    scenarioCount: number
    baselineCorrectCount: number
    semanticCorrectCount: number
    baselineLooseCorrectCount: number
    semanticLooseCorrectCount: number
    qualityLift: number
    looseQualityLift: number
  }>
  results: SemanticQualityScenarioResult[]
}

export type SemanticQualityLiftProfile =
  | "strong_reasoner_strong_controller"
  | "strong_reasoner_weak_controller"
  | "controller_without_reasoning_gain"
  | "weak_semantic_gain"

export type SemanticQualityLiftProfileSummary = {
  profile: SemanticQualityLiftProfile
  count: number
  modelIDs: string[]
}

type ScenarioDefinition = {
  id: string
  category: SemanticQualityScenarioResult["category"]
  difficulty: SemanticQualityScenarioResult["difficulty"]
  expected: string
  baselinePrompt: string
  semanticPrompt: string
}

const scenarios: ScenarioDefinition[] = [
  {
    id: "routing_worker_choice",
    category: "routing",
    difficulty: "medium",
    expected: "worker",
    baselinePrompt: [
      "Choose the best next move for a code task.",
      "Task: continue a cedar migration continuity change in an existing repo after a previous attempt uncovered a few unknowns.",
      "Options: explorer, worker, planner.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best next move for a code task.",
      "Task: continue a cedar migration continuity change in an existing repo after a previous attempt uncovered a few unknowns.",
      "Semantic memory: repeated successful analogs show the unknowns were superficial and this work succeeded when routed to a bounded worker patch, not research-first exploration.",
      "Options: explorer, worker, planner.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "planning_balanced_choice",
    category: "planning",
    difficulty: "medium",
    expected: "balanced",
    baselinePrompt: [
      "Choose the execution topology for a code change.",
      "Mission: ship the first Octospine slice quickly while keeping orchestration and recovery stable, but leadership is pushing for visible momentum.",
      "Options: aggressive, balanced, conservative.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the execution topology for a code change.",
      "Mission: ship the first Octospine slice quickly while keeping orchestration and recovery stable, but leadership is pushing for visible momentum.",
      "Semantic memory: prior execution-brief outcomes for similar work favored balanced, because aggressive looked attractive to stakeholders but caused coordination churn while conservative slowed delivery too much.",
      "Options: aggressive, balanced, conservative.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "recovery_rescan_choice",
    category: "recovery",
    difficulty: "medium",
    expected: "rescan_state",
    baselinePrompt: [
      "A task stalled after rollback symptoms resurfaced, but the team is under pressure to restore momentum quickly.",
      "Choose the best next step.",
      "Options: continue, rescan_state, escalate.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "A task stalled after rollback symptoms resurfaced, but the team is under pressure to restore momentum quickly.",
      "Semantic memory: the committed execution brief declared this an invalidation signal and the contingency action was to re-scan state before retrying.",
      "Choose the best next step.",
      "Options: continue, rescan_state, escalate.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "coding_bounded_patch_choice",
    category: "coding",
    difficulty: "hard",
    expected: "bounded_patch",
    baselinePrompt: [
      "Choose the best implementation posture for a small repo task.",
      "Task: update one scheduler check so detached stale work resumes cleanly without changing surrounding architecture, but a few nearby seams also look messy.",
      "Options: bounded_patch, broad_refactor, add_new_layer.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "Choose the best implementation posture for a small repo task.",
      "Task: update one scheduler check so detached stale work resumes cleanly without changing surrounding architecture, but a few nearby seams also look messy.",
      "Semantic memory: similar successful fixes were narrow single-seam edits; broad refactors created churn and new regressions without improving the target bug.",
      "Options: bounded_patch, broad_refactor, add_new_layer.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "recovery_contingency_specificity",
    category: "recovery",
    difficulty: "hard",
    expected: "revert_then_verify",
    baselinePrompt: [
      "A task failed after a rollback symptom reappeared during recovery, and the operator wants the fastest path back to progress.",
      "Choose the safest next step.",
      "Options: continue_retry, revert_then_verify, split_parallel.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
    semanticPrompt: [
      "A task failed after a rollback symptom reappeared during recovery, and the operator wants the fastest path back to progress.",
      "Semantic memory: the execution brief listed rollback resurfacing as an invalidation signal and the contingency action was to revert to the last clean state and verify before retrying.",
      "Choose the safest next step.",
      "Options: continue_retry, revert_then_verify, split_parallel.",
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

async function runScenario(benchmarkModel: SemanticBenchmarkModel, scenario: ScenarioDefinition) {
  const baselineSession = await Session.create({ title: `${scenario.id}-baseline` })
  const semanticSession = await Session.create({ title: `${scenario.id}-semantic` })

  try {
    const baseline = await runPrompt(baselineSession.id, benchmarkModel, scenario.baselinePrompt)
    const semantic = await runPrompt(semanticSession.id, benchmarkModel, scenario.semanticPrompt)

    return {
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
      baselineElapsedMS: baseline.elapsedMS,
      semanticElapsedMS: semantic.elapsedMS,
    } satisfies SemanticQualityScenarioResult
  } finally {
    await Session.remove(baselineSession.id).catch(() => {})
    await Session.remove(semanticSession.id).catch(() => {})
  }
}

export function classifySemanticQualityLift(result: Pick<SemanticQualityBenchmarkResult, "qualityLift" | "looseQualityLift">) {
  if (result.looseQualityLift > 0 && result.qualityLift > 0) {
    return "strong_reasoner_strong_controller" satisfies SemanticQualityLiftProfile
  }
  if (result.looseQualityLift > 0 && result.qualityLift <= 0) {
    return "strong_reasoner_weak_controller" satisfies SemanticQualityLiftProfile
  }
  if (result.looseQualityLift <= 0 && result.qualityLift > 0) {
    return "controller_without_reasoning_gain" satisfies SemanticQualityLiftProfile
  }
  return "weak_semantic_gain" satisfies SemanticQualityLiftProfile
}

export function semanticQualityPolicyHint(profile: SemanticQualityLiftProfile) {
  switch (profile) {
    case "strong_reasoner_strong_controller":
      return "good default for semantic exact-output harness routes"
    case "strong_reasoner_weak_controller":
      return "useful for semantic reasoning with output sanitization or post-checking"
    case "controller_without_reasoning_gain":
      return "exact-output safe, but semantic memory is not buying much yet"
    case "weak_semantic_gain":
      return "do not prioritize for semantic-heavy routes without more evidence"
  }
}

export function summarizeSemanticQualityLiftProfiles(
  results: Pick<SemanticQualityBenchmarkResult, "benchmarkModel" | "qualityLift" | "looseQualityLift">[],
) {
  const grouped = new Map<SemanticQualityLiftProfile, string[]>()
  for (const result of results) {
    const profile = classifySemanticQualityLift(result)
    const bucket = grouped.get(profile) ?? []
    bucket.push(result.benchmarkModel.modelID)
    grouped.set(profile, bucket)
  }

  return Array.from(grouped.entries())
    .map(([profile, modelIDs]) => ({
      profile,
      count: modelIDs.length,
      modelIDs: modelIDs.slice().sort(),
    }))
    .sort((a, b) => a.profile.localeCompare(b.profile)) satisfies SemanticQualityLiftProfileSummary[]
}

export async function runSemanticQualityBenchmark(input: {
  benchmarkModel: SemanticBenchmarkModel
  prepareWorkspace: WorkspacePreparer
}): Promise<SemanticQualityBenchmarkResult> {
  const results: SemanticQualityScenarioResult[] = []
  for (const scenario of scenarios) {
    await input.prepareWorkspace(scenario.id)
    results.push(await runScenario(input.benchmarkModel, scenario))
  }

  const baselineCorrectCount = results.filter((result) => result.baselineCorrect).length
  const semanticCorrectCount = results.filter((result) => result.semanticCorrect).length
  const baselineLooseCorrectCount = results.filter((result) => result.baselineLooseCorrect).length
  const semanticLooseCorrectCount = results.filter((result) => result.semanticLooseCorrect).length
  const averageLatencyDeltaMS = results.length
    ? Math.round(results.reduce((sum, result) => sum + (result.semanticElapsedMS - result.baselineElapsedMS), 0) / results.length)
    : 0
  const categories = [...new Set(results.map((result) => result.category))]
  const difficulties = [...new Set(results.map((result) => result.difficulty))]

  return {
    suite: "semantic_quality_lift",
    benchmarkModel: input.benchmarkModel,
    scenarioCount: results.length,
    baselineCorrectCount,
    semanticCorrectCount,
    baselineLooseCorrectCount,
    semanticLooseCorrectCount,
    qualityLift: semanticCorrectCount - baselineCorrectCount,
    looseQualityLift: semanticLooseCorrectCount - baselineLooseCorrectCount,
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
        qualityLift: categorySemanticCorrectCount - categoryBaselineCorrectCount,
        looseQualityLift: categorySemanticLooseCorrectCount - categoryBaselineLooseCorrectCount,
      }
    }),
    difficultySummary: difficulties.map((difficulty) => {
      const difficultyResults = results.filter((result) => result.difficulty === difficulty)
      const difficultyBaselineCorrectCount = difficultyResults.filter((result) => result.baselineCorrect).length
      const difficultySemanticCorrectCount = difficultyResults.filter((result) => result.semanticCorrect).length
      const difficultyBaselineLooseCorrectCount = difficultyResults.filter((result) => result.baselineLooseCorrect).length
      const difficultySemanticLooseCorrectCount = difficultyResults.filter((result) => result.semanticLooseCorrect).length
      return {
        difficulty,
        scenarioCount: difficultyResults.length,
        baselineCorrectCount: difficultyBaselineCorrectCount,
        semanticCorrectCount: difficultySemanticCorrectCount,
        baselineLooseCorrectCount: difficultyBaselineLooseCorrectCount,
        semanticLooseCorrectCount: difficultySemanticLooseCorrectCount,
        qualityLift: difficultySemanticCorrectCount - difficultyBaselineCorrectCount,
        looseQualityLift: difficultySemanticLooseCorrectCount - difficultyBaselineLooseCorrectCount,
      }
    }),
    results,
  }
}
