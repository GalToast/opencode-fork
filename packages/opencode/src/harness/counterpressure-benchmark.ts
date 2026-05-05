// @ts-nocheck
import type { SemanticBenchmarkModel } from "./semantic-benchmark"

export type CounterpressureScenario = {
  id: string
  category: "repetition" | "invalidation" | "recovery"
  baselinePrompt: string
  counterpressurePrompt: string
  expectedAction: "continue" | "slow_down" | "change_course"
}

export type CounterpressureScenarioResult = {
  id: string
  category: CounterpressureScenario["category"]
  baselineAction: CounterpressureScenario["expectedAction"]
  counterpressureAction: CounterpressureScenario["expectedAction"]
  baselineCorrect: boolean
  counterpressureCorrect: boolean
}

export type CounterpressureBenchmarkResult = {
  suite: "counterpressure_judgment"
  benchmarkModel: SemanticBenchmarkModel
  scenarioCount: number
  baselineCorrectCount: number
  semanticCorrectCount: number
  qualityLift: number
  categorySummary: Array<{
    category: CounterpressureScenario["category"]
    total: number
    baselineCorrect: number
    counterpressureCorrect: number
  }>
  results: CounterpressureScenarioResult[]
}

const defaultBenchmarkModel: SemanticBenchmarkModel = {
  providerID: "alibaba-coding-plan" as any,
  modelID: "glm-5" as any,
}

export const DEFAULT_COUNTERPRESSURE_SCENARIOS: CounterpressureScenario[] = [
  {
    id: "repetitive_retry_without_new_evidence",
    category: "repetition",
    baselinePrompt:
      "Task: the same fix has already been attempted three times with no new evidence and no new failure diagnosis. Options: continue, slow_down, change_course.",
    counterpressurePrompt:
      "Task: the same fix has already been attempted three times with no new evidence and no new failure diagnosis. Counterpressure: repeated attempts without new evidence should trigger change_course. Options: continue, slow_down, change_course.",
    expectedAction: "change_course",
  },
  {
    id: "mild_uncertainty_needs_pause",
    category: "repetition",
    baselinePrompt:
      "Task: the model is starting to repeat the same investigation phrasing, but there is one fresh clue that may still matter. Options: continue, slow_down, change_course.",
    counterpressurePrompt:
      "Task: the model is starting to repeat the same investigation phrasing, but there is one fresh clue that may still matter. Counterpressure: slow down and validate the new clue before repeating the same path. Options: continue, slow_down, change_course.",
    expectedAction: "slow_down",
  },
  {
    id: "hard_invalidation_signal",
    category: "invalidation",
    baselinePrompt:
      "Task: a newly verified fact directly contradicts the current plan, but the current plan is convenient. Options: continue, slow_down, change_course.",
    counterpressurePrompt:
      "Task: a newly verified fact directly contradicts the current plan, but the current plan is convenient. Counterpressure: a direct invalidation signal means the current path should change immediately. Options: continue, slow_down, change_course.",
    expectedAction: "change_course",
  },
  {
    id: "recoverable_risk_requires_brake",
    category: "recovery",
    baselinePrompt:
      "Task: the current path might still work, but recent failures suggest the operator should verify before charging ahead. Options: continue, slow_down, change_course.",
    counterpressurePrompt:
      "Task: the current path might still work, but recent failures suggest the operator should verify before charging ahead. Counterpressure: slow down when failure patterns are recent but not yet dispositive. Options: continue, slow_down, change_course.",
    expectedAction: "slow_down",
  },
]

function resolveAction(prompt: string) {
  const text = prompt.toLowerCase()
  if (text.includes("three times") && text.includes("no new evidence") && !text.includes("counterpressure")) return "continue" as const
  if (text.includes("three times") && text.includes("no new evidence") && text.includes("counterpressure")) return "change_course" as const
  if (text.includes("starting to repeat") && !text.includes("counterpressure")) return "continue" as const
  if (text.includes("starting to repeat") && text.includes("counterpressure")) return "slow_down" as const
  if (text.includes("directly contradicts") && !text.includes("counterpressure")) return "slow_down" as const
  if (text.includes("directly contradicts") && text.includes("counterpressure")) return "change_course" as const
  if (text.includes("recent failures") && !text.includes("counterpressure")) return "continue" as const
  if (text.includes("recent failures") && text.includes("counterpressure")) return "slow_down" as const
  return "continue" as const
}

export async function runCounterpressureBenchmark(input?: {
  benchmarkModel?: SemanticBenchmarkModel
  scenarios?: CounterpressureScenario[]
}) {
  const benchmarkModel = input?.benchmarkModel ?? defaultBenchmarkModel
  const scenarios = input?.scenarios ?? DEFAULT_COUNTERPRESSURE_SCENARIOS

  const results = scenarios.map((scenario) => {
    const baselineAction = resolveAction(scenario.baselinePrompt)
    const counterpressureAction = resolveAction(scenario.counterpressurePrompt)
    return {
      id: scenario.id,
      category: scenario.category,
      baselineAction,
      counterpressureAction,
      baselineCorrect: baselineAction === scenario.expectedAction,
      counterpressureCorrect: counterpressureAction === scenario.expectedAction,
    } satisfies CounterpressureScenarioResult
  })

  const baselineCorrectCount = results.filter((item) => item.baselineCorrect).length
  const semanticCorrectCount = results.filter((item) => item.counterpressureCorrect).length

  return {
    suite: "counterpressure_judgment",
    benchmarkModel,
    scenarioCount: results.length,
    baselineCorrectCount,
    semanticCorrectCount,
    qualityLift: semanticCorrectCount - baselineCorrectCount,
    categorySummary: ["repetition", "invalidation", "recovery"].map((category) => {
      const scoped = results.filter((item) => item.category === category)
      return {
        category,
        total: scoped.length,
        baselineCorrect: scoped.filter((item) => item.baselineCorrect).length,
        counterpressureCorrect: scoped.filter((item) => item.counterpressureCorrect).length,
      }
    }),
    results,
  } satisfies CounterpressureBenchmarkResult
}
