import { describe, expect, test } from "bun:test"
import { resolvePromptTuningModels } from "../../src/harness/prompt-tuning-benchmark"

describe("debug prompt benchmark model resolution", () => {
  test("all pool includes both Alibaba coding-plan and free opencode models", () => {
    const all = resolvePromptTuningModels("all")
    expect(all.some((item) => item.providerID === "alibaba-coding-plan" && item.modelID === "glm-5")).toBe(true)
    expect(all.some((item) => item.providerID === "opencode" && item.modelID === "big-pickle")).toBe(true)
  })

  test("pool-specific selections stay isolated", () => {
    const alibaba = resolvePromptTuningModels("alibaba-coding-plan")
    const free = resolvePromptTuningModels("free-opencode")

    expect(alibaba.every((item) => item.providerID === "alibaba-coding-plan")).toBe(true)
    expect(free.every((item) => item.providerID === "opencode")).toBe(true)
  })
})
