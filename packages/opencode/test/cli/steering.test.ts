import { describe, expect, test } from "bun:test"
import {
  describeInterruptability,
  getQueuedUserMessageLabel,
  hasPendingAssistantMessage,
  promptSubmitPolicy,
  shouldSteerPrompt,
} from "../../src/cli/cmd/tui/util/steering"

describe("steering utility", () => {
  test("shouldSteerPrompt returns true when session status is busy", () => {
    expect(shouldSteerPrompt("busy", false)).toBe(true)
  })

  test("shouldSteerPrompt returns true when status is idle but assistant is still pending", () => {
    expect(shouldSteerPrompt("idle", true)).toBe(true)
  })

  test("shouldSteerPrompt returns false when idle and no pending assistant", () => {
    expect(shouldSteerPrompt("idle", false)).toBe(false)
  })

  test("promptSubmitPolicy stays synchronous when busy is only background noise", () => {
    expect(promptSubmitPolicy("idle", false).async).toBe(false)
    expect(promptSubmitPolicy("busy", false).async).toBe(false)
    expect(promptSubmitPolicy("idle", false).label).toBe("send")
    expect(promptSubmitPolicy("busy", false).label).toBe("send")
  })

  test("promptSubmitPolicy does not steer when busy is only background noise", () => {
    expect(promptSubmitPolicy("busy", false).steer).toBe(false)
  })

  test("promptSubmitPolicy sets steer when assistant is still pending", () => {
    expect(promptSubmitPolicy("idle", true).steer).toBe(true)
  })

  test("promptSubmitPolicy sets steer when pending supervisor tasks are present", () => {
    expect(promptSubmitPolicy("idle", false, { pendingSupervisorCount: 1 }).steer).toBe(true)
    expect(promptSubmitPolicy("idle", false, { pendingSupervisorCount: 1 }).async).toBe(true)
    expect(promptSubmitPolicy("idle", false, { pendingSupervisorCount: 1 }).label).toBe("steer")
  })

  test("hasPendingAssistantMessage detects unfinished assistant messages", () => {
    expect(
      hasPendingAssistantMessage([
        { role: "user", time: { completed: 1 } },
        { role: "assistant", time: {} },
      ]),
    ).toBe(true)
  })

  test("hasPendingAssistantMessage ignores errored assistant messages", () => {
    expect(
      hasPendingAssistantMessage([
        { role: "assistant", error: { name: "AbortedError" }, time: {} },
      ]),
    ).toBe(false)
  })

  test("getQueuedUserMessageLabel returns STEERING for latest queued steer message", () => {
    expect(
      getQueuedUserMessageLabel({
        isQueued: true,
        isLatestUserMessage: true,
        statusType: "busy",
        hasPendingAssistant: false,
      }),
    ).toBe("STEERING")
  })

  test("getQueuedUserMessageLabel returns QUEUED for non-latest queued message", () => {
    expect(
      getQueuedUserMessageLabel({
        isQueued: true,
        isLatestUserMessage: false,
        statusType: "busy",
        hasPendingAssistant: false,
      }),
    ).toBe("QUEUED")
  })

  test("getQueuedUserMessageLabel returns undefined when message is not queued", () => {
    expect(
      getQueuedUserMessageLabel({
        isQueued: false,
        isLatestUserMessage: true,
        statusType: "busy",
        hasPendingAssistant: true,
      }),
    ).toBeUndefined()
  })

  test("describeInterruptability explains interrupt timing", () => {
    expect(describeInterruptability("idle", false)).toBe("idle")
    expect(describeInterruptability("ready", false)).toContain("ready")
    expect(describeInterruptability("boundary", false)).toContain("boundary")
    expect(describeInterruptability("boundary", true)).toContain("again")
  })
})
