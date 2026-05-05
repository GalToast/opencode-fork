import { describe, expect, test } from "bun:test"
import { deriveSessionState, deriveSessionStatusType, hasToolLoop } from "../../src/cli/cmd/tui/util/activity"

describe("tui activity", () => {
  test("stays active when a completed assistant still has live tool work", () => {
    const messages = [
      {
        id: "msg_user",
        role: "user",
        time: { created: 1 },
      },
      {
        id: "msg_assistant",
        role: "assistant",
        finish: "tool-calls",
        time: {
          created: 2,
          completed: 3,
        },
      },
    ] as const
    const parts = {
      msg_assistant: [
        {
          id: "part_tool",
          type: "tool",
          state: {
            status: "running",
          },
        },
      ],
    } as const

    expect(hasToolLoop(messages as any, parts as any)).toBe(true)
    expect(
      deriveSessionStatusType({
        status: undefined,
        messages: messages as any,
        parts: parts as any,
      }),
    ).toBe("busy")
    expect(
      deriveSessionState({
        status: undefined,
        messages: messages as any,
        parts: parts as any,
      }),
    ).toBe("active")
  })

  test("keeps retry status above transcript-derived activity", () => {
    const messages = [
      {
        id: "msg_user",
        role: "user",
        time: { created: 1 },
      },
      {
        id: "msg_assistant",
        role: "assistant",
        finish: "tool-calls",
        time: {
          created: 2,
          completed: 3,
        },
      },
    ] as const
    const parts = {
      msg_assistant: [
        {
          id: "part_tool",
          type: "tool",
          state: {
            status: "running",
          },
        },
      ],
    } as const

    expect(
      deriveSessionStatusType({
        status: { type: "retry" },
        messages: messages as any,
        parts: parts as any,
      }),
    ).toBe("retry")
    expect(
      deriveSessionState({
        status: { type: "retry" },
        messages: messages as any,
        parts: parts as any,
      }),
    ).toBe("error")
  })
})
