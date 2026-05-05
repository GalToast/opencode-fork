import { describe, expect, test } from "bun:test"
import {
  collapseAssistantTimeline,
  deriveCarrierNarrative,
  deriveSubagentAttention,
  deriveSubagentLaneSignal,
  deriveSubagentPulseState,
  deriveChildSessionLifecycle,
  deriveForegroundNextAction,
  deriveForegroundReserve,
  deriveForegroundState,
  deriveExecutionTimelineHint,
  deriveMissionHighlight,
  deriveOperatorDigest,
  deriveSessionChrome,
  shouldAutoReturnFromChildSession,
  summarizeIntent,
} from "../../src/cli/cmd/tui/util/orchestration"

describe("orchestration utility", () => {
  test("summarizeIntent normalizes whitespace and truncates long text", () => {
    expect(summarizeIntent("  hello   there  ")).toBe("hello there")
    expect(summarizeIntent("x".repeat(120), 20)).toBe("xxxxxxxxxxxxxxxxx...")
  })

  test("deriveForegroundState blocks when inbox work is pending", () => {
    expect(
      deriveForegroundState({
        pendingInboxCount: 1,
        steerPending: 0,
        ingressQueued: 0,
        ingressRunning: 0,
        mainRunning: 0,
        sessionStatusType: "idle",
        hasPendingAssistant: false,
      }),
    ).toBe("blocked")
  })

  test("deriveForegroundState prefers steering over generic busy state", () => {
    expect(
      deriveForegroundState({
        pendingInboxCount: 0,
        steerStage: "received",
        steerPending: 1,
        ingressQueued: 0,
        ingressRunning: 0,
        mainRunning: 1,
        sessionStatusType: "working",
        hasPendingAssistant: true,
      }),
    ).toBe("steering")
  })

  test("deriveForegroundState detects accepting ingress and responding main work", () => {
    expect(
      deriveForegroundState({
        pendingInboxCount: 0,
        steerPending: 0,
        ingressQueued: 1,
        ingressRunning: 0,
        mainRunning: 0,
        sessionStatusType: "idle",
        hasPendingAssistant: false,
      }),
    ).toBe("accepting")

    expect(
      deriveForegroundState({
        pendingInboxCount: 0,
        steerPending: 0,
        ingressQueued: 0,
        ingressRunning: 0,
        mainRunning: 1,
        sessionStatusType: "working",
        hasPendingAssistant: true,
      }),
    ).toBe("responding")
  })

  test("deriveForegroundState ignores generic busy status when foreground work is clear", () => {
    expect(
      deriveForegroundState({
        pendingInboxCount: 0,
        steerPending: 0,
        ingressQueued: 0,
        ingressRunning: 0,
        mainRunning: 0,
        sessionStatusType: "busy",
        hasPendingAssistant: false,
      }),
    ).toBe("idle")
  })

  test("deriveForegroundReserve distinguishes open, warming, and saturated", () => {
    expect(deriveForegroundReserve({ mainRunning: 0, mainConcurrency: 1, ingressQueued: 0 })).toBe("open")
    expect(deriveForegroundReserve({ mainRunning: 1, mainConcurrency: 1, ingressQueued: 1 })).toBe("warming")
    expect(deriveForegroundReserve({ mainRunning: 1, mainConcurrency: 1, ingressQueued: 0 })).toBe("saturated")
  })

  test("deriveForegroundNextAction prioritizes risk and swarm cues", () => {
    expect(
      deriveForegroundNextAction({
        pendingInboxCount: 0,
        steerPending: 0,
        ingressQueued: 0,
        ingressRunning: 0,
        mainRunning: 0,
        sessionStatusType: "idle",
        hasPendingAssistant: false,
        orchestratorRunning: 0,
        adversarialRunning: 1,
        workerRunning: 0,
        actionableUpdateCount: 0,
      }),
    ).toContain("adversarial review")

    expect(
      deriveForegroundNextAction({
        pendingInboxCount: 0,
        steerPending: 0,
        ingressQueued: 0,
        ingressRunning: 0,
        mainRunning: 0,
        sessionStatusType: "idle",
        hasPendingAssistant: false,
        orchestratorRunning: 1,
        adversarialRunning: 0,
        workerRunning: 2,
        actionableUpdateCount: 0,
      }),
    ).toContain("swarm results")
  })

  test("deriveOperatorDigest summarizes blocker, confidence, and submit mode", () => {
    const digest = deriveOperatorDigest({
      pendingInboxCount: 2,
      steerPending: 1,
      ingressQueued: 0,
      ingressRunning: 0,
      mainRunning: 1,
      sessionStatusType: "busy",
      hasPendingAssistant: true,
      orchestratorRunning: 0,
      adversarialRunning: 0,
      workerRunning: 0,
      actionableUpdateCount: 1,
      mainConcurrency: 1,
      pausedLaneCount: 1,
      retrying: false,
    })

    expect(digest.state).toBe("blocked")
    expect(digest.confidence).toBe("low")
    expect(digest.submitMode).toBe("steer")
    expect(digest.attentionCount).toBe(4)
    expect(digest.blocker).toContain("Resolve inbox")
    expect(digest.reasons.some((reason) => reason.includes("inbox"))).toBe(true)
  })

  test("deriveOperatorDigest stays calm when the foreground is clear", () => {
    const digest = deriveOperatorDigest({
      pendingInboxCount: 0,
      steerPending: 0,
      ingressQueued: 0,
      ingressRunning: 0,
      mainRunning: 0,
      sessionStatusType: "idle",
      hasPendingAssistant: false,
      orchestratorRunning: 0,
      adversarialRunning: 0,
      workerRunning: 0,
      actionableUpdateCount: 0,
      mainConcurrency: 1,
    })

    expect(digest.state).toBe("idle")
    expect(digest.confidence).toBe("high")
    expect(digest.submitMode).toBe("send")
    expect(digest.interruptability).toBe("idle")
  })

  test("deriveMissionHighlight compresses mission state into one line", () => {
    const summary = deriveMissionHighlight({
      latestUserIntent: "Keep the mission view concise but useful for the operator",
      todoCount: 3,
      childCount: 2,
      activeChildCount: 1,
      pendingSteer: 2,
    })

    expect(summary).toContain("todo 3")
    expect(summary).toContain("active child 1")
    expect(summary).toContain("steer 2")
  })

  test("deriveExecutionTimelineHint prefers supervisor updates over scheduler latest", () => {
    const hint = deriveExecutionTimelineHint({
      supervisorUpdate: {
        status: "completed",
        description: "Verified the mission digest rendering path",
        subagentType: "worker",
      },
      laneLatest: {
        lane: "main_turns",
        latest: {
          description: "Responding to the user",
          status: "running",
          priority: "normal",
        },
      },
    })

    expect(hint).toContain("timeline complete")
    expect(hint).toContain("Verified the mission digest")
  })

  test("deriveExecutionTimelineHint can summarize timeline events directly", () => {
    const hint = deriveExecutionTimelineHint({
      timelineEvent: {
        phase: "running",
        description: "Replaying the latest execution ledger slice",
        lane: "main_turns",
        source: "scheduler",
      },
    })

    expect(hint).toContain("timeline main running")
    expect(hint).toContain("Replaying the latest execution ledger slice")
  })

  test("deriveExecutionTimelineHint falls back to scheduler lane latest", () => {
    const hint = deriveExecutionTimelineHint({
      laneLatest: {
        lane: "orchestrator_swarm",
        latest: {
          description: "Synthesizing subagent results",
          status: "running",
          priority: "steer",
        },
      },
    })

    expect(hint).toContain("timeline orch running")
    expect(hint).toContain("Synthesizing subagent results")
  })

  test("deriveSessionChrome keeps child sessions interactive while hiding root-only chrome", () => {
    expect(
      deriveSessionChrome({
        isChildSession: true,
        sidebarMode: "auto",
        sidebarOpen: true,
        wide: true,
      }),
    ).toEqual({
      showSidebar: false,
      showControlPanels: false,
      showPendingInboxBanner: false,
      showPrompt: true,
      showFooter: true,
    })
  })

  test("deriveSessionChrome still shows full chrome for root sessions", () => {
    expect(
      deriveSessionChrome({
        isChildSession: false,
        sidebarMode: "auto",
        sidebarOpen: false,
        wide: true,
      }),
    ).toEqual({
      showSidebar: true,
      showControlPanels: true,
      showPendingInboxBanner: true,
      showPrompt: true,
      showFooter: true,
    })
  })

  test("deriveChildSessionLifecycle keeps completed children visible with fallback timing", () => {
    expect(
      deriveChildSessionLifecycle({
        sessionStatusType: "idle",
        launchStatus: "completed",
        hasPendingAssistant: false,
        hasCompletedAssistant: false,
        firstUserCreated: 1_000,
        sessionUpdatedAt: 1_650,
      }),
    ).toEqual({
      status: "completed",
      terminalAt: 1_650,
      durationMS: 650,
    })
  })

  test("deriveChildSessionLifecycle prefers active session state over stale launch metadata", () => {
    expect(
      deriveChildSessionLifecycle({
        sessionStatusType: "working",
        launchStatus: "completed",
        hasPendingAssistant: true,
        hasCompletedAssistant: false,
        firstUserCreated: 1_000,
        lastAssistantCompleted: undefined,
        sessionUpdatedAt: 1_200,
      }).status,
    ).toBe("running")
  })

  test("deriveChildSessionLifecycle cools stale non-idle children once live evidence is gone", () => {
    expect(
      deriveChildSessionLifecycle({
        sessionStatusType: "working",
        launchStatus: "started",
        hasPendingAssistant: false,
        hasCompletedAssistant: true,
        firstUserCreated: 1_000,
        lastAssistantCompleted: 1_800,
        sessionUpdatedAt: 2_000,
        now: 100_500,
      }),
    ).toEqual({
      status: "completed",
      terminalAt: 1_800,
      durationMS: 800,
    })
  })

  test("deriveSubagentAttention surfaces blocked and paused worker states", () => {
    expect(
      deriveSubagentAttention({
        lifecycleStatus: "running",
        latestLaneStatus: "blocked",
      }),
    ).toEqual({
      status: "running",
      attention: "blocked",
      active: true,
      needsAttention: true,
      displayStatus: "blocked",
    })

    expect(
      deriveSubagentAttention({
        lifecycleStatus: "queued",
        latestTimelineEvent: {
          phase: "queued",
          action: "pause",
          paused: true,
        },
      }),
    ).toEqual({
      status: "queued",
      attention: "paused",
      active: true,
      needsAttention: true,
      displayStatus: "paused",
    })
  })

  test("deriveSubagentAttention preserves normal lifecycle when no attention signal exists", () => {
    expect(
      deriveSubagentAttention({
        lifecycleStatus: "completed",
        latestTimelineEvent: {
          phase: "completed",
        },
      }),
    ).toEqual({
      status: "completed",
      attention: undefined,
      active: false,
      needsAttention: false,
      displayStatus: "completed",
    })
  })

  test("deriveSubagentPulseState maps lifecycle into bounded pulse states", () => {
    const now = 180_000
    expect(
      deriveSubagentPulseState({
        status: "queued",
        active: false,
        lastUpdate: now - 10_000,
        now,
      }),
    ).toBe("baton")

    expect(
      deriveSubagentPulseState({
        status: "running",
        active: true,
        lastUpdate: now - 1_000,
        now,
      }),
    ).toBe("convoy")

    expect(
      deriveSubagentPulseState({
        status: "complete",
        active: false,
        lastUpdate: now - 50_000,
        now,
      }),
    ).toBe("returning")

    expect(
      deriveSubagentPulseState({
        status: "complete",
        active: false,
        lastUpdate: now - 100_000,
        now,
      }),
    ).toBe("cooling")

    expect(
      deriveSubagentPulseState({
        status: "running",
        rawStatus: "retry",
        active: true,
        lastUpdate: now - 10_000,
        now,
      }),
    ).toBe("blocked")

    expect(
      deriveSubagentPulseState({
        status: "idle",
        active: false,
        lastUpdate: now - 10_000,
        now,
      }),
    ).toBe("cooling")
  })

  test("deriveSubagentLaneSignal emits compact lifecycle copy aligned to pulse state", () => {
    expect(
      deriveSubagentLaneSignal({
        status: "queued",
        active: false,
        lastUpdate: 1_000,
        now: 10_000,
        turns: 3,
      }).lifecycleLine,
    ).toContain("baton")

    const returning = deriveSubagentLaneSignal({
      status: "complete",
      active: false,
      lastUpdate: 175_000,
      now: 180_000,
      turns: 4,
    })
    expect(returning.pulseState).toBe("returning")
    expect(returning.lifecycleLine).toContain("folding back")

    const cooling = deriveSubagentLaneSignal({
      status: "complete",
      active: false,
      lastUpdate: 70_000,
      now: 180_000,
      turns: 8,
    })
    expect(cooling.pulseState).toBe("cooling")
    expect(cooling.lifecycleLine).toContain("cooled")

    expect(
      deriveSubagentLaneSignal({
        status: "running",
        rawStatus: "retry",
        active: true,
        lastUpdate: 10_000,
        now: 10_000,
        turns: 1,
      }).lifecycleLine,
    ).toContain("retry shield")
  })

  test("deriveCarrierNarrative centers operator gates when permissions are pending", () => {
    expect(
      deriveCarrierNarrative({
        rootStatus: "busy",
        activeChildCount: 1,
        childCount: 2,
        pendingPermissionCount: 2,
        contextPercent: 72,
      }),
    ).toEqual({
      carrierLabel: "carrier // operator gate",
      pressureLabel: "pressure // warm context envelope",
      constraintLabel: "2 permission gates holding the organism",
      nextMoveLabel: "next // clear approvals to release the live turn",
    })
  })

  test("deriveCarrierNarrative explains live swarm carriage and next move", () => {
    const narrative = deriveCarrierNarrative({
      rootStatus: "busy",
      activeChildCount: 2,
      childCount: 3,
      trackerBlockedCount: 1,
      mcpAttentionCount: 0,
      contextPercent: 51,
    })

    expect(narrative.carrierLabel).toBe("carrier // 2 live swarm lanes")
    expect(narrative.constraintLabel).toContain("blocked track")
    expect(narrative.nextMoveLabel).toContain("merge")
  })

  test("collapseAssistantTimeline keeps only the newest assistant child per user turn", () => {
    const messages: Array<{ id: string; role?: string; parentID?: string }> = [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant", parentID: "user-1" },
      { id: "assistant-2", role: "assistant", parentID: "user-1" },
      { id: "user-2", role: "user" },
      { id: "assistant-3", role: "assistant", parentID: "user-2" },
      { id: "assistant-4", role: "assistant", parentID: "user-1" },
    ]

    expect(collapseAssistantTimeline(messages)).toEqual([
      { id: "user-1", role: "user" },
      { id: "assistant-4", role: "assistant", parentID: "user-1" },
      { id: "user-2", role: "user" },
      { id: "assistant-3", role: "assistant", parentID: "user-2" },
    ])
  })

  test("collapseAssistantTimeline leaves non-assistant entries untouched", () => {
    const messages: Array<{ id: string; role?: string; parentID?: string }> = [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant", parentID: "user-1" },
      { id: "tool-user", role: "user" },
      { id: "assistant-no-parent", role: "assistant" },
    ]

    expect(collapseAssistantTimeline(messages)).toEqual(messages)
  })

  test("auto-returns from a stale completed child route once the root foreground is settled", () => {
    expect(
      shouldAutoReturnFromChildSession({
        childWasBusy: true,
        currentSessionID: "child",
        parentSessionID: "root",
        currentSessionStatus: "idle",
        foreground: {
          state: "idle",
          awaitingPromotion: false,
          latestSessionID: "root",
        },
      }),
    ).toBe(true)
  })

  test("does not auto-return while the child is still the latest active foreground session", () => {
    expect(
      shouldAutoReturnFromChildSession({
        childWasBusy: true,
        currentSessionID: "child",
        parentSessionID: "root",
        currentSessionStatus: "working",
        foreground: {
          state: "idle",
          awaitingPromotion: false,
          latestSessionID: "child",
        },
      }),
    ).toBe(false)
  })
})
