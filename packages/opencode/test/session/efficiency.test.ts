import { describe, expect, test } from "bun:test"
import {
  historyProfileBuckets,
  promptEconomics,
  promptFootprint,
  promptProfile,
  usablePromptBudget,
} from "../../src/session/efficiency"

describe("session.promptEconomics", () => {
  test("matches prompt footprint accounting and classifies an 80% reusable prompt as extreme savings", () => {
    const tokens = {
      input: 30_000,
      cache: {
        read: 136_000,
        write: 4_000,
      },
    }

    const result = promptEconomics(tokens, 200_000)

    expect(result.promptFootprint).toBe(promptFootprint(tokens))
    expect(result.cacheableTokens).toBe(136_000)
    expect(result.volatileTokens).toBe(34_000)
    expect(result.cacheableShare).toBeCloseTo(0.8, 6)
    expect(result.savingsBand).toBe("extreme")
    expect(result.pressureRatio).toBeCloseTo(0.85, 6)
    expect(result.pressureBand).toBe("hot")
  })

  test("keeps low-reuse prompts in a low savings band even when they are near the soft trigger", () => {
    const tokens = {
      input: 145_000,
      cache: {
        read: 10_000,
        write: 5_000,
      },
    }

    const result = promptEconomics(tokens, 180_000)

    expect(result.promptFootprint).toBe(160_000)
    expect(result.cacheableTokens).toBe(10_000)
    expect(result.volatileTokens).toBe(150_000)
    expect(result.cacheableShare).toBeCloseTo(0.0625, 6)
    expect(result.savingsBand).toBe("low")
    expect(result.pressureRatio).toBeCloseTo(160_000 / 180_000, 6)
    expect(result.pressureBand).toBe("hot")
  })

  test("profiles prompt buckets in descending token mass with pressure against usable budget", () => {
    const profile = promptProfile(
      {
        instructions: "A".repeat(400),
        history: "B".repeat(1200),
        tools: "C".repeat(800),
      },
      1_000,
    )

    expect(profile.totalEstimatedTokens).toBeGreaterThan(0)
    expect(profile.buckets[0]?.name).toBe("history")
    expect(profile.buckets[1]?.name).toBe("tools")
    expect(profile.buckets[2]?.name).toBe("instructions")
    expect(profile.pressureRatio).toBeCloseTo(profile.totalEstimatedTokens / 1_000, 6)
    expect(profile.pressureBand).toBeDefined()
  })

  test("usablePromptBudget subtracts provider output headroom from the effective input limit", () => {
    const budget = usablePromptBudget({
      limit: {
        input: 200_000,
        context: 200_000,
        output: 8_000,
      },
      capabilities: {
        input: { text: true, image: false, audio: false, file: false, pdf: false },
        output: { text: true, reasoning: false },
      },
      providerID: "test-provider",
      id: "test-model",
      api: { id: "test-model", sdk: "", npm: "@ai-sdk/openai" },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    } as any)

    expect(budget).toBe(192_000)
  })

  test("promptProfile stays deterministic and skips empty buckets", () => {
    const first = promptProfile(
      {
        tools: "tool".repeat(500),
        empty: "",
        history: "history".repeat(200),
      },
      1_000,
    )
    const second = promptProfile(
      {
        history: "history".repeat(200),
        empty: "",
        tools: "tool".repeat(500),
      },
      1_000,
    )

    expect(first.totalEstimatedTokens).toBe(second.totalEstimatedTokens)
    expect(first.buckets.map((bucket) => bucket.name)).toEqual(second.buckets.map((bucket) => bucket.name))
    expect(first.buckets.every((bucket) => bucket.estimatedTokens > 0)).toBe(true)
    expect(first.buckets.some((bucket) => bucket.name === "empty")).toBe(false)
  })

  test("historyProfileBuckets splits the history surface into role and synthetic sub-buckets", () => {
    const buckets = historyProfileBuckets([
      {
        info: {
          role: "user",
        },
        parts: [
          {
            type: "text",
            text: "user text",
          },
          {
            type: "text",
            text: "synthetic reminder",
            synthetic: true,
          },
          {
            type: "file",
            mime: "image/png",
            filename: "shot.png",
            url: "data:image/png;base64,abc",
          },
        ],
      },
      {
        info: {
          role: "assistant",
          error: {
            name: "Unknown",
            data: {
              message: "boom",
            },
          },
        },
        parts: [
          {
            type: "text",
            text: "assistant text",
          },
          {
            type: "reasoning",
            text: "assistant reasoning",
            time: {
              start: 1,
            },
          },
          {
            type: "tool",
            tool: "bash",
            callID: "call_1",
            state: {
              status: "completed",
              input: {
                command: "ls",
              },
              output: "line 1\nline 2",
              title: "tool run",
              metadata: {},
              time: {
                start: 1,
                end: 2,
              },
            },
            metadata: {},
          },
          {
            type: "compaction",
            auto: true,
            overflow: true,
          },
        ],
      },
    ] as any)

    const profile = promptProfile(buckets, 1_000)
    const names = profile.buckets.map((bucket) => bucket.name).sort()

    expect(names).toEqual(
      [
        "historyAssistantReasoning",
        "historyAssistantText",
        "historySyntheticParts",
        "historyToolInputs",
        "historyToolOutputs",
        "historyUserAttachments",
        "historyUserText",
      ].sort(),
    )
    expect(profile.buckets.every((bucket) => bucket.estimatedTokens > 0)).toBe(true)
    expect(profile.totalEstimatedTokens).toBeGreaterThan(0)
  })
})
