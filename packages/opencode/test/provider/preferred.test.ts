import { expect, test } from "bun:test"
import { isPreferredModel, preferredModelFamily, sortPreferredModels } from "../../src/provider/preferred"

test("preferredModelFamily recognizes the curated default model set", () => {
  expect(preferredModelFamily("kimi-k2.5")).toBe("kimi-2.5")
  expect(preferredModelFamily("glm-5")).toBe("glm-5")
  expect(preferredModelFamily("MiniMax-M2.5")).toBe("minmax-2.5")
  // @ts-ignore
  expect(preferredModelFamily("qwen3.6-plus")).toBe("qwen-3.6-plus")
  expect(preferredModelFamily("qwen3.5-plus")).toBe("qwen-3.5-plus")
  expect(preferredModelFamily("codex-spark")).toBe("codex-spark")
  expect(preferredModelFamily("qwen3-coder-next")).toBeUndefined()
})

test("sortPreferredModels keeps the curated default order", () => {
  const sorted = sortPreferredModels(
    ["qwen3.5-plus", "MiniMax-M2.5", "glm-5", "kimi-k2.5", "qwen3.6-plus", "codex-spark"],
    (item) => item,
  )
  expect(sorted).toEqual(["kimi-k2.5", "glm-5", "MiniMax-M2.5", "qwen3.6-plus", "qwen3.5-plus", "codex-spark"])
  expect(isPreferredModel("qwen3-coder-next")).toBe(false)
  expect(isPreferredModel("codex-spark")).toBe(true)
})
