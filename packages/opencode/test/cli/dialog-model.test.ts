import { expect, test } from "bun:test"
import {
  keepModelOutOfExtraSections,
  keepModelVisibleInProviderSection,
  formatModelOptionDescription,
  modelSelectorCategory,
} from "../../src/cli/cmd/tui/component/model-category"

test("modelSelectorCategory groups coding plan providers into an Alibaba Coding Plan section", () => {
  expect(
    modelSelectorCategory({
      provider: {
        id: "bailian-coding-plan-test",
        name: "Model Studio Coding Plan",
      },
      model: {
        providerID: "bailian-coding-plan-test" as any,
      },
    }),
  ).toBe("Alibaba Coding Plan")
})

test("modelSelectorCategory keeps the general Alibaba provider pack in its own section", () => {
  expect(
    modelSelectorCategory({
      provider: {
        id: "alibaba-cn",
        name: "Alibaba Cloud Model Studio",
      },
      model: {
        providerID: "alibaba-cn" as any,
      },
    }),
  ).toBe("Alibaba API Pack")
})

test("modelSelectorCategory leaves unrelated providers under their provider name", () => {
  expect(
    modelSelectorCategory({
      provider: {
        id: "openai",
        name: "OpenAI",
      },
      model: {
        providerID: "openai" as any,
      },
    }),
  ).toBe("OpenAI")
})

test("keepModelVisibleInProviderSection preserves the full coding plan section even for favorited or recent models", () => {
  expect(
    keepModelVisibleInProviderSection({
      providerID: "bailian-coding-plan-test" as any,
      providerName: "Model Studio Coding Plan",
    }),
  ).toBe(true)
  expect(
    keepModelVisibleInProviderSection({
      providerID: "openai" as any,
      providerName: "OpenAI",
    }),
  ).toBe(false)
})

test("keepModelOutOfExtraSections removes coding plan duplicates from favorites and recent", () => {
  expect(
    keepModelOutOfExtraSections({
      providerID: "bailian-coding-plan-test" as any,
      providerName: "Model Studio Coding Plan",
    }),
  ).toBe(true)
  expect(
    keepModelOutOfExtraSections({
      providerID: "alibaba" as any,
      providerName: "Alibaba",
    }),
  ).toBe(false)
})

test("formatModelOptionDescription keeps the provider visible for ordinary and favorite rows", () => {
  expect(
    formatModelOptionDescription({
      providerName: "OpenAI",
    }),
  ).toBe("OpenAI")

  expect(
    formatModelOptionDescription({
      providerName: "OpenCode",
      favorite: true,
    }),
  ).toBe("OpenCode - Favorite")
})
