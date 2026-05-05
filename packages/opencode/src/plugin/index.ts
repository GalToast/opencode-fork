import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { CodexAuthPlugin } from "./codex"
import { Session } from "../session"
import { NamedError } from "@opencode-ai/util/error"
import { CopilotAuthPlugin } from "./copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "@gitlab/opencode-gitlab-auth"
import { Effect, Layer, ServiceMap } from "effect"

const log = Log.create({ service: "plugin" })

const BUILTIN = ["opencode-anthropic-auth@0.0.13"]

// Built-in plugins that are directly imported (not installed from npm)
const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin, GitlabAuthPlugin]

export interface Interface {
  readonly trigger: (name: Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">, input: unknown, output: unknown) => Promise<unknown>
  readonly list: () => Promise<Hooks[]>
  readonly init: () => Promise<void>
}

// Service class for Effect dependency injection
// eslint-disable-next-line @typescript-eslint/no-shadow -- shadowing is intentional
export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Plugin") {}

export { Service as PluginService }

const state = Instance.state(async () => {
  const client = createOpencodeClient({
    baseUrl: "http://localhost:4096",
    directory: Instance.directory,
    fetch: async (...args) => Server.App().fetch(...args),
  })
  const config = await Config.get()
  const hooks: Hooks[] = []
  const input: PluginInput = {
    client,
    project: Instance.project,
    worktree: Instance.worktree,
    directory: Instance.directory,
    serverUrl: Server.url,
    $: Bun.$,
  }

  for (const internalPlugin of INTERNAL_PLUGINS) {
    log.info("loading internal plugin", { name: internalPlugin.name })
    const pluginHooks = await internalPlugin(input).catch((err) => {
      log.error("failed to load internal plugin", { name: internalPlugin.name, error: err })
    })
    if (pluginHooks) hooks.push(pluginHooks)
  }

  let plugins = config.plugin ?? []
  if (plugins.length) await Config.waitForDependencies()
  if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
    plugins = [...BUILTIN, ...plugins]
  }

  for (const rawPlugin of plugins) {
    const plugin = Config.pluginSpecifier(rawPlugin)
    // ignore old codex plugin since it is supported first party now
    if (plugin.includes("opencode-openai-codex-auth") || plugin.includes("opencode-copilot-auth")) continue
    log.info("loading plugin", { path: plugin })
    let target = plugin
    if (!target.startsWith("file://")) {
      const lastAtIndex = target.lastIndexOf("@")
      const pkg = lastAtIndex > 0 ? target.substring(0, lastAtIndex) : target
      const version = lastAtIndex > 0 ? target.substring(lastAtIndex + 1) : "latest"
      target = await BunProc.install(pkg, version).catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err)
        log.error("failed to install plugin", { pkg, version, error: detail })
        void Bus.publish(Session.Event.Error, {
          error: new NamedError.Unknown({
            message: `Failed to install plugin ${pkg}@${version}: ${detail}`,
          }).toObject(),
        })
        return ""
      })
      if (!target) continue
    }
    // Prevent duplicate initialization when plugins export the same function
    // as both a named export and default export (e.g., `export const X` and `export default X`).
    // Object.entries(mod) would return both entries pointing to the same function reference.
    await import(target)
      .then(async (mod) => {
        const seen = new Set<PluginInstance>()
        const exports = mod as Record<string, unknown>
        for (const rawFn of Object.values(exports)) {
          if (typeof rawFn !== "function") continue
          const fn = rawFn as PluginInstance
          if (seen.has(fn)) continue
          seen.add(fn)
          hooks.push(await fn(input))
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        log.error("failed to load plugin", { path: plugin, error: message })
        void Bus.publish(Session.Event.Error, {
          error: new NamedError.Unknown({
            message: `Failed to load plugin ${plugin}: ${message}`,
          }).toObject(),
        })
      })
  }

  return {
    hooks,
    input,
  }
})

const PluginApi = {
  async trigger<Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">, Input, Output>(
    name: Name,
    input: Input,
    output: Output,
  ): Promise<Output> {
    if (!name) return output
    for (const hook of await state().then((x) => x.hooks)) {
      const fn = hook[name]
      if (!fn) continue
      // @ts-expect-error if you feel adventurous, please fix the typing, make sure to bump the try-counter if you
      // give up.
      // try-counter: 2
      await fn(input, output)
    }
    return output
  },

  list() {
    return state().then((x) => x.hooks)
  },

  init() {
    return state().then(async (x) => {
      const config = await Config.get()
      for (const hook of x.hooks) {
        // @ts-expect-error this is because we haven't moved plugin to sdk v2
        await hook.config?.(config)
      }
      Bus.subscribeAll((input) => {
        void (async () => {
          const currentHooks = await state().then((x) => x.hooks)
          for (const hook of currentHooks) {
            void hook["event"]?.({
              event: input as any,
            })
          }
        })()
      })
    })
  },
}

export const Plugin = PluginApi as typeof PluginApi & { Service: typeof Service; defaultLayer: typeof layer }

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({
      trigger: (name, input, output) => PluginApi.trigger(name, input, output),
      list: () => state().then((x) => x.hooks),
      init: () =>
        state().then(async (x) => {
          const config = await Config.get()
          for (const hook of x.hooks) {
            // @ts-expect-error this is because we haven't moved plugin to sdk v2
            await hook.config?.(config)
          }
          Bus.subscribeAll((input) => {
            void (async () => {
              const currentHooks = await state().then((x) => x.hooks)
              for (const hook of currentHooks) {
                void hook["event"]?.({
                  event: input as any,
                })
              }
            })()
          })
        }),
    })
  }),
)

export const defaultLayer = layer

// Extend the Plugin object with Service and defaultLayer
Plugin.Service = Service
Plugin.defaultLayer = defaultLayer
