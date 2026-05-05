import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { LSPClient } from "./client"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { LSPServer } from "./server"
import z from "zod"
import { Config } from "../config/config"
import { spawn } from "child_process"
import { Instance } from "../project/instance"
import { Flag } from "@/flag/flag"
import {
  SymbolKind,
} from "vscode-languageserver-types"
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  SymbolInformation,
} from "vscode-languageserver-types"

// eslint-disable-next-line @typescript-eslint/no-namespace -- legacy API is used across many imports in this repo
export namespace LSP {
  const log = Log.create({ service: "lsp" })

  export const Event = {
    Updated: BusEvent.define("lsp.updated", z.object({})),
  }

  export const Range = z
    .object({
      start: z.object({
        line: z.number(),
        character: z.number(),
      }),
      end: z.object({
        line: z.number(),
        character: z.number(),
      }),
    })
    .meta({
      ref: "Range",
    })
  export type Range = z.infer<typeof Range>

  export const Symbol = z
    .object({
      name: z.string(),
      kind: z.number(),
      location: z.object({
        uri: z.string(),
        range: Range,
      }),
    })
    .meta({
      ref: "Symbol",
    })
  export type Symbol = z.infer<typeof Symbol>

  export const DocumentSymbol = z
    .object({
      name: z.string(),
      detail: z.string().optional(),
      kind: z.number(),
      range: Range,
      selectionRange: Range,
    })
    .meta({
      ref: "DocumentSymbol",
    })
  export type DocumentSymbol = z.infer<typeof DocumentSymbol>

  const filterExperimentalServers = (servers: Record<string, LSPServer.Info>) => {
    if (Flag.OPENCODE_EXPERIMENTAL_LSP_TY) {
      // If experimental flag is enabled, disable pyright
      if (servers["pyright"]) {
        log.info("LSP server pyright is disabled because OPENCODE_EXPERIMENTAL_LSP_TY is enabled")
        delete servers["pyright"]
      }
    } else {
      // If experimental flag is disabled, disable ty
      if (servers["ty"]) {
        delete servers["ty"]
      }
    }
  }

  const state = Instance.state(
    async () => {
      const clients: LSPClient.Info[] = []
      const servers: Record<string, LSPServer.Info> = {}
      const cfg = await Config.get()

      if (cfg.lsp === false) {
        log.info("all LSPs are disabled")
        return {
          broken: new Set<string>(),
          servers,
          clients,
          spawning: new Map<string, Promise<LSPClient.Info | undefined>>(),
        }
      }

      for (const server of Object.values(LSPServer)) {
        servers[server.id] = server
      }

      filterExperimentalServers(servers)

      for (const [name, item] of Object.entries(cfg.lsp ?? {})) {
        const existing = servers[name]
        if (item.disabled) {
          log.info(`LSP server ${name} is disabled`)
          delete servers[name]
          continue
        }
        servers[name] = {
          ...existing,
          id: name,
          root: existing?.root ?? (() => Promise.resolve(Instance.directory)),
          extensions: item.extensions ?? existing?.extensions ?? [],
          spawn: (root) => ({
            process: spawn(item.command[0], item.command.slice(1), {
              cwd: root,
              env: {
                ...process.env,
                ...item.env,
              },
            }),
            initialization: item.initialization,
          }),
        }
      }

      log.info("enabled LSP servers", {
        serverIds: Object.values(servers)
          .map((server) => server.id)
          .join(", "),
      })

      return {
        broken: new Set<string>(),
        servers,
        clients,
        spawning: new Map<string, Promise<LSPClient.Info | undefined>>(),
      }
    },
    (entry) => {
      for (const client of entry.clients) {
        void client.shutdown()
      }
    },
  )

  export async function init() {
    return state()
  }

  export const Status = z
    .object({
      id: z.string(),
      name: z.string(),
      root: z.string(),
      status: z.union([z.literal("connected"), z.literal("error")]),
    })
    .meta({
      ref: "LSPStatus",
    })
  export type Status = z.infer<typeof Status>

