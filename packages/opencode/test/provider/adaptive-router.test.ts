import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { AdaptiveModelRouter } from "../../src/provider/adaptive-router"
import { Provider } from "../../src/provider/provider"

const createModel = (overrides: Partial<any> = {}) =>
  ({
    id: "test/model",
    providerID: "test" as any,
    api: {
      id: "model",
      url: "https://example.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
    limit: {
      context: 128000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
    ...overrides,
  }) as any

afterEach(() => {
  spyOn(Provider, "list").mockRestore()
  spyOn(Provider, "getModel").mockRestore()
})

describe("AdaptiveModelRouter.getFastestAlternative", () => {
  test("prefers measured candidates over unknown alternatives", async () => {
    const currentProviderID = "current-provider-measured"
    const currentModelID = "current-model-measured"
    const measuredProviderID = "measured-provider"
    const measuredModelID = "measured-model"
    const unknownProviderID = "unknown-provider"
    const unknownModelID = "unknown-model"

    spyOn(Provider, "list").mockResolvedValue({
      [currentProviderID]: {
        id: currentProviderID,
        models: {
          [currentModelID]: createModel({ providerID: currentProviderID, id: `${currentProviderID}/${currentModelID}` }),
        },
      },
      [measuredProviderID]: {
        id: measuredProviderID,
        models: {
          [measuredModelID]: createModel({ providerID: measuredProviderID, id: `${measuredProviderID}/${measuredModelID}` }),
        },
      },
      [unknownProviderID]: {
        id: unknownProviderID,
        models: {
          [unknownModelID]: createModel({ providerID: unknownProviderID, id: `${unknownProviderID}/${unknownModelID}` }),
        },
      },
    } as any)
    spyOn(Provider, "getModel").mockResolvedValue(
      createModel({ providerID: currentProviderID, id: `${currentProviderID}/${currentModelID}` }),
    )

    AdaptiveModelRouter.recordLatency(measuredProviderID, measuredModelID, 600, 800)

    const result = await AdaptiveModelRouter.getFastestAlternative(currentProviderID, currentModelID, {
      toolcall: true,
      reasoning: true,
    })

    expect(result).toEqual({
      providerID: measuredProviderID,
      modelID: measuredModelID,
    })
  })

  test("falls back deterministically when all candidates are unmeasured", async () => {
    const currentProviderID = "current-provider-unknown"
    const currentModelID = "current-model-unknown"

    spyOn(Provider, "list").mockResolvedValue({
      [currentProviderID]: {
        id: currentProviderID,
        models: {
          [currentModelID]: createModel({ providerID: currentProviderID, id: `${currentProviderID}/${currentModelID}` }),
        },
      },
      zebra: {
        id: "zebra",
        models: {
          omega: createModel({ providerID: "zebra" as any, id: "zebra/omega" }),
        },
      },
      alpha: {
        id: "alpha",
        models: {
          beta: createModel({ providerID: "alpha" as any, id: "alpha/beta" }),
        },
      },
    } as any)
    spyOn(Provider, "getModel").mockResolvedValue(
      createModel({ providerID: currentProviderID, id: `${currentProviderID}/${currentModelID}` }),
    )

    const result = await AdaptiveModelRouter.getFastestAlternative(currentProviderID, currentModelID, {
      toolcall: true,
      reasoning: true,
    })

    expect(result).toEqual({
      providerID: "alpha" as any,
      modelID: "beta" as any,
    })
  })
})
