import { expect, mock, test } from "bun:test"

const mcpLists = {
  tools: [
    {
      name: "search docs",
      description: "Search docs",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string" },
        },
      },
    },
  ],
  prompts: [
    {
      name: "draft email",
      description: "Draft an email",
      arguments: [{ name: "recipient", required: true }],
    },
  ],
  resources: [
    {
      name: "API Guide",
      description: "Reference guide",
      uri: "file:///guide.md",
      mimeType: "text/markdown",
    },
  ],
}

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    transport: unknown
    constructor(_info: unknown) {}
    async connect(transport: unknown) {
      this.transport = transport
    }
    async close() {}
    setNotificationHandler() {}
    async listTools() {
      return { tools: mcpLists.tools }
    }
    async listPrompts() {
      return { prompts: mcpLists.prompts }
    }
    async listResources() {
      return { resources: mcpLists.resources }
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    constructor(_url: URL, _options?: unknown) {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(_url: URL, _options?: unknown) {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdio {
    stderr = undefined
    constructor(_options: unknown) {}
  },
}))

const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

const mcpCatalogTest = (name: string, fn: () => void | Promise<unknown>, timeout = 20_000) => test(name, fn, { timeout })

mcpCatalogTest("catalog normalizes MCP tools, prompts, and resources", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("demo server", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const catalog = await MCP.catalog()
      expect(catalog.map((entry) => entry.kind).sort()).toEqual(["mcp_prompt", "mcp_resource", "mcp_tool"])

      const tool = catalog.find((entry) => entry.kind === "mcp_tool")
      const prompt = catalog.find((entry) => entry.kind === "mcp_prompt")
      const resource = catalog.find((entry) => entry.kind === "mcp_resource")

      expect(tool?.id).toBe("demo_server_search_docs")
      expect(tool?.title).toBe("search docs")
      expect(prompt?.id).toBe("demo_server:draft_email")
      expect(prompt?.hints).toEqual(["recipient"])
      // @ts-ignore
      expect(resource?.uri).toBe("file:///guide.md")
      // @ts-ignore
      expect(resource?.metadata?.mimeType).toBe("text/markdown")
    },
  })
})

mcpCatalogTest("connected MCP clients expose tools and connected status", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const added = await MCP.add("demo server", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      expect((added.status as Record<string, unknown>)["demo server"]).toEqual({ status: "connected" })

      const tools = await MCP.tools()
      expect(Object.keys(tools)).toContain("demo_server_search_docs")
    },
  })
})
