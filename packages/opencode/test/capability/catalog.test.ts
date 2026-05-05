import { describe, expect, spyOn, test } from "bun:test"
import { ToolRegistry } from "../../src/tool/registry"
import { MCP } from "../../src/mcp"
import { Command } from "../../src/command"
const { CapabilityCatalog } = await import("../../src/capability")

describe("capability.catalog", () => {
  test("merges and sorts normalized capability descriptors", async () => {
    const toolSpy = spyOn(ToolRegistry, "catalog").mockResolvedValue([
      {
        id: "bash",
        kind: "tool",
        source: "builtin",
        title: "bash",
        hints: [],
      } as any,
    ])
    const mcpSpy = spyOn(MCP, "catalog").mockResolvedValue([
      {
        id: "demo:prompt",
        kind: "mcp_prompt",
        source: "mcp",
        title: "Prompt",
        client: "demo",
        hints: ["name"],
      } as any,
    ])
    const commandSpy = spyOn(Command, "catalog").mockResolvedValue([
      {
        id: "review",
        kind: "command",
        source: "command",
        title: "review",
        hints: [],
      } as any,
    ])

    try {
      const result = await CapabilityCatalog.list()
      expect(result.map((entry) => entry.id)).toEqual(["review", "demo:prompt", "bash"])
      expect(result[0]?.kind).toBe("command")
      expect(result[1]?.kind).toBe("mcp_prompt")
      expect(result[2]?.kind).toBe("tool")
    } finally {
      toolSpy.mockRestore()
      mcpSpy.mockRestore()
      commandSpy.mockRestore()
    }
  })
})
