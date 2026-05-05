import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import path from "path"
import { fileURLToPath } from "url"
import { existsSync, realpathSync } from "fs"
import { UI } from "@/cli/ui"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import type { Event } from "@opencode-ai/sdk/v2"
import type { EventSource } from "./context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import { startRuntimeRegistryHeartbeat } from "./runtime-registry"

declare global {
  const OPENCODE_WORKER_PATH: string
}

type TuiSignal = "SIGINT" | "SIGTERM" | "SIGQUIT" | "SIGHUP"

const RUNTIME_ROLE = "tui_supervisor"
const WORKER_RUNTIME_ROLE = "tui_worker"

const runtimeId = () => process.env.OPENCODE_RUNTIME_ID || "unknown"

function workerEnv(directory: string) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    OPENCODE_RUNTIME_ROLE: WORKER_RUNTIME_ROLE,
    OPENCODE_RUNTIME_PARENT_ROLE: process.env.OPENCODE_RUNTIME_ROLE || RUNTIME_ROLE,
    OPENCODE_RUNTIME_PARENT_PID: String(process.pid),
    OPENCODE_RUNTIME_ID: runtimeId(),
    OPENCODE_TUI_DIRECTORY: directory,
  }
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>
const WORKER_FETCH_TIMEOUT_MS = 30000
type WorkerFetchResponse = {
  status: number
  headers: Record<string, string>
  body: string
}

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (requestInput: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(requestInput, init)
    const body = request.body ? await request.text() : undefined

    let result: WorkerFetchResponse
    try {
      result = await withTimeout(
        client.call<"fetch">("fetch", {
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          body,
        }),
        WORKER_FETCH_TIMEOUT_MS,
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`TUI worker fetch failed for ${request.method} ${request.url}: ${detail}`)
    }
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    on: (handler) => client.on<Event>("event", handler),
  }
}

