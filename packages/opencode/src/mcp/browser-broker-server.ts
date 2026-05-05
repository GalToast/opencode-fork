import { createServer, type Server, type Socket } from "node:net"
import path from "path"
import { randomUUID } from "crypto"
import { rm } from "fs/promises"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { ToolListChangedNotificationSchema, type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Config } from "@/config/config"
import { Installation } from "@/installation"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"
import {
  BrokerDisconnectInput,
  BrokerDisconnectOutput,
  BrokerEnsureInput,
  BrokerEnsureOutput,
  BrokerListToolsInput,
  BrokerListToolsOutput,
  BrokerMeta,
  type BrokerName,
  BrokerPingInput,
  BrokerPong,
  BrokerReq,
  type BrokerRes,
} from "./browser-broker-protocol"
import { augmentBrowserArgs, isBrowserMcp } from "./browser-shared"

function metaPath(dir: string) {
  return path.join(dir, ".opencode", "runtime", "browser-broker.json")
}

const log = Log.create({ service: "browser-broker" })
const DEFAULT_TIMEOUT = 30_000
const IDLE_MS = 30_000

type BrowserClient = {
  connect(): Promise<void>
  listTools(): Promise<{ tools: MCPToolDef[] }>
  close(): Promise<void>
  onToolsChanged?(fn: () => void): void
}

type Factory = (name: BrokerName, dir: string) => Promise<BrowserClient>

type Options = {
  directory: string
  host?: string
  port?: number
  factory?: Factory
  idle?: number
}

export class BrowserBrokerServer {
  readonly meta: BrokerMeta
  readonly server: Server
  readonly idle: number
  readonly state = new Map<
    BrokerName,
    {
      client?: BrowserClient
      tools?: MCPToolDef[]
      timer?: ReturnType<typeof setTimeout>
      load?: Promise<BrowserClient>
    }
  >()
  readonly factory: Factory

  private constructor(server: Server, meta: BrokerMeta, input: { factory: Factory; idle: number }) {
    this.server = server
    this.meta = meta
    this.factory = input.factory
    this.idle = input.idle
  }

  static path(dir: string) {
    return metaPath(dir)
  }

