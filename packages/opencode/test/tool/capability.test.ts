import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { CapabilityRuntime } from "../../src/capability/runtime"
import { CapabilityTool } from "../../src/tool/capability"
import { MCP } from "../../src/mcp"
import { MessageID, SessionID } from "../../src/session/schema"

describe("tool.capability", () => {
  const sessionID = SessionID.make("session_tool_capability")

  afterEach(() => {
    CapabilityRuntime.reset(sessionID)
  })

  test("lists connected browser MCP clients and sample callable tool IDs", async () => {
    const statusSpy = spyOn(MCP, "status").mockResolvedValue({
      playwright: { status: "connected" } as any,
      "chrome-devtools": { status: "connected" } as any,
      searxng: { status: "connected" } as any,
    })
    const toolsSpy = spyOn(MCP, "tools").mockImplementation(async () => {
      return {
        playwright_browser_navigate: { client: "playwright", name: "playwright_browser_navigate" },
        playwright_browser_snapshot: { client: "playwright", name: "playwright_browser_snapshot" },
        "chrome-devtools_click": { client: "chrome-devtools", name: "chrome-devtools_click" },
      } as any
    })

    try {
      const tool = await CapabilityTool.init()
      const result = await tool.execute(
        {
          action: "list",
          scope: "session",
        },
        {
          sessionID,
          messageID: MessageID.make("message_tool_capability"),
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata() {},
          ask: async () => {},
        },
      )

      expect(result.output).toContain("connected clients: chrome-devtools, playwright, searxng")
      expect(result.output).toContain("MCP access mode:")
      expect(result.output).toContain("browser client targets: chrome-devtools, playwright")
      expect(result.output).toContain("playwright_browser_navigate")
      expect(result.output).toContain("chrome-devtools_click")
      expect((result.metadata as any).inspection.sampleMcpTools.playwright).toContain("playwright_browser_navigate")
      expect((result.metadata as any).inspection.sampleMcpTools["chrome-devtools"]).toContain("chrome-devtools_click")
    } finally {
      statusSpy.mockRestore()
      toolsSpy.mockRestore()
    }
  })

  test("enabling a browser MCP client attempts a real connection", async () => {
    const statusSpy = spyOn(MCP, "status")
      .mockResolvedValueOnce({
        playwright: { status: "disabled" } as any,
        "chrome-devtools": { status: "disabled" } as any,
      })
      .mockResolvedValueOnce({
        playwright: { status: "connected" } as any,
        "chrome-devtools": { status: "disabled" } as any,
      })
    const connectSpy = spyOn(MCP, "connect").mockResolvedValue(undefined as any)

    try {
      const tool = await CapabilityTool.init()
      const result = await tool.execute(
        {
          action: "enable",
          targets: ["playwright"],
          scope: "session",
        },
        {
          sessionID,
          messageID: MessageID.make("message_tool_capability_enable"),
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata() {},
          ask: async () => {},
        },
      )

      expect(connectSpy).toHaveBeenCalledWith("playwright")
      expect(result.output).toContain("MCP connection attempts:")
      expect(result.output).toContain("- playwright: connected")
      expect((result.metadata as any).connectionResults.playwright).toBe("connected")
    } finally {
      statusSpy.mockRestore()
      connectSpy.mockRestore()
    }
  })
})