  export async function status() {
    return state().then((x) => {
      const result: Status[] = []
      for (const client of x.clients) {
        result.push({
          id: client.serverID,
          name: x.servers[client.serverID].id,
          root: path.relative(Instance.directory, client.root),
          status: "connected",
        })
      }
      return result
    })
  }

  async function getClients(file: string) {
    const s = await state()
    const extension = path.parse(file).ext || file
    const result: LSPClient.Info[] = []

    async function schedule(server: LSPServer.Info, root: string, key: string) {
      const handle = await server
        .spawn(root)
        .then((value) => {
          if (!value) s.broken.add(key)
          return value
        })
        .catch((err) => {
          s.broken.add(key)
          log.error(`Failed to spawn LSP server ${server.id}`, { error: err })
          return undefined
        })

      if (!handle) return undefined
      log.info("spawned lsp server", { serverID: server.id })

      const client = await LSPClient.create({
        serverID: server.id,
        server: handle,
        root,
      }).catch((err) => {
        s.broken.add(key)
        handle.process.kill()
        log.error(`Failed to initialize LSP client ${server.id}`, { error: err })
        return undefined
      })

      if (!client) {
        handle.process.kill()
        return undefined
      }

      const existing = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (existing) {
        handle.process.kill()
        return existing
      }

      s.clients.push(client)
      return client
    }

    for (const server of Object.values(s.servers)) {
      if (server.extensions.length && !server.extensions.includes(extension)) continue

      const root = await server.root(file)
      if (!root) continue
      if (s.broken.has(root + server.id)) continue

      const match = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (match) {
        result.push(match)
        continue
      }

      const inflight = s.spawning.get(root + server.id)
      if (inflight) {
        const client = await inflight
        if (!client) continue
        result.push(client)
        continue
      }

      const task = schedule(server, root, root + server.id)
      s.spawning.set(root + server.id, task)

      void task.finally(() => {
        if (s.spawning.get(root + server.id) === task) {
          s.spawning.delete(root + server.id)
        }
      })

      const client = await task
      if (!client) continue

      result.push(client)
      await Bus.publish(Event.Updated, {})
    }

    return result
  }

  export async function hasClients(file: string) {
    const s = await state()
    const extension = path.parse(file).ext || file
    for (const server of Object.values(s.servers)) {
      if (server.extensions.length && !server.extensions.includes(extension)) continue
      const root = await server.root(file)
      if (!root) continue
      if (s.broken.has(root + server.id)) continue
      return true
    }
    return false
  }

  export async function touchFile(input: string, waitForDiagnostics?: boolean) {
    log.info("touching file", { file: input })
    const clients = await getClients(input)
    await Promise.all(
      clients.map(async (client) => {
        const wait = waitForDiagnostics ? client.waitForDiagnostics({ path: input }) : Promise.resolve()
        await client.notify.open({ path: input })
        return wait
      }),
    ).catch((err) => {
      log.error("failed to touch file", { err, file: input })
    })
  }

  export async function diagnostics() {
    const results: Record<string, LSPClient.Diagnostic[]> = {}
    for (const clientDiagnostics of await runAll((client): Map<string, LSPClient.Diagnostic[]> => client.diagnostics)) {
      const entries = Array.from(clientDiagnostics as Map<string, LSPClient.Diagnostic[]>)
      for (const [filePath, fileDiagnostics] of entries) {
        const arr = results[filePath] ?? []
        arr.push(...fileDiagnostics)
        results[filePath] = arr
      }
    }
    return results
  }

