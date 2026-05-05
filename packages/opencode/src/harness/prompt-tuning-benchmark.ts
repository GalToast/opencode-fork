// @ts-nocheck
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { MessageV2 } from "@/session/message-v2"
import { Bus } from "@/bus"
import type { SemanticBenchmarkModel } from "./semantic-benchmark"
import { canonical, isLooseCorrect, normalize } from "./answer"

const PROMPT_TIMEOUT_MS = Number(process.env.HARNESS_BENCH_PROMPT_TIMEOUT_MS ?? "120000")

export type PromptTuningCategory =
  | "execution_discipline"
  | "tool_selection"
  | "coordination"
  | "response_contract"

export type PromptTuningScenarioResult = {
  id: string
  category: PromptTuningCategory
  expected: string
  output: string
  canonical: string
  correct: boolean
  looseCorrect: boolean
  elapsedMS: number
  error?: string
}

export type PromptTuningBenchmarkResult = {
  suite: "prompt_tuning"
  benchmarkModel: SemanticBenchmarkModel
  scenarioCount: number
  correctCount: number
  looseCorrectCount: number
  accuracy: number
  looseAccuracy: number
  averageLatencyMS: number
  categorySummary: Array<{
    category: PromptTuningCategory
    scenarioCount: number
    correctCount: number
    looseCorrectCount: number
    accuracy: number
    looseAccuracy: number
  }>
  results: PromptTuningScenarioResult[]
}

export type PromptTuningRecommendation = {
  category: PromptTuningCategory
  averageAccuracy: number
  averageLooseAccuracy: number
  modelIDs: string[]
  recommendation: string
}

export type PromptTuningModelPoolID = "alibaba-coding-plan" | "free-opencode" | "all"

type ScenarioDefinition = {
  id: string
  category: PromptTuningCategory
  expected: string
  prompt: string
}

export const ALIBABA_CODING_PLAN_PROMPT_TUNING_MODELS: string[] = [
  "glm-5",
  "qwen3.5-plus",
  "kimi-k2.5",
  "MiniMax-M2.5",
]

export const FREE_OPENCODE_PROMPT_TUNING_MODELS: string[] = [
  "minimax-m2.5-free",
  "big-pickle",
  "mimo-v2-omni-free",
  "nemotron-3-super-free",
  "mimo-v2-pro-free",
] as const