function target() {
  if (typeof OPENCODE_WORKER_PATH !== "undefined") return OPENCODE_WORKER_PATH
  const dist = new URL("./worker.js", import.meta.url)
  if (existsSync(fileURLToPath(dist))) return dist
  return new URL("./worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    withNetworkOptions(
      yargs
        .positional("project", {
          type: "string",
          describe: "path to start opencode in",
        })
        .option("model", {
          type: "string",
          alias: ["m"],
          describe: "model to use in the format of provider/model",
        })
        .option("continue", {
          alias: ["c"],
          describe: "continue the last session",
          type: "boolean",
        })
        .option("session", {
          alias: ["s"],
          type: "string",
          describe: "session id to continue",
        })
        .option("fork", {
          type: "boolean",
          describe: "fork the session when continuing (use with --continue or --session)",
        })
        .option("prompt", {
          type: "string",
          describe: "prompt to use",
        })
        .option("agent", {
          type: "string",
          describe: "agent to use",
        }),
    ),
  handler: async (args) => {
    // Keep ENABLE_PROCESSED_INPUT cleared even if other code flips it.
    // (Important when running under `bun run` wrappers on Windows.)
    const unguard = win32InstallCtrlCGuard()
    try {
      // Must be the very first thing — disables CTRL_C_EVENT before any Worker
      // spawn or async work so the OS cannot kill the process group.
      win32DisableProcessedInput()
      process.env.OPENCODE_RUNTIME_ROLE = process.env.OPENCODE_RUNTIME_ROLE || RUNTIME_ROLE
      Log.Default.info("tui.thread.start", {
        runtimeID: runtimeId(),
        runtimeRole: process.env.OPENCODE_RUNTIME_ROLE,
        runtimePID: process.pid,
        runtimePPID: process.ppid,
      })

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      // Resolve relative paths against PWD to preserve behavior when using --cwd flag
      const root = process.env.PWD ?? process.cwd()
      const resolved = args.project ? path.resolve(root, args.project) : process.cwd()
      const cwd = existsSync(resolved) ? realpathSync.native(resolved) : resolved
      const file = target()
      try {
        process.chdir(cwd)
      } catch {
        UI.error("Failed to change directory to " + cwd)
        return
      }

      const worker = new Worker(file, {
        env: workerEnv(cwd),
      })
      const runtimeRegistry = startRuntimeRegistryHeartbeat({ directory: cwd })
      worker.onerror = (e) => {
        Log.Default.error("tui worker error", {
          message: e.message,
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          error:
            e.error instanceof Error
              ? {
                  name: e.error.name,
                  message: e.error.message,
                  stack: e.error.stack,
                }
              : e.error,
        })
      }
      worker.addEventListener?.("close", (event) => {
        Log.Default.warn("tui worker closed", {
          event,
        })
      })

      const client = Rpc.client<typeof rpc>(worker)
      const error = (e: unknown) => {
        Log.Default.error(e)
      }
      const reload = () => {
        client.call("reload", undefined).catch((err) => {
          Log.Default.warn("worker reload failed", {
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }
      process.on("uncaughtException", error)
      process.on("unhandledRejection", error)
      process.on("SIGUSR2", reload)

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        Log.Default.info("tui.thread.stop", {
          runtimeID: runtimeId(),
          runtimeRole: process.env.OPENCODE_RUNTIME_ROLE,
          runtimePID: process.pid,
        })
        process.off("uncaughtException", error)
        process.off("unhandledRejection", error)
        process.off("SIGUSR2", reload)
        await withTimeout(client.call("shutdown", undefined), 5000).catch((shutdownError) => {
          Log.Default.warn("worker shutdown failed", {
            error: shutdownError instanceof Error ? shutdownError.message : String(shutdownError),
          })
        })
        worker.terminate()
        await runtimeRegistry.stop()
      }

      const stopBySignal = (signal: TuiSignal) => {
        Log.Default.info("tui.thread.signal", { signal, runtimeID: runtimeId(), runtimeRole: process.env.OPENCODE_RUNTIME_ROLE })
        void stop().finally(() => process.exit(0))
      }

      const onSigInt = () => stopBySignal("SIGINT")
      const onSigTerm = () => stopBySignal("SIGTERM")
      const onSigQuit = () => stopBySignal("SIGQUIT")
      const onSighup = () => stopBySignal("SIGHUP")

      process.on("SIGINT", onSigInt)
      process.on("SIGTERM", onSigTerm)
      process.on("SIGQUIT", onSigQuit)
      process.on("SIGHUP", onSighup)

      const prompt = await input(args.prompt)
      const config = await Instance.provide({
        directory: cwd,
        fn: () => TuiConfig.get(),
      })

      const network = await resolveNetworkOptions({
        port: Number(args.port ?? 0),
        hostname: String(args.hostname ?? "127.0.0.1"),
        mdns: Boolean(args.mdns ?? false),
        "mdns-domain": String(args["mdns-domain"] ?? "opencode.local"),
        cors: Array.isArray(args.cors) ? args.cors.map(String) : args.cors ? [String(args.cors)] : [],
      })
      const external =
        process.argv.includes("--port") ||
        process.argv.includes("--hostname") ||
        process.argv.includes("--mdns") ||
        network.mdns ||
        network.port !== 0 ||
        network.hostname !== "127.0.0.1"

      const transport = external
        ? {
            url: (await client.call("server", network)).url,
            fetch: undefined,
            events: undefined,
          }
        : {
            url: "http://opencode.internal",
            fetch: createWorkerFetch(client),
            events: createEventSource(client),
          }

      if (process.env["OPENCODE_SKIP_UPDATE_CHECK"] !== "1") {
        setTimeout(() => {
          client.call("checkUpgrade", { directory: cwd }).catch(() => {})
        }, 1000).unref?.()
      }

      try {
        await tui({
          url: transport.url,
          config,
          directory: cwd,
          fetch: transport.fetch,
          events: transport.events,
          args: {
            continue: args.continue,
            sessionID: args.session,
            agent: args.agent,
            model: args.model,
            prompt,
            fork: args.fork,
          },
          onExit: stop,
        })
      } finally {
        await stop()
        process.off("SIGINT", onSigInt)
        process.off("SIGTERM", onSigTerm)
        process.off("SIGQUIT", onSigQuit)
        process.off("SIGHUP", onSighup)
      }
    } finally {
      unguard?.()
    }
    process.exit(0)
  },
})
