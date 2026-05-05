import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { lazy } from "../util/lazy"
import { Lock } from "../util/lock"
import { $ } from "bun"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { Glob } from "../util/glob"
import { Session } from "../session"
import { Snapshot } from "../snapshot"
import { Effect, Layer, ServiceMap } from "effect"

const log = Log.create({ service: "storage" })

type Migration = (dir: string) => Promise<void>
type LegacyMessageRoot = {
  path?: {
    root?: string
  }
}

const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const MIGRATIONS: Migration[] = [
  async (dir) => {
    const project = path.resolve(dir, "../project")
    if (!Filesystem.isDir(project)) return
    const projectDirs = await Glob.scan("*", {
      cwd: project,
      include: "all",
    })
    for (const projectDir of projectDirs) {
      const fullPath = path.join(project, projectDir)
      if (!Filesystem.isDir(fullPath)) continue
      log.info(`migrating project ${projectDir}`)
      let projectID = projectDir
      const fullProjectDir = path.join(project, projectDir)
      let worktree = "/"

      if (projectID === "global") continue

      for (const msgFile of await Glob.scan("storage/session/message/*/*.json", {
        cwd: fullProjectDir,
        absolute: true,
      })) {
        const json = await Filesystem.readJson<LegacyMessageRoot>(msgFile)
        worktree = json.path?.root ?? ""
        if (worktree) break
      }
      if (!worktree) continue
      if (!Filesystem.isDir(worktree)) continue

      const [id] = await $`git rev-list --max-parents=0 --all`
        .quiet()
        .nothrow()
        .cwd(worktree)
        .text()
        .then((text) =>
          text
            .split("\n")
            .filter(Boolean)
            .map((item) => item.trim())
            .toSorted(),
        )
      if (!id) continue
      projectID = id

      await Filesystem.writeJson(path.join(dir, "project", projectID + ".json"), {
        id,
        vcs: "git",
        worktree,
        time: {
          created: Date.now(),
          initialized: Date.now(),
        },
      })

      log.info(`migrating sessions for project ${projectID}`)
      for (const sessionFile of await Glob.scan("storage/session/info/*.json", {
        cwd: fullProjectDir,
        absolute: true,
      })) {
        const sessionDest = path.join(dir, "session", projectID, path.basename(sessionFile))
        log.info("copying", {
          sessionFile,
          dest: sessionDest,
        })
        const session = await Filesystem.readJson<Session.Info>(sessionFile)
        await Filesystem.writeJson(sessionDest, session)

        log.info(`migrating messages for session ${session.id}`)
        for (const msgFile of await Glob.scan(`storage/session/message/${session.id}/*.json`, {
          cwd: fullProjectDir,
          absolute: true,
        })) {
          const messageDest = path.join(dir, "message", session.id, path.basename(msgFile))
          log.info("copying", {
            msgFile,
            dest: messageDest,
          })
          const message = await Filesystem.readJson<import("../session/message").Message.Info>(msgFile)
          await Filesystem.writeJson(messageDest, message)

          log.info(`migrating parts for message ${message.id}`)
          for (const partFile of await Glob.scan(`storage/session/part/${session.id}/${message.id}/*.json`, {
            cwd: fullProjectDir,
            absolute: true,
          })) {
            const partDest = path.join(dir, "part", message.id, path.basename(partFile))
            const part = await Filesystem.readJson<unknown>(partFile)
            log.info("copying", {
              partFile,
              dest: partDest,
            })
            await Filesystem.writeJson(partDest, part)
          }
        }
      }
    }
  },
  async (dir) => {
    for (const item of await Glob.scan("session/*/*.json", {
      cwd: dir,
      absolute: true,
    })) {
      const session = await Filesystem.readJson<Session.Info>(item)
      if (!session.projectID) continue
      if (!session.summary?.diffs) continue
      const { diffs } = session.summary
      await Filesystem.write(path.join(dir, "session_diff", session.id + ".json"), JSON.stringify(diffs))
      await Filesystem.writeJson(path.join(dir, "session", session.projectID, session.id + ".json"), {
        ...session,
        summary: {
          additions: diffs.reduce((sum, diff) => sum + diff.additions, 0),
          deletions: diffs.reduce((sum, diff) => sum + diff.deletions, 0),
        },
      })
    }
  },
]

