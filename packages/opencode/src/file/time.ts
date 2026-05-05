import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { Filesystem } from "../util/filesystem"
import { Layer, ServiceMap, Effect } from "effect"

const log = Log.create({ service: "file.time" })

type ReadTimes = {
  [sessionID: string]: {
    [path: string]: Date | undefined
  }
}

export interface Interface {
  readonly state: () => Effect.Effect<{ readTimes: ReadTimes; locks: Map<string, Promise<void>> }>
  readonly read: (sessionID: string, file: string) => Effect.Effect<void>
  readonly get: (sessionID: string, file: string) => Effect.Effect<Date | undefined>
  readonly withLock: <T>(filepath: string, fn: () => Promise<T>) => Effect.Effect<T>
  readonly assert: (sessionID: string, filepath: string) => Effect.Effect<void>
}

// Service class for Effect dependency injection
export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/FileTime") {}

// Per-session read times plus per-file write locks.
// All tools that overwrite existing files should run their
// assert/read/write/update sequence inside withLock(filepath, ...)
// so concurrent writes to the same file are serialized.
const state = Instance.state(() => {
  const readTimes: ReadTimes = {}
  const locks = new Map<string, Promise<void>>()
  return {
    readTimes,
    locks,
  }
})

function read(sessionID: string, file: string) {
  log.info("read", { sessionID, file })
  const { readTimes } = state()
  readTimes[sessionID] = readTimes[sessionID] || {}
  readTimes[sessionID][file] = new Date()
}

function get(sessionID: string, file: string) {
  return state().readTimes[sessionID]?.[file]
}

async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
  const current = state()
  const currentLock = current.locks.get(filepath) ?? Promise.resolve()
  let release: () => void = () => {}
  const nextLock = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = currentLock.then(() => nextLock)
  current.locks.set(filepath, chained)
  await currentLock
  try {
    return await fn()
  } finally {
    release()
    if (current.locks.get(filepath) === chained) {
      current.locks.delete(filepath)
    }
  }
}

function assert(sessionID: string, filepath: string) {
  if (Flag.OPENCODE_DISABLE_FILETIME_CHECK_SYNC) {
    return
  }

  const time = get(sessionID, filepath)
  if (!time) throw new Error(`You must read file ${filepath} before overwriting it. Use the Read tool first`)
  const mtime = Filesystem.stat(filepath)?.mtime
  // Allow a 50ms tolerance for Windows NTFS timestamp fuzziness / async flushing
  if (mtime && mtime.getTime() > time.getTime() + 50) {
    throw new Error(
      `File ${filepath} has been modified since it was last read.\nLast modification: ${mtime.toISOString()}\nLast read: ${time.toISOString()}\n\nPlease read the file again before modifying it.`,
    )
  }
}

const layer = Layer.succeed(
  Service,
  Service.of({
    state: () => Effect.sync(() => state()),
    read: (sessionID, file) => Effect.sync(() => read(sessionID, file)),
    get: (sessionID, file) => Effect.sync(() => get(sessionID, file)),
    withLock: (filepath, fn) => Effect.promise(() => withLock(filepath, fn)),
    assert: (sessionID, filepath) => Effect.sync(() => assert(sessionID, filepath)),
  }),
)

export const FileTime = {
  state,
  read,
  get,
  withLock,
  assert,
  Service,
  defaultLayer: layer,
}
