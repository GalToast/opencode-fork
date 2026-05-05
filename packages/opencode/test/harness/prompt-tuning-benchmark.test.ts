// @ts-nocheck
import { describe, expect, test } from "bun:test"
import {
  ALIBABA_CODING_PLAN_PROMPT_TUNING_MODELS,
  FREE_OPENCODE_PROMPT_TUNING_MODELS,
  promptTuningModelPools,
  promptTuningScenarios,
  promptTuningRecommendationForCategory,
  resolvePromptTuningModels,
  summarizePromptTuningRecommendations,
} from "../../src/harness/prompt-tuning-benchmark"
import { canonical, isLooseCorrect } from "../../src/harness/answer"

describe("prompt tuning benchmark", () => {
  test("pins the Alibaba coding-plan families that need prompt tuning", () => {
    expect(ALIBABA_CODING_PLAN_PROMPT_TUNING_MODELS).toEqual(["glm-5", "qwen3.5-plus", "kimi-k2.5", "MiniMax-M2.5"])
    expect(promptTuningModelPools().alibabaCodingPlan).toEqual([
      { providerID: "alibaba-coding-plan" as any, modelID: "glm-5" as any },
      { providerID: "alibaba-coding-plan" as any, modelID: "qwen3.5-plus" as any },
      { providerID: "alibaba-coding-plan" as any, modelID: "kimi-k2.5" as any },
      { providerID: "alibaba-coding-plan" as any, modelID: "MiniMax-M2.5" as any },
    ])
  })

  test("pins the free opencode model pool used for prompt tuning", () => {
    expect(FREE_OPENCODE_PROMPT_TUNING_MODELS).toEqual([
      "minimax-m2.5-free",
      "big-pickle",
      "mimo-v2-omni-free",
      "nemotron-3-super-free",
      "mimo-v2-pro-free",
    ])
    expect(promptTuningModelPools().freeOpencode).toEqual([
      { providerID: "opencode" as any, modelID: "minimax-m2.5-free" as any },
      { providerID: "opencode" as any, modelID: "big-pickle" as any },
      { providerID: "opencode" as any, modelID: "mimo-v2-omni-free" as any },
      { providerID: "opencode" as any, modelID: "nemotron-3-super-free" as any },
      { providerID: "opencode" as any, modelID: "mimo-v2-pro-free" as any },
    ])
  })

  test("resolves prompt-tuning pools into concrete benchmark models", () => {
    expect(resolvePromptTuningModels("alibaba-coding-plan")).toEqual(promptTuningModelPools().alibabaCodingPlan)
    expect(resolvePromptTuningModels("free-opencode")).toEqual(promptTuningModelPools().freeOpencode)
    expect(resolvePromptTuningModels("all")).toEqual([
      ...promptTuningModelPools().alibabaCodingPlan,
      ...promptTuningModelPools().freeOpencode,
    ])
  })

  test("includes coding-shaped exact-label scenarios to separate contract drift from decision quality", () => {
    expect(promptTuningScenarios.map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        "execution_patch_then_verify",
        "response_contract_patch_label_only",
        "capability_only_when_missing",
        "response_contract_visible_tool_label_only",
        "batch_same_target_edit_then_inspect",
        "batch_multiple_mutations_do_not_parallelize",
        "lsp_unsupported_filetype_falls_back_to_grep",
        "lsp_local_outline_without_server_prefers_structural_read",
      ]),
    )
  })

  test("keeps batch and lsp adversarial routing cases in the tool-selection lane", () => {
    const categories = new Map(promptTuningScenarios.map((scenario) => [scenario.id, scenario.category]))
    expect(categories.get("batch_same_target_edit_then_inspect")).toBe("tool_selection")
    expect(categories.get("batch_multiple_mutations_do_not_parallelize")).toBe("tool_selection")
    expect(categories.get("lsp_unsupported_filetype_falls_back_to_grep")).toBe("tool_selection")
    expect(categories.get("lsp_local_outline_without_server_prefers_structural_read")).toBe("tool_selection")
  })

  test("maps prompt-tuning categories to stable recommendations", () => {
    expect(promptTuningRecommendationForCategory("execution_discipline")).toContain("verify-now")
    expect(promptTuningRecommendationForCategory("tool_selection")).toContain("visible-tool-over-capability")
    expect(promptTuningRecommendationForCategory("tool_selection")).toContain("flagged-tool fallback")
    expect(promptTuningRecommendationForCategory("coordination")).toContain("high-level coordination")
    expect(promptTuningRecommendationForCategory("response_contract")).toContain("exact-output-contract")
  })

  test("loose scoring still captures the chosen option when prose breaks the contract", () => {
    const scenario = promptTuningScenarios.find((item) => item.id === "tool_structural_read_first")
    expect(scenario).toBeDefined()
    expect(canonical("I would choose structural_read for that first pass.", scenario!.prompt)).toBe("structural_read")
    expect(isLooseCorrect("I would choose structural_read for that first pass.", scenario!.expected, scenario!.prompt)).toBe(true)
  })

  test("summarizes cross-model weaknesses by category", () => {
    expect(
      summarizePromptTuningRecommendations([
        {
          benchmarkModel: { providerID: "alibaba-coding-plan" as any, modelID: "glm-5" as any },
          categorySummary: [
            { category: "execution_discipline", scenarioCount: 1, correctCount: 0, looseCorrectCount: 1, accuracy: 0, looseAccuracy: 1 },
            { category: "tool_selection", scenarioCount: 1, correctCount: 1, looseCorrectCount: 1, accuracy: 1, looseAccuracy: 1 },
          ],
        },
        {
          benchmarkModel: { providerID: "opencode" as any, modelID: "big-pickle" as any },
          categorySummary: [
            { category: "execution_discipline", scenarioCount: 1, correctCount: 1, looseCorrectCount: 1, accuracy: 1, looseAccuracy: 1 },
            { category: "tool_selection", scenarioCount: 1, correctCount: 0, looseCorrectCount: 0, accuracy: 0, looseAccuracy: 0 },
          ],
        },
      ]),
    ).toEqual([
      {
        category: "execution_discipline",
        averageAccuracy: 0.5,
        averageLooseAccuracy: 1,
        modelIDs: ["big-pickle", "glm-5"],
        recommendation: "tighten act-now and verify-now wording; reduce planning ceremony and permission-seeking",
      },
      {
        category: "tool_selection",
        averageAccuracy: 0.5,
        averageLooseAccuracy: 0.5,
        modelIDs: ["big-pickle", "glm-5"],
        recommendation: "tighten first-tool heuristics, visible-tool-over-capability guidance, and flagged-tool fallback discipline",
      },
    ])
  })
})
