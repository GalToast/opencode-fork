import { describe, expect, test } from "bun:test"
import {
  dialogSelectableProviderModels,
  keepModelVisibleInProviderSection,
  modelSelectorCategory,
} from "../../src/cli/cmd/tui/component/model-category"

describe("model selector category", () => {
  test("separates Alibaba Coding Plan providers into their own category", () => {
    expect(
      modelSelectorCategory({
        provider: {
          id: "bailian-coding-plan-test",
          name: "Model Studio Coding Plan",
        },
      }),
    ).toBe("Alibaba Coding Plan")
  })

  test("separates Alibaba API pack providers from coding plan providers", () => {
    expect(
      modelSelectorCategory({
        provider: {
          id: "alibaba-cn",
          name: "Alibaba (China)",
        },
      }),
    ).toBe("Alibaba API Pack")
  })

  test("keeps coding plan models visible in the provider section even when duplicated elsewhere", () => {
    expect(
      keepModelVisibleInProviderSection({
        providerID: "bailian-coding-plan-test" as any,
        providerName: "Model Studio Coding Plan",
      }),
    ).toBe(true)

    expect(
      keepModelVisibleInProviderSection({
        providerID: "alibaba-cn" as any,
        providerName: "Alibaba (China)",
      }),
    ).toBe(false)
  })

  test("interactive model dialog keeps non-preferred models visible when preferred models also exist", () => {
    const result = dialogSelectableProviderModels({
      models: {
        "gpt-5": {
          id: "gpt-5",
          providerID: "openai" as any,
        },
        "custom-model": {
          id: "custom-model",
          providerID: "openai" as any,
        },
      },
    })

    expect(result.map(([modelID]) => modelID)).toEqual(["gpt-5", "custom-model"])
  })

  test("interactive model dialog still omits deprecated models", () => {
    const result = dialogSelectableProviderModels({
      models: {
        "active-model": {
          id: "active-model",
          providerID: "openai" as any,
        },
        "old-model": {
          id: "old-model",
          providerID: "openai" as any,
          status: "deprecated",
        },
      },
    })

    expect(result.map(([modelID]) => modelID)).toEqual(["active-model"])
  })
})
