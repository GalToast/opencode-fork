import { describe, expect, it } from "bun:test"
import {
  deriveShellSurfaceNarrative,
  deriveRecentShellEvent,
  deriveShellPosture,
  deriveShellCeremonyCue,
  resolveRootSessionID,
  resolveRootSessionMessageScope,
  resolveSessionMessageScope,
} from "../../src/cli/cmd/tui/routes/session/shell-signal"

describe("shell signal utility", () => {
  it("prefers accepted baton when promotion is waiting", () => {
    const event = deriveRecentShellEvent({
      messages: [],
      partsByMessage: {},
      awaitingPromotion: true,
    })
    expect(event).toBe("accepted_baton")
  })

  it("demotes accepted baton once the current assistant is clearly active", () => {
    const event = deriveRecentShellEvent({
      messages: [
        {
          id: "m1",
          role: "assistant",
        },
      ],
      partsByMessage: {
        m1: [{ type: "reasoning", text: "Working through the next step" }],
      },
      awaitingPromotion: true,
    })
    expect(event).toBeUndefined()
  })

  it("detects wait preemption from an aborted task-only assistant turn", () => {
    const event = deriveRecentShellEvent({
      messages: [
        {
          id: "m1",
          role: "assistant",
          error: { name: "MessageAbortedError" },
        },
      ],
      partsByMessage: {
        m1: [{ type: "tool", tool: "task" }],
      },
    })
    expect(event).toBe("interrupt")
  })

  it("detects compaction handoff from recent message parts", () => {
    const event = deriveRecentShellEvent({
      messages: [
        {
          id: "m1",
          role: "assistant",
        },
      ],
      partsByMessage: {
        m1: [{ type: "compaction" }],
      },
    })
    expect(event).toBe("compaction_handoff")
  })

  it("detects subagent returns from completed assistant task turns", () => {
    const event = deriveRecentShellEvent({
      messages: [
        {
          id: "m1",
          role: "assistant",
          finish: "stop",
        },
      ],
      partsByMessage: {
        m1: [{ type: "tool", tool: "task" }],
      },
    })
    expect(event).toBe("subagent_return")
  })

  it("falls back to recovery for error session state without fresher events", () => {
    const event = deriveRecentShellEvent({
      messages: [],
      partsByMessage: {},
      sessionState: "error",
    })
    expect(event).toBe("recovery")
  })

  it("classifies editing posture from write tool loops", () => {
    const posture = deriveShellPosture({
      messages: [
        {
          id: "m1",
          role: "assistant",
        },
      ],
      partsByMessage: {
        m1: [{ type: "tool", tool: "write_file", state: { status: "running" } }],
      },
    })

    expect(posture).toBe("editing")
  })

  it("classifies searching posture from read/search tool loops", () => {
    const posture = deriveShellPosture({
      messages: [
        {
          id: "m1",
          role: "assistant",
        },
      ],
      partsByMessage: {
        m1: [{ type: "tool", tool: "grep", state: { status: "running" } }],
      },
    })

    expect(posture).toBe("searching")
  })

  it("classifies external pressure as blocked posture", () => {
    const posture = deriveShellPosture({
      messages: [
        {
          id: "m1",
          role: "assistant",
        },
      ],
      partsByMessage: {},
      pendingSupervisorCount: 2,
    })

    expect(posture).toBe("blocked")
  })

  it("downgrades to blocked under root-scope intervention pressure", () => {
    const posture = deriveShellPosture({
      messages: [
        {
          id: "m1",
          role: "assistant",
        },
      ],
      partsByMessage: {},
      pendingPermissionCount: 1,
      pendingQuestionCount: 1,
    })

    expect(posture).toBe("blocked")
  })

  it("derives plainspoken foreground truth for operator gates", () => {
    const surface = deriveShellSurfaceNarrative({
      posture: "blocked",
      pendingPermissionCount: 1,
      pressure: "warm",
    })

    expect(surface.primaryLabel).toBe("awaiting permission")
    expect(surface.secondaryLabel).toContain("permission gate")
    expect(surface.actor).toBe("operator")
  })

  it("derives swarm-centered foreground truth for active worker lanes", () => {
    const surface = deriveShellSurfaceNarrative({
      activeChildCount: 2,
      childCount: 3,
      pressure: "cool",
    })

    expect(surface.primaryLabel).toBe("swarm convoy")
    expect(surface.secondaryLabel).toContain("2 live lanes")
    expect(surface.actor).toBe("swarm")
  })

  it("keeps child-lane orchestration narration local to the visible lane", () => {
    const surface = deriveShellSurfaceNarrative({
      posture: "orchestrating",
      childCount: 2,
      activeChildCount: 1,
      isChildSession: true,
    })

    expect(surface.scope).toBe("child")
    expect(surface.secondaryLabel).toContain("this lane")
    expect(surface.secondaryLabel).not.toContain("root")
  })

  it("keeps child-lane permission narration local to the visible lane", () => {
    const surface = deriveShellSurfaceNarrative({
      pendingPermissionCount: 2,
      isChildSession: true,
    })

    expect(surface.scope).toBe("child")
    expect(surface.secondaryLabel).toContain("this lane")
    expect(surface.secondaryLabel).not.toContain("root")
  })

  it("detects a first uplink ceremony beat", () => {
    const cue = deriveShellCeremonyCue({
      messages: [
        {
          id: "m1",
          role: "user",
        },
      ],
      partsByMessage: {},
      event: "accepted_baton",
    })

    expect(cue?.label).toBe("UPLK")
    expect(cue?.tone).toBe("primary")
  })

  it("detects a first convoy ceremony beat when tool convoy is live", () => {
    const cue = deriveShellCeremonyCue({
      messages: [
        {
          id: "m1",
          role: "user",
        },
        {
          id: "m2",
          role: "assistant",
        },
      ],
      partsByMessage: {
        m2: [{ type: "tool", tool: "task", state: { status: "running" } }],
      },
      event: "accepted_baton",
    })

    expect(cue?.label).toBe("CNV")
    expect(cue?.tone).toBe("accent")
  })

  it("detects a first return ceremony beat", () => {
    const cue = deriveShellCeremonyCue({
      messages: [
        {
          id: "m1",
          role: "assistant",
          finish: "stop",
        },
      ],
      partsByMessage: {
        m1: [{ type: "tool", tool: "task" }],
      },
      event: "subagent_return",
    })

    expect(cue?.label).toBe("RTN")
    expect(cue?.tone).toBe("success")
  })

  it("detects a first signal when completion text lands quietly", () => {
    const cue = deriveShellCeremonyCue({
      messages: [
        {
          id: "m1",
          role: "user",
        },
        {
          id: "m2",
          role: "assistant",
          time: { completed: 111 },
        },
      ],
      partsByMessage: {
        m2: [{ type: "text", text: "hello there" }],
      },
    })

    expect(cue?.label).toBe("SIG")
    expect(cue?.tone).toBe("secondary")
  })

  it("shows idle posture in a completed root transcript", () => {
    const posture = deriveShellPosture({
      messages: [
        {
          id: "m1",
          role: "assistant",
          finish: "stop",
        },
      ],
      partsByMessage: {
        m1: [{ type: "text", text: "Done", }],
      },
    })

    expect(posture).toBe("responding")
  })

  it("resolves root session id for nested sessions", () => {
    const root = resolveRootSessionID(
      [
        { id: "root" },
        { id: "child", parentID: "root" },
        { id: "grandchild", parentID: "child" },
      ],
      "grandchild",
    )

    expect(root).toBe("root")
  })

  it("scopes shell messages to the root session transcript family", () => {
    const scope = resolveRootSessionMessageScope({
      sessions: [
        { id: "root" },
        { id: "child", parentID: "root" },
      ],
      messagesBySession: {
        root: [{ id: "m-root", role: "assistant", time: { created: 10 } }],
        child: [{ id: "m-child", role: "assistant", time: { created: 20 } }],
      },
      sessionID: "child",
    })

    expect(scope.rootSessionID).toBe("root")
    expect(scope.familySessionIDs).toEqual(["root", "child"])
    expect(scope.messages).toEqual([
      { id: "m-root", role: "assistant", time: { created: 10 } },
      { id: "m-child", role: "assistant", time: { created: 20 } },
    ])
  })

  it("scopes shell messages to only the current lane", () => {
    const scope = resolveSessionMessageScope({
      messagesBySession: {
        root: [{ id: "m-root", role: "assistant", time: { created: 10 } }],
        child: [{ id: "m-child", role: "assistant", time: { created: 20 } }],
        sibling: [{ id: "m-sibling", role: "assistant", time: { created: 30 } }],
      },
      sessionID: "child",
    })

    expect(scope.sessionID).toBe("child")
    expect(scope.messages).toEqual([{ id: "m-child", role: "assistant", time: { created: 20 } }])
  })

  it("returns an empty scope when the session hierarchy cannot be resolved", () => {
    const scope = resolveRootSessionMessageScope({
      sessions: [{ id: "root" }],
      messagesBySession: {
        root: [{ id: "m-root", role: "assistant" }],
      },
      sessionID: "missing",
    })

    expect(scope.rootSessionID).toBeUndefined()
    expect(scope.familySessionIDs).toEqual([])
    expect(scope.messages).toEqual([])
  })

  it("returns an empty local scope when the lane is missing", () => {
    const scope = resolveSessionMessageScope({
      messagesBySession: { root: [{ id: "m-root", role: "assistant", time: { created: 10 } }] },
      sessionID: "missing",
    })

    expect(scope.sessionID).toBe("missing")
    expect(scope.messages).toEqual([])
  })
})
