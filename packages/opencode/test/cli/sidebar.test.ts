import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Part, Provider } from "@opencode-ai/sdk/v2"
import {
  getAssistantTokenSummary,
  buildLatestAssistant,
  buildLatestAssistantWithUsage,
  buildModelContextSummary,
  flattenFamilySessions,
  resolveChildTaskLaunches,
  pickModelContextAssistant,
  resolveSidebarDeckTitle,
  tokensUsed,
} from "../../src/cli/cmd/tui/routes/session/sidebar-state"

type TokenArgs = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

type SparseTokenArgs = {
  input?: number
  output?: number
  reasoning?: number
  cache?: {
    read?: number
    write?: number
  }
}

function assistant(id: string, tokens: TokenArgs, cost = 0): AssistantMessage {
  return {
    id,
    role: "assistant",
    providerID: "openrouter",
    modelID: "qwen3.5-plus",
    cost,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: {
        read: tokens.cacheRead,
        write: tokens.cacheWrite,
      },
    },
    time: {
      created: 1,
      completed: 1,
    },
  }
}

function assistantWithSparseTokens(id: string, tokens: SparseTokenArgs): AssistantMessage {
  return {
    id,
    role: "assistant",
    providerID: "openrouter",
    modelID: "qwen3.5-plus",
    cost: 0,
    tokens,
    time: {
      created: 1,
      completed: 1,
    },
  }
}

function user(id: string): Message {
  return {
    id,
    role: "user",
    time: {
      created: 1,
    },
  } as Message
}

function session(id: string, updated: number, parentID?: string): { id: string; parentID?: string; title: string; time: { updated: number } } {
  return {
    id,
    parentID,
    title: id,
    time: {
      updated,
    },
  }
}

describe("sidebar model context selection", () => {
  test("prefers the latest assistant turn with real usage over a zero-token placeholder", () => {
    const messages: Message[] = [
      user("user-1"),
      assistant("assistant-usage", { input: 1240, output: 220, reasoning: 45, cacheRead: 310, cacheWrite: 0 }),
      assistant("assistant-placeholder", { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
    ]

    expect(buildLatestAssistant(messages)?.id).toBe("assistant-placeholder")
    expect(buildLatestAssistantWithUsage(messages)?.id).toBe("assistant-usage")
    expect(tokensUsed(buildLatestAssistantWithUsage(messages)!)).toBe(1815)
  })

  test("falls back cleanly when no assistant usage has landed yet", () => {
    const messages: Message[] = [assistant("assistant-empty", { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })]

    expect(buildLatestAssistant(messages)?.id).toBe("assistant-empty")
    expect(buildLatestAssistantWithUsage(messages)).toBeUndefined()
  })

  test("picks the latest assistant with usage and keeps a non-usage fallback when necessary", () => {
    const messages: Message[] = [
      assistant("assistant-old", { input: 250, output: 40, reasoning: 10, cacheRead: 2, cacheWrite: 1 }),
      assistant("assistant-new-placeholder", { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
    ]

    expect(pickModelContextAssistant(messages)?.id).toBe("assistant-old")
  })

  test("keeps pending task launches visible from pending metadata", () => {
    const messages: Message[] = [
      {
        id: "message-1",
        role: "assistant",
        time: {
          created: 17,
        },
      } as Message,
    ]

    const launches = resolveChildTaskLaunches(messages, {
      "message-1": [
        {
          type: "tool",
          tool: "task",
          state: {
            status: "pending",
            metadata: {
              sessionId: "child-launch",
              title: "Visible pending launch",
            },
            input: {
              subagent_type: "worker",
              description: "Launch child worker",
            },
          },
        } as Part,
      ],
    })

    expect(launches.get("child-launch")).toEqual({
      sessionID: "child-launch",
      status: "pending",
      title: "Visible pending launch",
      updatedAt: 17,
    })
  })

  test("builds token summaries safely when token fields are missing", () => {
    const maybeAssistant = assistantWithSparseTokens("assistant-sparse", {
      input: 15,
      cache: {
        read: 3,
      },
    })

    expect(tokensUsed(maybeAssistant)).toBe(18)
    expect(getAssistantTokenSummary(maybeAssistant)).toEqual({
      input: 15,
      output: 0,
      reasoning: 0,
      cacheRead: 3,
      cacheWrite: 0,
    })
  })

  test("continues using last usage-bearing assistant even when latest turn has incomplete usage data", () => {
    const messages: Message[] = [
      assistantWithSparseTokens("assistant-usage", {
        input: 250,
        output: 40,
      }),
      assistant("assistant-empty", { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
    ]

    expect(pickModelContextAssistant(messages)?.id).toBe("assistant-usage")
  })

  test("keeps the current session title scope ahead of root fallback", () => {
    expect(
      resolveSidebarDeckTitle({
        sessionTitle: "Branch body",
        rootSessionTitle: "Central body",
      }),
    ).toBe("Branch body")
    expect(
      resolveSidebarDeckTitle({
        sessionTitle: "   ",
        rootSessionTitle: "Central body",
      }),
    ).toBe("Central body")
  })

  test("flattens nested family sessions depth-first", () => {
    const rows = flattenFamilySessions({
      rootSessionID: "root",
      sessions: [
        session("root", 1),
        session("child-a", 10, "root"),
        session("grandchild-a", 20, "child-a"),
        session("sibling-a", 15, "root"),
        session("great-grandchild", 30, "grandchild-a"),
      ],
    })

    expect(rows.map((row) => `${row.id}:${row.depth}`)).toEqual([
      "sibling-a:0",
      "child-a:0",
      "grandchild-a:1",
      "great-grandchild:2",
    ])
  })

  test("keeps orphaned descendants when an intermediate parent is missing", () => {
    const rows = flattenFamilySessions({
      rootSessionID: "root",
      sessions: [
        session("root", 1),
        session("sibling", 20, "root"),
        session("orphan-parent", 30, "missing-parent"),
        session("orphan-child", 40, "orphan-parent"),
        session("orphan-grandchild", 50, "orphan-child"),
      ],
    })

    expect(rows.map((row) => `${row.id}:${row.depth}`)).toEqual([
      "sibling:0",
      "orphan-parent:0",
      "orphan-child:1",
      "orphan-grandchild:2",
    ])
  })

  test("keeps spend tied to the selected assistant turn instead of aggregating siblings", () => {
    const messages: Message[] = [
      assistant("assistant-old", { input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, 1.25),
      assistant("assistant-new", { input: 120, output: 12, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, 2.5),
    ]

    const providers = [
      {
        id: "openrouter",
        models: {
          "qwen3.5-plus": {
            limit: {
              context: 1000,
            },
          },
        },
      },
    ] as unknown as Provider[]

    const summary = buildModelContextSummary({
      messages,
      providers,
    })

    expect(summary?.spend).toBe(2.5)
  })

  test("counts reasoning tokens in the shared model context summary", () => {
    const messages: Message[] = [
      assistant("assistant-reasoning", { input: 100, output: 10, reasoning: 25, cacheRead: 7, cacheWrite: 3 }, 0.75),
    ]

    const providers = [
      {
        id: "openrouter",
        models: {
          "qwen3.5-plus": {
            limit: {
              context: 1000,
            },
          },
        },
      },
    ] as unknown as Provider[]

    const summary = buildModelContextSummary({
      messages,
      providers,
    })

    expect(summary?.reasoning).toBe(25)
    expect(summary?.contextUsed).toBe(145)
    expect(summary?.contextPercent).toBeGreaterThan(0)
  })
})
