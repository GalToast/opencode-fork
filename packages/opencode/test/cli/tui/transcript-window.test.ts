import { describe, expect, test } from "bun:test"
import { resolveLiveTranscriptWindow } from "../../../src/cli/cmd/tui/util/transcript-window"

describe("resolveLiveTranscriptWindow", () => {
  test("keeps the full active turn visible past the live transcript limit", () => {
    const messages = [
      { id: "m1", role: "user", time: { completed: 1 } },
      { id: "m2", role: "assistant", time: { completed: 1 } },
      { id: "m3", role: "user", time: { completed: 2 } },
      { id: "m4", role: "assistant", time: { completed: 2 } },
      { id: "m5", role: "user", time: { completed: 3 } },
      { id: "m6", role: "assistant", time: {} },
      { id: "m7", role: "assistant", time: {} },
      { id: "m8", role: "assistant", time: {} },
    ]

    const result = resolveLiveTranscriptWindow(messages, 3)

    expect(result.messages.map((message) => message.id)).toEqual(["m5", "m6", "m7", "m8"])
    expect(result.omittedCount).toBe(4)
  })

  test("falls back to the newest messages when no active turn is in flight", () => {
    const messages = [
      { id: "m1", role: "user", time: { completed: 1 } },
      { id: "m2", role: "assistant", time: { completed: 2 } },
      { id: "m3", role: "user", time: { completed: 3 } },
      { id: "m4", role: "assistant", time: { completed: 4 } },
      { id: "m5", role: "user", time: { completed: 5 } },
    ]

    const result = resolveLiveTranscriptWindow(messages, 2)

    expect(result.messages.map((message) => message.id)).toEqual(["m4", "m5"])
    expect(result.omittedCount).toBe(3)
  })
})