const state = lazy(async () => {
  const dir = path.join(Global.Path.data, "storage")
  const completedMigrations = await Filesystem.readJson<string>(path.join(dir, "migration"))
    .then((value) => parseInt(value))
    .catch(() => 0)
  for (let index = completedMigrations; index < MIGRATIONS.length; index++) {
    log.info("running migration", { index })
    const runMigration = MIGRATIONS[index]
    await runMigration(dir).catch(() => log.error("failed to run migration", { index }))
    await Filesystem.write(path.join(dir, "migration"), (index + 1).toString())
  }
  return {
    dir,
  }
})

async function remove(key: string[]) {
  const dir = await state().then((value) => value.dir)
  const target = path.join(dir, ...key) + ".json"
  return withErrorHandling(async () => {
    await fs.unlink(target).catch(() => {})
  })
}

async function read<T>(key: string[]) {
  const dir = await state().then((value) => value.dir)
  const target = path.join(dir, ...key) + ".json"
  return withErrorHandling(async () => {
    using _ = await Lock.read(target)
    return Filesystem.readJson<T>(target)
  })
}

async function update<T>(key: string[], fn: (draft: T) => void) {
  const dir = await state().then((value) => value.dir)
  const target = path.join(dir, ...key) + ".json"
  return withErrorHandling(async () => {
    using _ = await Lock.write(target)
    const content = await Filesystem.readJson<T>(target)
    fn(content)
    await Filesystem.writeJson(target, content)
    return content
  })
}

async function write<T>(key: string[], content: T) {
  const dir = await state().then((value) => value.dir)
  const target = path.join(dir, ...key) + ".json"
  return withErrorHandling(async () => {
    using _ = await Lock.write(target)
    await Filesystem.writeJson(target, content)
  })
}

async function withErrorHandling<T>(body: () => Promise<T>) {
  return body().catch((error: unknown) => {
    if (!(error instanceof Error)) throw error
    const errnoException = error as NodeJS.ErrnoException
    if (errnoException.code === "ENOENT") {
      throw new NotFoundError({ message: `Resource not found: ${errnoException.path}` })
    }
    throw error
  })
}

async function list(prefix: string[]) {
  const dir = await state().then((value) => value.dir)
  try {
    const result = await Glob.scan("**/*", {
      cwd: path.join(dir, ...prefix),
      include: "file",
    }).then((results) => results.map((item) => [...prefix, ...item.slice(0, -5).split(path.sep)]))
    result.sort()
    return result
  } catch {
    return []
  }
}

interface Interface {
  readonly remove: (key: string[]) => Effect.Effect<void>
  readonly read: <T>(key: string[]) => Effect.Effect<T>
  readonly update: <T>(key: string[], fn: (draft: T) => void) => Effect.Effect<T>
  readonly write: <T>(key: string[], content: T) => Effect.Effect<void>
  readonly list: (prefix: string[]) => Effect.Effect<string[][]>
}

class StorageService extends ServiceMap.Service<StorageService, Interface>()("@opencode/Storage") {}

const service = StorageService.of({
  remove: (key) => Effect.promise(() => remove(key)),
  read: (key) => Effect.promise(() => read(key)),
  update: (key, fn) => Effect.promise(() => update(key, fn)),
  write: (key, content) => Effect.promise(() => write(key, content)),
  list: (prefix) => Effect.promise(() => list(prefix)),
})

export const Storage = {
  NotFoundError,
  Service: StorageService,
  layer: Layer.succeed(StorageService, service),
  defaultLayer: Layer.succeed(StorageService, service),
  remove,
  read,
  update,
  write,
  list,
}
