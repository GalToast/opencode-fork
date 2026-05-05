import { describe, expect, test } from "bun:test"
import {
  derivePromptStatusSurface,
  deriveSessionForegroundSurface,
} from "../../src/cli/cmd/tui/util/prompt-status"

describe("prompt status surface", () => {
  test("operator blockers outrank active work", () => {
    const result = derivePromptStatusSurface({
      statusType: "busy",
      pendingInboxCount: 2,
      steerPending: 1,
      steerStage: "received",
      hasPendingAssistant: true,
      submitLabel: "steer",
    })

    expect(result.visible).toBe(true)
    expect(result.label).toBe("Waiting on operator input")
    expect(result.detail).toBe("2 blockers are pending")
    expect(result.actionLabel).toBe("resolve blocker")
    expect(result.showSpinner).toBe(false)
  })

  test("submitted preview states produce a single dominant status line", () => {
    const result = derivePromptStatusSurface({
      statusType: "busy",
      pendingInboxCount: 0,
      steerPending: 0,
      hasPendingAssistant: true,
      submitLabel: "send",
      submittedPreview: {
        mode: "shell",
        state: "sending",
      },
    })

    expect(result.label).toBe("Igniting command lane")
    expect(result.detail).toBe("Command lane warming through the bay; main deck")
    expect(result.tone).toBe("primary")
    expect(result.actionLabel).toBe("send")
    expect(result.showSpinner).toBe(true)
  })

  test("submitted preview states keep an ignition tone for healthy dispatch", () => {
    const result = derivePromptStatusSurface({
      statusType: "busy",
      pendingInboxCount: 0,
      steerPending: 0,
      hasPendingAssistant: false,
      submitLabel: "send",
      submittedPreview: {
        mode: "normal",
        state: "creating",
      },
    })

    expect(result.tone).toBe("primary")
  })

  test("steer queue stays active but non-blocking in tone", () => {
    const result = derivePromptStatusSurface({
      statusType: "busy",
      pendingInboxCount: 0,
      steerPending: 1,
      hasPendingAssistant: false,
      submitLabel: "steer",
    })

    expect(result.visible).toBe(true)
    expect(result.tone).toBe("primary")
  })

  test("open exchange states stay forward-facing", () => {
    const result = derivePromptStatusSurface({
      statusType: "busy",
      pendingInboxCount: 0,
      steerPending: 0,
      hasPendingAssistant: true,
      submitLabel: "send",
    })

    expect(result.tone).toBe("primary")
  })

  test("steer updates outrank generic busy state", () => {
    const result = derivePromptStatusSurface({
      statusType: "busy",
      pendingInboxCount: 0,
      steerPending: 1,
      steerStage: "applied",
      hasPendingAssistant: true,
      submitLabel: "steer",
    })

    expect(result.label).toBe("Merging steer update")
    expect(result.actionLabel).toBe("steer")
    expect(result.tone).toBe("success")
  })

  test("idle state stays quiet", () => {
    const result = derivePromptStatusSurface({
      statusType: "idle",
      pendingInboxCount: 0,
      steerPending: 0,
      hasPendingAssistant: false,
      submitLabel: "send",
    })

    expect(result.visible).toBe(false)
  })

  test("session foreground surface extends the same blocker priority with richer detail", () => {
    const prompt = derivePromptStatusSurface({
      statusType: "busy",
      pendingInboxCount: 2,
      pendingPermissionCount: 1,
      pendingQuestionCount: 1,
      steerPending: 0,
      hasPendingAssistant: true,
      submitLabel: "send",
    })
    const session = deriveSessionForegroundSurface({
      statusType: "busy",
      pendingInboxCount: 2,
      pendingPermissionCount: 1,
      pendingQuestionCount: 1,
      pendingSupervisorCount: 0,
      steerPending: 0,
      hasPendingAssistant: true,
      submitLabel: "send",
      childCount: 2,
      contextPercent: 74,
      isChildSession: true,
    })

    expect(session.visible).toBe(true)
    expect(session.label).toBe(prompt.label)
    expect(session.detail).toBe(
      "2 blockers are pending: 1 permission request and 1 question",
    )
  })

  test("session foreground surface reports supervisor blockers in operator summaries", () => {
    const result = deriveSessionForegroundSurface({
      statusType: "busy",
      pendingInboxCount: 2,
      pendingSupervisorCount: 2,
      pendingPermissionCount: 0,
      pendingQuestionCount: 0,
      steerPending: 0,
      hasPendingAssistant: true,
      submitLabel: "send",
    })

    expect(result.visible).toBe(true)
    expect(result.label).toBe("Waiting on operator input")
    expect(result.detail).toBe("2 blockers are pending: 2 supervisor requests")
  })

  test("session foreground surface emits contextual summary while idle", () => {
    const session = deriveSessionForegroundSurface({
      statusType: "idle",
      pendingInboxCount: 0,
      steerPending: 0,
      hasPendingAssistant: false,
      submitLabel: "send",
      childCount: 1,
      contextPercent: 45,
      isChildSession: false,
    })

    expect(session.visible).toBe(false)
    expect(session.detail).toBe("1 subagent lanes")
  })

  test("session foreground surface can expose a root idle narrative for the prompt bay", () => {
    const session = deriveSessionForegroundSurface({
      statusType: "idle",
      pendingInboxCount: 0,
      steerPending: 0,
      hasPendingAssistant: false,
      submitLabel: "send",
      childCount: 0,
      contextPercent: 22,
      isChildSession: false,
      showIdleNarrative: true,
    })

    expect(session.visible).toBe(true)
    expect(session.label).toBe("Central body")
    expect(session.actionLabel).toBe("send")
    expect(session.detail).toBe("Main lane listening; cool context 22%")
  })

  test("session foreground surface can expose a branch idle narrative for the prompt bay", () => {
    const session = deriveSessionForegroundSurface({
      statusType: "idle",
      pendingInboxCount: 0,
      steerPending: 0,
      hasPendingAssistant: false,
      submitLabel: "send",
      childCount: 2,
      contextPercent: 61,
      isChildSession: true,
      showIdleNarrative: true,
    })

    expect(session.visible).toBe(true)
    expect(session.label).toBe("Branch hold")
    expect(session.actionLabel).toBe("send")
    expect(session.detail).toBe("Nested lane listening; cool context 61%")
  })
})
