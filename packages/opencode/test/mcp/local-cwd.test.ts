import { beforeEach, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const stdioCalls: Array<{
  command: string
  args?: string[]
  cwd?: string
}> = []

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdioClientTransport {
    stderr = {
      on() {},
    }

    constructor(options: { command: string; args?: string[]; cwd?: string }) {
      stdioCalls.push(options)
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    transport: unknown

    constructor(_info?: unknown) {}

    async connect(transport: unknown) {
      this.transport = transport
    }

    async listTools() {
      return { tools: [] }
    }

    setNotificationHandler() {}

    async close() {}
  },
}))

const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

beforeEach(() => {
  stdioCalls.length = 0
})

test("local MCP prefers the config directory when command arguments reference relative files", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const configDir = path.join(dir, ".opencode")
      await fs.mkdir(path.join(configDir, "servers"), { recursive: true })
      await Bun.write(path.join(configDir, "servers", "test-mcp.js"), "console.log('test')")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("local-test", {
        type: "local",
        command: ["node", "./servers/test-mcp.js"],
      })

      const call = stdioCalls.find((item) => item.args?.includes("./servers/test-mcp.js"))
      expect(call).toBeDefined()
      expect(call?.command).toBe("node")
      expect(call?.cwd).toBe(path.join(tmp.path, ".opencode"))
    },
  })
})

test("chrome-devtools MCP receives the harness browser URL when available", async () => {
  const previousBrowserUrl = process.env.OPENCODE_CHROME_DEVTOOLS_URL
  process.env.OPENCODE_CHROME_DEVTOOLS_URL = "http://127.0.0.1:9222"

  try {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.add("chrome-devtools", {
          type: "local",
          command: ["npx", "-y", "chrome-devtools-mcp@latest"],
        })

        const call = stdioCalls.find((item) => item.command === "npx")
        expect(call).toBeDefined()
        expect(call?.args).toContain("--browser-url=http://127.0.0.1:9222")
      },
    })
  } finally {
    if (previousBrowserUrl === undefined) delete process.env.OPENCODE_CHROME_DEVTOOLS_URL
    else process.env.OPENCODE_CHROME_DEVTOOLS_URL = previousBrowserUrl
  }
})
