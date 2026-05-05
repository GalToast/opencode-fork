import { describe, expect, mock, test } from "bun:test"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Instance } from "../../src/project/instance"
import { Vcs } from "../../src/project/vcs"
import { LSP } from "../../src/lsp"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Config } from "../../src/config/config"
import { MCP } from "../../src/mcp"

await Log.init({ print: false })

describe("InstanceBootstrap lazy services", () => {
  const originalGet = Config.get
  const originalConnect = MCP.connect
  const writableConfig = Config as { get: typeof Config.get }
  const writableMCP = MCP as { connect: typeof MCP.connect }

  const bootstrapTest = (name: string, fn: () => void | Promise<unknown>, timeout = 20_000) =>
    test(
      name,
      async () => {
        writableConfig.get = originalGet
        writableMCP.connect = originalConnect
        try {
          await fn()
        } finally {
          writableConfig.get = originalGet
          writableMCP.connect = originalConnect
        }
      },
      { timeout },
    )

  bootstrapTest("still resolves branch state on demand", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      async fn() {
        const branch = await Vcs.branch()
        expect(typeof branch).toBe("string")
        expect(branch && branch.length > 0).toBe(true)
      },
    })
  })

  bootstrapTest("still resolves lsp status on demand", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      async fn() {
        const status = await LSP.status()
        expect(Array.isArray(status)).toBe(true)
      },
    })
  })

  bootstrapTest("warms configured browser MCP servers in the background", async () => {
    await using tmp = await tmpdir({ git: true })
    const connectSpy = mock(async (_name: string) => {})

    writableConfig.get = mock(async () => ({
      mcp: {
        playwright: { type: "local", command: ["npx", "-y", "@playwright/mcp@latest"] },
        "chrome-devtools": { type: "local", command: ["npx", "-y", "chrome-devtools-mcp@latest"] },
        searxng: { type: "local", command: ["python", "-m", "searxng"] },
      },
    })) as typeof Config.get
    writableMCP.connect = connectSpy as typeof MCP.connect

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      async fn() {
        await Bun.sleep(0)
      },
    })

    expect(connectSpy.mock.calls.map((call) => call[0]).sort()).toEqual(["chrome-devtools", "playwright"])
  })
})
