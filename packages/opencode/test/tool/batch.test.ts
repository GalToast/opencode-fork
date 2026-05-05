import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { BatchTool } from "../../src/tool/batch"
import { ToolRegistry } from "../../src/tool/registry"
import { Session } from "../../src/session"
import type { Tool } from "../../src/tool/tool"

const ctx = {
  sessionID: "test-batch" as any,
  messageID: "message-batch" as any,
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

function initializedTool(
  id: string,
  execute: Tool.Info["init"] extends (...args: any[]) => infer T ? any : never,
) {
  return {
    id,
    description: `${id} description`,
    parameters: {
      parse(input: unknown) {
        return input
      },
    },
    execute,
  }
}

describe("tool.batch", () => {
  afterEach(() => {
    mock.restore()
  })

  test("executes independent tools and reports partial failures", async () => {
    const updatePart = spyOn(Session, "updatePart").mockImplementation(() => undefined as any)
    spyOn(ToolRegistry, "tools").mockResolvedValue([
      initializedTool("read", async () => ({
        title: "Read complete",
        output: "file contents",
        metadata: { lines: 3 },
      })),
      initializedTool("grep", async () => {
        throw new Error("ripgrep unavailable")
      }),
    ] as any)

    const tool = await BatchTool.init()
    const result = await tool.execute(
      {
        tool_calls: [
          { tool: "read", parameters: { filePath: "src/index.ts" } },
          { tool: "grep", parameters: { pattern: "Session.updatePart" } },
        ],
      },
      ctx,
    )

    expect(result.title).toBe("Batch execution (1/2 successful)")
    expect(result.output).toContain("Executed 1/2 tools successfully. 1 failed.")
    expect(result.metadata).toMatchObject({
      totalCalls: 2,
      successful: 1,
      failed: 1,
      tools: ["read", "grep"],
      details: [
        { tool: "read", success: true },
        { tool: "grep", success: false },
      ],
    })
    expect(updatePart).toHaveBeenCalled()
  })

  test("rejects nested batch calls with a focused error entry", async () => {
    const updatePart = spyOn(Session, "updatePart").mockImplementation(() => undefined as any)
    spyOn(ToolRegistry, "tools").mockResolvedValue([
      initializedTool("read", async () => ({
        title: "Read complete",
        output: "file contents",
        metadata: {},
      })),
    ] as any)

    const tool = await BatchTool.init()
    const result = await tool.execute(
      {
        tool_calls: [
          { tool: "batch", parameters: { tool_calls: [] } },
        ],
      },
      ctx,
    )

    expect(result.title).toBe("Batch execution (0/1 successful)")
    expect(result.output).toContain("Executed 0/1 tools successfully. 1 failed.")
    expect(result.metadata).toMatchObject({
      totalCalls: 1,
      successful: 0,
      failed: 1,
      details: [{ tool: "batch", success: false }],
    })
    expect(updatePart).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "batch",
        state: expect.objectContaining({
          status: "error",
          error: expect.stringContaining("not allowed in batch"),
        }),
      }),
    )
  })

  test("rejects multiple mutation tools in one batch", async () => {
    const updatePart = spyOn(Session, "updatePart").mockImplementation(() => undefined as any)
    const tools = spyOn(ToolRegistry, "tools")

    const tool = await BatchTool.init()
    const result = await tool.execute(
      {
        tool_calls: [
          { tool: "write", parameters: { filePath: "src/a.ts", content: "a" } },
          { tool: "edit", parameters: { filePath: "src/b.ts", oldString: "x", newString: "y" } },
        ],
      },
      ctx,
    )

    expect(result.title).toBe("Batch execution (0/2 successful)")
    expect(result.metadata).toMatchObject({
      totalCalls: 2,
      successful: 0,
      failed: 2,
    })
    expect(updatePart).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "write",
        state: expect.objectContaining({
          status: "error",
          error: expect.stringContaining("multiple mutation tools"),
        }),
      }),
    )
    expect(updatePart).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "edit",
        state: expect.objectContaining({
          status: "error",
          error: expect.stringContaining("multiple mutation tools"),
        }),
      }),
    )
    expect(tools).not.toHaveBeenCalled()
  })

  test("rejects same-target inspect and mutate batches", async () => {
    const updatePart = spyOn(Session, "updatePart").mockImplementation(() => undefined as any)
    const tools = spyOn(ToolRegistry, "tools")

    const tool = await BatchTool.init()
    const result = await tool.execute(
      {
        tool_calls: [
          { tool: "edit", parameters: { filePath: "src/app.ts", oldString: "a", newString: "b" } },
          { tool: "read", parameters: { filePath: "src/app.ts" } },
        ],
      },
      ctx,
    )

    expect(result.title).toBe("Batch execution (0/2 successful)")
    expect(result.metadata).toMatchObject({
      totalCalls: 2,
      successful: 0,
      failed: 2,
    })
    expect(updatePart).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "edit",
        state: expect.objectContaining({
          status: "error",
          error: expect.stringContaining("target the same resource"),
        }),
      }),
    )
    expect(updatePart).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "read",
        state: expect.objectContaining({
          status: "error",
          error: expect.stringContaining("target the same resource"),
        }),
      }),
    )
    expect(tools).not.toHaveBeenCalled()
  })
})