  export async function hover(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) => {
      return client.connection
        .sendRequest("textDocument/hover", {
          textDocument: {
            uri: pathToFileURL(input.file).href,
          },
          position: {
            line: input.line,
            character: input.character,
          },
        })
        .catch(() => null)
    })
  }

  const kinds = [
    SymbolKind.Class,
    SymbolKind.Function,
    SymbolKind.Method,
    SymbolKind.Interface,
    SymbolKind.Variable,
    SymbolKind.Constant,
    SymbolKind.Struct,
    SymbolKind.Enum,
  ] as const

  export async function workspaceSymbol(query: string) {
    return runAll((client) =>
      client.connection
        .sendRequest<SymbolInformation[]>("workspace/symbol", {
          query,
        })
        .then((result) =>
          result.filter((item): item is SymbolInformation => {
            const kind = item?.kind
            return Boolean(kind && kinds.includes(kind))
          }),
        )
        .then((result) => result.slice(0, 10))
        .catch((): SymbolInformation[] => []),
    ).then((result) => result.flat())
  }

  export async function documentSymbol(uri: string) {
    const file = fileURLToPath(uri)
    return run(file, (client) =>
      client.connection
        .sendRequest("textDocument/documentSymbol", {
          textDocument: {
            uri,
          },
        })
        .catch(() => []),
    )
      .then((result) => result.flat() as (LSP.DocumentSymbol | LSP.Symbol)[])
      .then((result) => result.filter(Boolean))
  }

  export async function definition(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/definition", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => null),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function references(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/references", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
          context: { includeDeclaration: true },
        })
        .catch(() => []),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function implementation(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/implementation", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => null),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function prepareCallHierarchy(input: { file: string; line: number; character: number }) {
    return run(input.file, (client) =>
      client.connection
        .sendRequest("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch(() => []),
    ).then((result) => result.flat().filter(Boolean))
  }

  export async function incomingCalls(input: { file: string; line: number; character: number }) {
    return run(input.file, async (client): Promise<CallHierarchyIncomingCall[]> => {
      const items = (await client.connection
        .sendRequest<CallHierarchyItem[]>("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch((): CallHierarchyItem[] => []))
      if (!items?.length) return []
      const [root] = items
      if (!root) return []
      return (
        await client.connection
          .sendRequest<CallHierarchyIncomingCall[]>("callHierarchy/incomingCalls", {
            item: root,
          })
          .catch((): CallHierarchyIncomingCall[] => [])
      )
    }).then((result) => result.flat().filter(Boolean))
  }

  export async function outgoingCalls(input: { file: string; line: number; character: number }) {
    return run(input.file, async (client): Promise<CallHierarchyOutgoingCall[]> => {
      const items = (await client.connection
        .sendRequest<CallHierarchyItem[]>("textDocument/prepareCallHierarchy", {
          textDocument: { uri: pathToFileURL(input.file).href },
          position: { line: input.line, character: input.character },
        })
        .catch((): CallHierarchyItem[] => []))
      if (!items?.length) return []
      const [root] = items
      if (!root) return []
      return (
        await client.connection
          .sendRequest<CallHierarchyOutgoingCall[]>("callHierarchy/outgoingCalls", {
            item: root,
          })
          .catch((): CallHierarchyOutgoingCall[] => [])
      )
    }).then((result) => result.flat().filter(Boolean))
  }

  async function runAll<T>(input: (client: LSPClient.Info) => Promise<T>): Promise<T[]> {
    const clients = await state().then((x) => x.clients)
    const tasks = clients.map((x) => input(x))
    return Promise.all(tasks)
  }

  async function run<T>(file: string, input: (client: LSPClient.Info) => Promise<T>): Promise<T[]> {
    const clients = await getClients(file)
    const tasks = clients.map((x) => input(x))
    return Promise.all(tasks)
  }

  export const Diagnostic = {
    pretty(diagnostic: LSPClient.Diagnostic) {
      const severityMap = {
        1: "ERROR",
        2: "WARN",
        3: "INFO",
        4: "HINT",
      }

      const severity = severityMap[diagnostic.severity || 1]
      const line = diagnostic.range.start.line + 1
      const col = diagnostic.range.start.character + 1

      return `${severity} [${line}:${col}] ${diagnostic.message}`
    },
  }
}
