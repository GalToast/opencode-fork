import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { ToolRegistry } from "../../src/tool/registry"
import { SynthesizeTool } from "../../src/tool/synthesize"
import { tmpdir } from "../fixture/fixture"
import fs from "fs/promises"
import path from "path"

describe("Ephemeral Tool Synthesis", () => {
  test("synthesize_tool creates ephemeral TypeScript file", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const mockCtx = {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          callID: "test-call",
          agent: "test-agent",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const tool = await SynthesizeTool.init()
        
        const result = await tool.execute(
          {
            name: "parse_csv",
            description: "Parse a CSV file and return structured data",
            code: `
import { type ToolDefinition } from "@opencode-ai/plugin";
import z from "zod";

export default {
  description: "Parse a CSV file",
  args: {
    input: z.string()
  },
  async execute(args, ctx) {
    return "parsed: " + args.input;
  }
} satisfies ToolDefinition;
`,
          },
          mockCtx
        )

        expect(result.title).toContain("Synthesized Tool: parse_csv")
        expect(result.metadata.filePath).toContain("ephemeral_parse_csv_")
        expect(result.metadata.name).toBe("parse_csv")
        expect(result.metadata.filePath.startsWith(path.join(Instance.worktree, ".opencode", "tools"))).toBe(true)

        // Verify file was created
        const fileExists = await fs.access(result.metadata.filePath).then(() => true).catch(() => false)
        expect(fileExists).toBe(true)

        // Verify file content
        const content = await fs.readFile(result.metadata.filePath, "utf-8")
        expect(content).toContain("ToolDefinition")
        expect(content).toContain("Parse a CSV file")

        console.log("✓ Ephemeral tool file created:", result.metadata.filePath)
      },
    })
  })

  test("sanitize tool name to snake_case", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const mockCtx = {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          callID: "test-call",
          agent: "test-agent",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const tool = await SynthesizeTool.init()
        
        // Test with invalid characters
        const result = await tool.execute(
          {
            name: "My-Cool Tool!@#",
            description: "Test tool with invalid name",
            code: `export default { description: "test", args: {}, async execute() { return "test"; } }`,
          },
          mockCtx
        )

        expect(result.metadata.name).toBe("mycooltool")
        expect(result.metadata.filePath).toContain("ephemeral_mycooltool_")

        console.log("✓ Tool name sanitized: 'My-Cool Tool!@#' → 'mycooltool'")
      },
    })
  })

  test("ephemeral directory created if not exists", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const mockCtx = {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          callID: "test-call",
          agent: "test-agent",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        // Verify .opencode/tools doesn't exist yet
        const toolsDir = path.join(tmp.path, ".opencode", "tools")
        const existsBefore = await fs.access(toolsDir).then(() => true).catch(() => false)
        expect(existsBefore).toBe(false)

        const tool = await SynthesizeTool.init()
        
        const result = await tool.execute(
          {
            name: "test_tool",
            description: "Test tool",
            code: `export default { description: "test", args: {}, async execute() { return "test"; } }`,
          },
          mockCtx
        )

        // Verify directory was created
        const existsAfter = await fs.access(toolsDir).then(() => true).catch(() => false)
        expect(existsAfter).toBe(true)

        console.log("✓ Ephemeral directory created on demand")
      },
    })
  })

  test("synthesized tools are discoverable through the agent tool registry", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const mockCtx = {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          callID: "test-call",
          agent: "test-agent",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const synthesize = await SynthesizeTool.init()
        await synthesize.execute(
          {
            name: "parse_csv",
            description: "Parse a CSV file and return structured data",
            code: `export default { description: "Parse a CSV file", args: {}, async execute() { return "ok"; } }`,
          },
          mockCtx,
        )

        const agent = await Agent.get("build")
        if (!agent) throw new Error("expected build agent")

        const tools = await ToolRegistry.tools(
          { providerID: "openai" as any, modelID: "gpt-5.2" as any },
          agent,
          // @ts-ignore
          "need a custom parser",
          { include: () => true },
        )

        expect(tools.some((tool) => tool.id.includes("parse_csv"))).toBe(true)
      },
    })
  })
})