export const promptTuningScenarios: ScenarioDefinition[] = [
  {
    id: "execution_patch_then_verify",
    category: "execution_discipline",
    expected: "patch_then_verify",
    prompt: [
      "Situation: the bug is understood, the change is confined to one file, and a targeted test already exists for verification.",
      "Labels: patch_then_verify, plan_first, gather_more_context.",
      "Output exactly one execution label and nothing else.",
    ].join("\n"),
  },
  {
    id: "tool_structural_read_first",
    category: "tool_selection",
    expected: "structural_read",
    prompt: [
      "Choose the best first tool.",
      "Task: inspect a large unfamiliar file before deciding where to patch.",
      "Options: read, structural_read, edit.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "coordination_stay_local",
    category: "coordination",
    expected: "stay_local",
    prompt: [
      "Choose the best execution shape.",
      "Task: two edits are tightly coupled in the same file and the next line to change depends on the first result.",
      "Options: stay_local, one_sidecar, parallel_lanes.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "response_contract_exact_enum",
    category: "response_contract",
    expected: "balanced",
    prompt: [
      "Choose the best execution topology.",
      "Mission: ship quickly without reopening stable seams or creating coordination churn.",
      "Options: aggressive, balanced, conservative.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "response_contract_patch_label_only",
    category: "response_contract",
    expected: "patch_then_verify",
    prompt: [
      "Output exactly one option and nothing else.",
      "Task: choose the execution label for a clear local fix with an existing focused test.",
      "Options: patch_then_verify, plan_first, gather_more_context.",
    ].join("\n"),
  },
  {
    id: "capability_only_when_missing",
    category: "tool_selection",
    expected: "visible_tool_directly",
    prompt: [
      "Choose the best next move.",
      "Task: Playwright is already visible and the next step is a browser check.",
      "Options: visible_tool_directly, capability_first, plan_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "batch_same_target_edit_then_inspect",
    category: "tool_selection",
    expected: "single_tool_sequence",
    prompt: [
      "Choose the best execution surface.",
      "Task: edit one file and then inspect that same file to decide the next change.",
      "Options: batch, single_tool_sequence, plan_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "batch_multiple_mutations_do_not_parallelize",
    category: "tool_selection",
    expected: "single_tool_sequence",
    prompt: [
      "Choose the best execution surface.",
      "Task: apply two mutations in one pass where the second edit depends on the first result.",
      "Options: batch, single_tool_sequence, parallel_lanes.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "response_contract_visible_tool_label_only",
    category: "response_contract",
    expected: "visible_tool_directly",
    prompt: [
      "Output exactly one option and nothing else.",
      "Task: Playwright is already visible and the next step is a browser check.",
      "Options: visible_tool_directly, capability_first, plan_first.",
    ].join("\n"),
  },
  {
    id: "lsp_unsupported_filetype_falls_back_to_grep",
    category: "tool_selection",
    expected: "grep",
    prompt: [
      "Choose the best first tool.",
      "Task: find a symbol mention in an unsupported filetype where no LSP server is available.",
      "Options: lsp, grep, plan_first.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "lsp_local_outline_without_server_prefers_structural_read",
    category: "tool_selection",
    expected: "structural_read",
    prompt: [
      "Choose the best first tool.",
      "Task: inspect the local structure of one unsupported source file when no LSP server is available.",
      "Options: lsp, structural_read, read.",
      "Reply with exactly one option and nothing else.",
    ].join("\n"),
  },
  {
    id: "blackboard_high_level_first",
    category: "coordination",
    expected: "blackboard",
    prompt: [
      "Choose the best coordination tool.",
      "Task: share a blocker and the best next step with sibling lanes.",
      "Options: blackboard, blackboard_compare_and_swap, todowrite.",
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

function latestAssistantOutput(sessionID: string) {
  const messages = Session.messages({ sessionID })
  const latestAssistant = [...messages].filter((item) => item.info.role === "assistant").at(-1)
  if (!latestAssistant) return ""
  return textFromParts(latestAssistant.parts as Array<{ type: string; text?: string }>)
}

function createAssistantProbe(sessionID: string) {
  const order: string[] = []
  const textByPartID = new Map<string, string>()

  const remember = (partID: string, value: string) => {
    if (!order.includes(partID)) order.push(partID)
    textByPartID.set(partID, value)
  }

  const unsubDelta = Bus.subscribe(MessageV2.Event.PartDelta, (event) => {
    if (event.properties.sessionID !== sessionID) return
    if (event.properties.field !== "text") return
    const next = (textByPartID.get(event.properties.partID) ?? "") + event.properties.delta
    remember(event.properties.partID, next)
  })

  const unsubUpdated = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
    const part = event.properties.part
    if (part.sessionID !== sessionID) return
    if ((part.type !== "text" && part.type !== "reasoning") || typeof part.text !== "string") return
    remember(part.id, part.text)
  })

  return {
    snapshot() {
      return order
        .map((partID) => textByPartID.get(partID) ?? "")
        .join("")
        .trim()
    },
    dispose() {
      unsubDelta()
      unsubUpdated()
    },
  }
}

async function runPrompt(sessionID: string, model: SemanticBenchmarkModel, text: string) {
  const startedAt = performance.now()
  const probe = createAssistantProbe(sessionID)
  try {
    let response
    try {
      response = await Promise.race([
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
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error))
      ;(wrapped as Error & { partialOutput?: string }).partialOutput = probe.snapshot()
      throw wrapped
    }
    return {
      output: textFromParts(response.parts as any),
      partialOutput: probe.snapshot(),
      elapsedMS: Math.round(performance.now() - startedAt),
    }
  } finally {
    probe.dispose()
  }
}

export function promptTuningModelPools() {
  return {
    alibabaCodingPlan: ALIBABA_CODING_PLAN_PROMPT_TUNING_MODELS.map((modelID) => ({
      providerID: "alibaba-coding-plan" as any,
      modelID: modelID as any,
    })),
    freeOpencode: FREE_OPENCODE_PROMPT_TUNING_MODELS.map((modelID) => ({
      providerID: "opencode" as any,
      modelID: modelID as any,
    })),
  } satisfies Record<string, SemanticBenchmarkModel[]>
}

export function resolvePromptTuningModels(pool: PromptTuningModelPoolID) {
  const pools = promptTuningModelPools()
  if (pool === "alibaba-coding-plan") return pools.alibabaCodingPlan
  if (pool === "free-opencode") return pools.freeOpencode
  return [...pools.alibabaCodingPlan, ...pools.freeOpencode]
}

export function promptTuningRecommendationForCategory(category: PromptTuningCategory) {
  switch (category) {
    case "execution_discipline":
      return "tighten act-now and verify-now wording; reduce planning ceremony and permission-seeking"
    case "tool_selection":
      return "tighten first-tool heuristics, visible-tool-over-capability guidance, and flagged-tool fallback discipline"
    case "coordination":
      return "tighten local-vs-delegate shape selection and prefer high-level coordination surfaces"
    case "response_contract":
      return "tighten exact-output-contract language and strip extra explanation from enum answers"
  }
}

export function summarizePromptTuningRecommendations(
  results: Pick<PromptTuningBenchmarkResult, "benchmarkModel" | "categorySummary">[],
) {
  const buckets = new Map<
    PromptTuningCategory,
    {
      accuracySum: number
      looseAccuracySum: number
      count: number
      modelIDs: string[]
    }
  >()

  for (const result of results) {
    for (const category of result.categorySummary) {
      const bucket = buckets.get(category.category) ?? {
        accuracySum: 0,
        looseAccuracySum: 0,
        count: 0,
        modelIDs: [],
      }
      bucket.accuracySum += category.accuracy
      bucket.looseAccuracySum += category.looseAccuracy
      bucket.count += 1
      bucket.modelIDs.push(result.benchmarkModel.modelID)
      buckets.set(category.category, bucket)
    }
  }

  return Array.from(buckets.entries())
    .map(([category, bucket]) => ({
      category,
      averageAccuracy: bucket.count ? bucket.accuracySum / bucket.count : 0,
      averageLooseAccuracy: bucket.count ? bucket.looseAccuracySum / bucket.count : 0,
      modelIDs: bucket.modelIDs.slice().sort(),
      recommendation: promptTuningRecommendationForCategory(category),
    }))
    .sort((a, b) => a.category.localeCompare(b.category)) satisfies PromptTuningRecommendation[]
}

export async function runPromptTuningBenchmark(input: {
  benchmarkModel: SemanticBenchmarkModel
}): Promise<PromptTuningBenchmarkResult> {
  const results: PromptTuningScenarioResult[] = []

  for (const scenario of promptTuningScenarios) {
    const session = await Session.create({ title: `${scenario.id}-prompt-tuning` })
    try {
      try {
        const result = await runPrompt(session.id, input.benchmarkModel, scenario.prompt)
        results.push({
          id: scenario.id,
          category: scenario.category,
          expected: scenario.expected,
          output: result.output,
          canonical: canonical(result.output, scenario.prompt),
          correct: normalize(result.output) === scenario.expected,
          looseCorrect: isLooseCorrect(result.output, scenario.expected, scenario.prompt),
          elapsedMS: result.elapsedMS,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/timed out after \d+ms/i.test(message)) {
          SessionPrompt.cancel(session.id)
          await Bun.sleep(50)
        }
        const partialOutput =
          (error as Error & { partialOutput?: string })?.partialOutput || latestAssistantOutput(session.id)
        results.push({
          id: scenario.id,
          category: scenario.category,
          expected: scenario.expected,
          output: partialOutput,
          canonical: canonical(partialOutput, scenario.prompt),
          correct: normalize(partialOutput) === scenario.expected,
          looseCorrect: isLooseCorrect(partialOutput, scenario.expected, scenario.prompt),
          elapsedMS: PROMPT_TIMEOUT_MS,
          error: message,
        })
      }
    } finally {
      await Session.remove(session.id).catch(() => {})
    }
  }

  const correctCount = results.filter((result) => result.correct).length
  const looseCorrectCount = results.filter((result) => result.looseCorrect).length
  const categories = [...new Set(results.map((result) => result.category))]

  return {
    suite: "prompt_tuning",
    benchmarkModel: input.benchmarkModel,
    scenarioCount: results.length,
    correctCount,
    looseCorrectCount,
    accuracy: results.length ? correctCount / results.length : 0,
    looseAccuracy: results.length ? looseCorrectCount / results.length : 0,
    averageLatencyMS: results.length
      ? Math.round(results.reduce((sum, result) => sum + result.elapsedMS, 0) / results.length)
      : 0,
    categorySummary: categories.map((category) => {
      const categoryResults = results.filter((result) => result.category === category)
      const categoryCorrectCount = categoryResults.filter((result) => result.correct).length
      const categoryLooseCorrectCount = categoryResults.filter((result) => result.looseCorrect).length
      return {
        category,
        scenarioCount: categoryResults.length,
        correctCount: categoryCorrectCount,
        looseCorrectCount: categoryLooseCorrectCount,
        accuracy: categoryResults.length ? categoryCorrectCount / categoryResults.length : 0,
        looseAccuracy: categoryResults.length ? categoryLooseCorrectCount / categoryResults.length : 0,
      }
    }),
    results,
  }
}
