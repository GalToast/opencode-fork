import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"
import path from "path"
import { withTimeout } from "@/util/timeout"
import type ParcelWatcher from "@parcel/watcher"
import { $ } from "bun"
import { Flag } from "@/flag/flag"
import { readdir } from "fs/promises"
import { Effect, Layer, ServiceMap } from "effect"

const SUBSCRIBE_TIMEOUT_MS = 10_000

declare const OPENCODE_LIBC: string | undefined

function hasNativeBinding(): boolean {
  try {
    const name = `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${OPENCODE_LIBC || "glibc"}` : ""}`
    require.resolve(name)
    return true
  } catch {
    return false
  }
}

// IIFE implementation
const FileWatcherImpl = (() => {
  const log = Log.create({ service: "file.watcher" })

  const Event = {
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  const state = Instance.state(
    async () => {
      log.info("init")
      const cfg = await Config.get()
      const backend = (() => {
        if (process.platform === "win32") return "windows"
        if (process.platform === "darwin") return "fs-events"
        if (process.platform === "linux") return "inotify"
      })()
      if (!backend) {
        log.error("watcher backend not supported", { platform: process.platform })
        return {}
      }
      log.info("watcher backend", { platform: process.platform, backend })

      const { createWrapper } = (await import("@parcel/watcher/wrapper.js")) as {
        createWrapper: (binding: unknown) => typeof import("@parcel/watcher")
      }

      let w: typeof import("@parcel/watcher") | undefined
      try {
        const name = `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${OPENCODE_LIBC || "glibc"}` : ""}`
        const binding: unknown = await import(name)
        w = createWrapper((binding as { default?: unknown }).default ?? binding)
      } catch (error) {
        log.error("failed to load watcher binding", { error })
        return {}
      }

      const subscribe: ParcelWatcher.SubscribeCallback = (err, evts) => {
        if (err) return
        for (const evt of evts) {
          if (evt.type === "create") void Bus.publish(Event.Updated, { file: evt.path, event: "add" })
          if (evt.type === "update") void Bus.publish(Event.Updated, { file: evt.path, event: "change" })
          if (evt.type === "delete") void Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
        }
      }

      const subs: ParcelWatcher.AsyncSubscription[] = []
      const cfgIgnores = cfg.watcher?.ignore ?? []

      if (Flag.OPENCODE_EXPERIMENTAL_FILEWATCHER) {
        const pending = w.subscribe(Instance.directory, subscribe, {
          ignore: [...FileIgnore.PATTERNS, ...cfgIgnores],
          backend,
        })
        const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
          log.error("failed to subscribe to Instance.directory", { error: err })
          void pending.then((s) => s.unsubscribe()).catch(() => {})
          return undefined
        })
        if (sub) subs.push(sub)
      }

      if (Instance.project.vcs === "git") {
        const vcsDir = await $`git rev-parse --git-dir`
          .quiet()
          .nothrow()
          .cwd(Instance.worktree)
          .text()
          .then((x) => path.resolve(Instance.worktree, x.trim()))
          .catch(() => undefined)
        if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
          const gitDirContents = await readdir(vcsDir).catch(() => [])
          const ignoreList = gitDirContents.filter((entry) => entry !== "HEAD")
          const pending = w.subscribe(vcsDir, subscribe, {
            ignore: ignoreList,
            backend,
          })
          const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
            log.error("failed to subscribe to vcsDir", { error: err })
            void pending.then((s) => s.unsubscribe()).catch(() => {})
            return undefined
          })
          if (sub) subs.push(sub)
        }
      }

      return { subs }
    },
    async (prev) => {
      if (!prev.subs) return
      await Promise.all(prev.subs.map((sub) => sub?.unsubscribe()))
    },
  )

  function init() {
    if (Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER) {
      return
    }
    void state()
  }

  return { Event, init }
})()

// Combined export merging namespace (Service, layer, hasNativeBinding) with IIFE (Event, init)
interface FileWatcherInterface {
  readonly init: () => Effect.Effect<void>
}

class FileWatcherService extends ServiceMap.Service<FileWatcherService, FileWatcherInterface>()("@opencode/FileWatcher") {}

const layer = Layer.effect(
  FileWatcherService,
  Effect.gen(function* () {
    return FileWatcherService.of({
      init: () => Effect.sync(() => FileWatcherImpl.init()),
    })
  }),
)

export const FileWatcher = Object.assign(FileWatcherImpl, {
  hasNativeBinding,
  Service: FileWatcherService,
  layer,
})
