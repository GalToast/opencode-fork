// @ts-nocheck
import { expect, test } from "bun:test"
import { pickHarnessSessionModel } from "../../src/harness/session"

function model(
  providerID: string,
  id: string,
  options?: {
    reasoning?: boolean
    toolcall?: boolean
    context?: number
    output?: number
  },
) {
  return {
    id,
    providerID,
    capabilities: {
      reasoning: options?.reasoning ?? true,
      toolcall: options?.toolcall ?? true,
      input: {
        text: true,
      },
      output: {
        text: true,
      },
    },
    limit: {
      context: options?.context ?? 262_144,
      output: options?.output ?? 65_536,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  } as any
}

test("reviewer routing prefers semantic exact-output-safe models across the benchmarked pools", () => {
  const route = pickHarnessSessionModel({
    lane: "reviewer",
    requestedModel: "auto/quality",
    providers: {
      opencode: {
        id: "opencode",
        models: {
          "big-pickle": model("opencode", "big-pickle", { context: 256_000, output: 16_384 }),
          "mimo-v2-pro-free": model("opencode", "mimo-v2-pro-free", { context: 512_000, output: 32_768 }),
        },
      },
      "alibaba-coding-plan": {
        id: "alibaba-coding-plan",
        models: {
          "qwen3.5-plus": model("alibaba-coding-plan", "qwen3.5-plus", { context: 900_000, output: 128_000 }),
        },
      },
    } as any,
  })

  expect(route?.selectedModel).toBe("alibaba-coding-plan/qwen3.5-plus")
  expect(route?.reason).toBe("exact-output-safe")
  expect(route?.policy).toBe("exact-output-safe")
})

test("author routing keeps broader capability-first/preferred behavior", () => {
  const route = pickHarnessSessionModel({
    lane: "author",
    requestedModel: "auto/quality",
    providers: {
      opencode: {
        id: "opencode",
        models: {
          "big-pickle": model("opencode", "big-pickle", { context: 256_000, output: 16_384 }),
        },
      },
      "alibaba-coding-plan": {
        id: "alibaba-coding-plan",
        models: {
          "qwen3.5-plus": model("alibaba-coding-plan", "qwen3.5-plus", { context: 900_000, output: 128_000 }),
        },
      },
    } as any,
  })

  expect(route?.selectedModel).toBe("alibaba-coding-plan/qwen3.5-plus")
  expect(route?.reason).toBe("capability-first")
  expect(route?.policy).toBeUndefined()
})

test("explicit semantic exact-output-safe opencode refs are policy-allowed", () => {
  const route = pickHarnessSessionModel({
    lane: "reviewer",
    requestedModel: "opencode/big-pickle",
    providers: {
      opencode: {
        id: "opencode",
        models: {
          "big-pickle": model("opencode", "big-pickle"),
        },
      },
    } as any,
  })

  expect(route?.selectedModel).toBe("opencode/big-pickle")
  expect(route?.reason).toBe("explicit")
})