  static async start(input: Options) {
    const host = input.host ?? "127.0.0.1"
    const startedAt = Date.now()
    let meta = {
      version: 1 as const,
      host,
      port: 0,
      pid: process.pid,
      token: randomUUID() as string,
      directory: input.directory,
      startedAt,
      updatedAt: startedAt,
    }
    const server = createServer((sock) => {
      void onConn(sock, () => meta, async (next) => {
        meta = BrokerMeta.parse(next)
        await Filesystem.writeJson(metaPath(input.directory), meta)
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(input.port ?? 0, host, () => resolve())
    })
    const addr = server.address()
    if (!addr || typeof addr === "string") {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      throw new Error("Browser broker failed to bind to a loopback port")
    }
    meta = BrokerMeta.parse({
      ...meta,
      port: addr.port,
    })
    await Filesystem.writeJson(metaPath(input.directory), meta)
    const result = new BrowserBrokerServer(server, meta, {
      factory: input.factory ?? createClient,
      idle: input.idle ?? IDLE_MS,
    })
    servers.set(meta.token, result)
    return result
  }

  async stop() {
    servers.delete(this.meta.token)
    await Promise.all([...this.state.keys()].map((name) => this.disconnect(name)))
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
    const raw = await Filesystem.readJson<unknown>(metaPath(this.meta.directory)).catch(() => undefined)
    const parsed = BrokerMeta.safeParse(raw)
    if (parsed.success && parsed.data.token === this.meta.token) {
      await rm(metaPath(this.meta.directory), { force: true }).catch(() => undefined)
    }
  }

  async wait() {
    await new Promise<void>((resolve, reject) => {
      this.server.once("close", () => resolve())
      this.server.once("error", reject)
    })
  }

  private item(name: BrokerName) {
    let item = this.state.get(name)
    if (item) return item
    item = {}
    this.state.set(name, item)
    return item
  }

  private touch(name: BrokerName) {
    const item = this.item(name)
    if (item.timer) clearTimeout(item.timer)
    if (!item.client || this.idle <= 0) return
    item.timer = setTimeout(() => {
      void this.disconnect(name)
    }, this.idle)
    item.timer.unref?.()
  }

  async ensureConnected(name: BrokerName) {
    const item = this.item(name)
    if (item.client) {
      this.touch(name)
      return item.client
    }
    if (item.load) {
      const client = await item.load
      this.touch(name)
      return client
    }
    item.load = this.factory(name, this.meta.directory)
      .then(async (client) => {
        client.onToolsChanged?.(() => {
          const next = this.item(name)
          next.tools = undefined
        })
        await client.connect()
        item.client = client
        return client
      })
      .finally(() => {
        item.load = undefined
      })
    const client = await item.load
    this.touch(name)
    return client
  }

  async disconnect(name: BrokerName) {
    const item = this.item(name)
    if (item.timer) {
      clearTimeout(item.timer)
      item.timer = undefined
    }
    if (!item.client) return false
    const client = item.client
    item.client = undefined
    await client.close().catch((error) => {
      log.warn("failed to close broker client", { name, error })
    })
    return true
  }

  async listTools(name: BrokerName) {
    const item = this.item(name)
    if (item.tools?.length) {
      this.touch(name)
      return { tools: item.tools, cached: true, connected: !!item.client }
    }
    const client = await this.ensureConnected(name)
    const result = await client.listTools()
    item.tools = result.tools
    this.touch(name)
    return { tools: result.tools, cached: false, connected: true }
  }
}

async function onConn(sock: Socket, meta: () => BrokerMeta, update: (meta: BrokerMeta) => Promise<void>) {
  sock.setEncoding("utf8")
  let buf = ""
  sock.on("data", (chunk: string) => {
    buf += chunk
    const idx = buf.indexOf("\n")
    if (idx < 0) return
    const line = buf.slice(0, idx)
    buf = buf.slice(idx + 1)
    void onLine(sock, line, meta, update)
  })
}

async function onLine(
  sock: Socket,
  line: string,
  meta: () => BrokerMeta,
  update: (meta: BrokerMeta) => Promise<void>,
) {
  let raw: unknown
  try {
    raw = JSON.parse(line) as unknown
  } catch {
    write(sock, { ok: false, error: "Invalid broker request" })
    return
  }
  const req = BrokerReq.safeParse(raw)
  if (!req.success) {
    write(sock, { ok: false, error: "Invalid broker request" })
    return
  }
  const state = meta()
  if (req.data.token !== state.token) {
    write(sock, { ok: false, error: "Unauthorized broker request" })
    return
  }
  const next = BrokerMeta.parse({
    ...state,
    updatedAt: Date.now(),
  })
  await update(next)
  try {
    const server = servers.get(next.token)
    if (!server) throw new Error("Broker state not found")
    if (req.data.method === "ping") {
      BrokerPingInput.parse(req.data.input ?? {})
      write(sock, {
        ok: true,
        result: BrokerPong.parse({
          pid: process.pid,
          startedAt: next.startedAt,
          updatedAt: next.updatedAt,
          uptimeSec: Math.round(process.uptime() * 10) / 10,
        }),
      })
      return
    }
    if (req.data.method === "ensureConnected") {
      const input = BrokerEnsureInput.parse(req.data.input ?? {})
      await server.ensureConnected(input.name)
      write(sock, { ok: true, result: BrokerEnsureOutput.parse({ connected: true }) })
      return
    }
    if (req.data.method === "disconnect") {
      const input = BrokerDisconnectInput.parse(req.data.input ?? {})
      const disconnected = await server.disconnect(input.name)
      write(sock, { ok: true, result: BrokerDisconnectOutput.parse({ disconnected }) })
      return
    }
    if (req.data.method === "listTools") {
      const input = BrokerListToolsInput.parse(req.data.input ?? {})
      const result = await server.listTools(input.name)
      write(
        sock,
        {
          ok: true,
          result: BrokerListToolsOutput.parse(result),
        },
      )
      return
    }
    write(sock, { ok: false, error: `Unknown broker method: ${req.data.method}` })
  } catch (error) {
    write(sock, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

function write(sock: Socket, res: BrokerRes) {
  sock.end(JSON.stringify(res) + "\n")
}

const servers = new Map<string, BrowserBrokerServer>()

async function createClient(name: BrokerName, dir: string): Promise<BrowserClient> {
  return Instance.provide({
    directory: dir,
    fn: async () => {
      const cfg = await Config.get()
      const mcp = cfg.mcp?.[name]
      if (!isBrowserMcp(name, mcp)) {
        throw new Error(`Browser MCP ${name} is unavailable`)
      }
      const localMcp = mcp as Config.McpLocal
      const [cmd, ...args] = augmentBrowserArgs(name, localMcp.command)
      const rel = args.some((arg) => arg.startsWith("./") || arg.startsWith("../"))
      const cwd = rel ? path.join(Instance.directory, ".opencode") : Instance.directory
      const timeout = localMcp.timeout ?? cfg.experimental?.mcp_timeout ?? DEFAULT_TIMEOUT
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env: {
          ...process.env,
          ...(cmd === "opencode" ? { BUN_BE_BUN: "1" } : {}),
          ...localMcp.environment,
        },
      })
      const client = new Client({
        name: "opencode",
        version: Installation.VERSION,
      })
      transport.stderr?.on("data", (chunk: Buffer) => {
        log.info(`mcp stderr: ${chunk.toString()}`, { name })
      })
      return {
        connect: () => withTimeout(client.connect(transport), timeout),
        listTools: () => withTimeout(client.listTools(), timeout),
        close: () => client.close(),
        onToolsChanged: (fn) => client.setNotificationHandler(ToolListChangedNotificationSchema, fn),
      }
    },
  })
}
