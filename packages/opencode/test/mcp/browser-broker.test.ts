import { afterEach, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"

const stops: Array<() => Promise<void>> = []

afterEach(async () => {
  while (stops.length > 0) {
    const stop = stops.pop()
    if (!stop) continue
    await stop().catch(() => undefined)
  }
})

test("browser broker client pings a running broker from workspace metadata", async () => {
  await using tmp = await tmpdir()
  const { BrowserBrokerServer } = await import("../../src/mcp/browser-broker-server")
  const { BrowserBroker } = await import("../../src/mcp/browser-broker")

  const server = await BrowserBrokerServer.start({
    directory: tmp.path,
  })
  stops.push(() => server.stop())

  const meta = await BrowserBroker.read(tmp.path)
  expect(meta?.port).toBe(server.meta.port)

  const ensured = await BrowserBroker.ensure({
    directory: tmp.path,
  })
  const pong = await ensured.client.ping()
  expect(ensured.spawned).toBe(false)
  expect(pong.pid).toBe(process.pid)
  expect(pong.startedAt).toBe(server.meta.startedAt)
})

test("browser broker ensure reuses a live broker without respawning", async () => {
  await using tmp = await tmpdir()
  const { BrowserBrokerServer } = await import("../../src/mcp/browser-broker-server")
  const { BrowserBroker } = await import("../../src/mcp/browser-broker")

  const server = await BrowserBrokerServer.start({
    directory: tmp.path,
  })
  stops.push(() => server.stop())

  let calls = 0
  const ensured = await BrowserBroker.ensure({
    directory: tmp.path,
    spawn: async () => {
      calls += 1
    },
  })

  expect(calls).toBe(0)
  expect(ensured.spawned).toBe(false)
  expect((await ensured.client.ping()).pid).toBe(process.pid)
})

test("browser broker ensure replaces stale metadata by spawning a new broker", async () => {
  await using tmp = await tmpdir()
  const { BrowserBrokerServer } = await import("../../src/mcp/browser-broker-server")
  const { BrowserBroker } = await import("../../src/mcp/browser-broker")
  const { Filesystem } = await import("../../src/util/filesystem")

  await Filesystem.writeJson(BrowserBroker.file(tmp.path), {
    version: 1,
    host: "127.0.0.1",
    port: 65534,
    pid: 999999,
    token: "stale-token",
    directory: tmp.path,
    startedAt: 1,
    updatedAt: 1,
  })

  let calls = 0
  let server: Awaited<ReturnType<typeof BrowserBrokerServer.start>> | undefined
  const ensured = await BrowserBroker.ensure({
    directory: tmp.path,
    timeout: 2_000,
    spawn: async () => {
      calls += 1
      server = await BrowserBrokerServer.start({
        directory: tmp.path,
      })
      stops.push(() => server!.stop())
    },
  })

  expect(calls).toBe(1)
  expect(ensured.spawned).toBe(true)
  expect((await ensured.client.ping()).pid).toBe(process.pid)
  expect((await BrowserBroker.read(tmp.path))?.token).toBe(server?.meta.token)
})

test("two simulated runtimes share one broker-owned browser helper for listTools", async () => {
  await using tmp = await tmpdir()
  const { BrowserBrokerServer } = await import("../../src/mcp/browser-broker-server")
  const { BrowserBroker } = await import("../../src/mcp/browser-broker")

  let starts = 0
  let closes = 0
  const defs = [
    {
      name: "browser_navigate",
      description: "Navigate",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
        },
      },
    },
  ]

  const server = await BrowserBrokerServer.start({
    directory: tmp.path,
    factory: async () => {
      starts += 1
      return {
        async connect() {},
        async listTools() {
          return { tools: defs as any }
        },
        async close() {
          closes += 1
        },
      }
    },
  })
  stops.push(() => server.stop())

  const a = await BrowserBroker.ensure({ directory: tmp.path })
  const b = await BrowserBroker.ensure({ directory: tmp.path })

  expect((await a.client.ensureConnected("playwright")).connected).toBe(true)
  expect((await a.client.listTools("playwright")).tools.map((item) => item.name)).toEqual(["browser_navigate"])
  const second = await b.client.listTools("playwright")

  expect(starts).toBe(1)
  expect(second.cached).toBe(true)
  expect(second.connected).toBe(true)

  await b.client.disconnect("playwright")
  expect(closes).toBe(1)
})
