import { afterEach, describe, expect, test } from "bun:test"
import { CapabilityRuntime } from "../../src/capability/runtime"

describe("capability.runtime", () => {
  const sessionID = "session_capability_runtime" as any

  afterEach(() => {
    CapabilityRuntime.reset(sessionID)
  })

  test("turn-scoped enables apply only to the active turn", () => {
    CapabilityRuntime.enable(sessionID, ["search", "mcp", "jit"], {
      scope: "turn",
      turnID: "turn-a",
    })

    expect(CapabilityRuntime.isToolVisible(sessionID, "codesearch", false, "turn-a")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "codesearch", false, "turn-b")).toBe(false)
    expect(CapabilityRuntime.isMcpVisible(sessionID, "playwright", false, "turn-a")).toBe(true)
    expect(CapabilityRuntime.isMcpVisible(sessionID, "playwright", false, "turn-b")).toBe(false)
    expect(CapabilityRuntime.isContextEnabled(sessionID, "jit", false, "turn-a")).toBe(true)
    expect(CapabilityRuntime.isContextEnabled(sessionID, "jit", false, "turn-b")).toBe(false)

    CapabilityRuntime.resetTurn(sessionID, "turn-a")

    expect(CapabilityRuntime.isToolVisible(sessionID, "codesearch", false, "turn-a")).toBe(false)
    expect(CapabilityRuntime.isMcpVisible(sessionID, "playwright", false, "turn-a")).toBe(false)
    expect(CapabilityRuntime.isContextEnabled(sessionID, "jit", false, "turn-a")).toBe(false)
  })

  test("session-scoped enables persist across turns while turn overlays stay isolated", () => {
    CapabilityRuntime.enable(sessionID, ["files", "instructions"], {
      scope: "session",
    })
    CapabilityRuntime.enable(sessionID, ["search"], {
      scope: "turn",
      turnID: "turn-a",
    })

    expect(CapabilityRuntime.isToolVisible(sessionID, "read", false, "turn-a")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "read", false, "turn-b")).toBe(true)
    expect(CapabilityRuntime.isContextEnabled(sessionID, "instructions", false, "turn-a")).toBe(true)
    expect(CapabilityRuntime.isContextEnabled(sessionID, "instructions", false, "turn-b")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "websearch", false, "turn-a")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "codesearch", false, "turn-a")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "codesearch", false, "turn-b")).toBe(false)

    const merged = CapabilityRuntime.snapshot(sessionID, "turn-a")
    expect(merged.toolIDs).toContain("read")
    expect(merged.toolIDs).toContain("websearch")
    expect(merged.toolIDs).toContain("codesearch")
    expect(merged.contextIDs).toContain("instructions")
  })

  test("task, skill, and websearch are core-visible while heavier search and coordination extras stay hidden in the lean default shell", () => {
    expect(CapabilityRuntime.isToolVisible(sessionID, "capability")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "websearch")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "codesearch")).toBe(false)
    expect(CapabilityRuntime.isToolVisible(sessionID, "task")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "skill")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "tracker_create_task")).toBe(false)
  })

  test("browser MCP clients stay out of the default capability ceremony", () => {
    expect(CapabilityRuntime.isMcpVisible(sessionID, "playwright")).toBe(false)
    expect(CapabilityRuntime.isMcpVisible(sessionID, "chrome-devtools")).toBe(false)
    expect(CapabilityRuntime.snapshot(sessionID).knownMcpClientIDs).toEqual(["chrome-devtools", "playwright"])
    expect(CapabilityRuntime.snapshot(sessionID).coreMcpIDs).toEqual([])
    expect(CapabilityRuntime.snapshot(sessionID).mcpAccessMode).toBe("hidden")
    expect(CapabilityRuntime.snapshot(sessionID).visibleMcpClientIDs).toEqual([])
    CapabilityRuntime.enable(sessionID, ["mcp"], { scope: "session" })
    expect(CapabilityRuntime.isMcpVisible(sessionID, "playwright")).toBe(true)
    expect(CapabilityRuntime.isMcpVisible(sessionID, "chrome-devtools")).toBe(true)
    expect(CapabilityRuntime.visibleMcpClientIDs(sessionID)).toBeUndefined()
    expect(CapabilityRuntime.snapshot(sessionID).mcpAccessMode).toBe("all")
  })

  test("search family excludes synthesize_tool", () => {
    const families = CapabilityRuntime.families()
    expect(families.tools.search).toContain("websearch")
    expect(families.tools.search).toContain("codesearch")
    expect(families.tools.search).not.toContain("synthesize_tool")
  })

  test("coordination family exposes the richer blackboard mutation tools when enabled", () => {
    expect(CapabilityRuntime.isToolVisible(sessionID, "blackboard_append")).toBe(false)

    CapabilityRuntime.enable(sessionID, ["coordination"], { scope: "session" })

    expect(CapabilityRuntime.isToolVisible(sessionID, "blackboard_append")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "blackboard_increment")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "blackboard_compare_and_swap")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "blackboard_delete")).toBe(true)
    expect(CapabilityRuntime.isToolVisible(sessionID, "blackboard_clear")).toBe(true)
  })
})
