import path from "path"
import { mkdir, open, rm, stat, writeFile } from "fs/promises"
import { Global } from "@/global"

type FileLockOptions = {
  timeoutMS?: number
  pollMS?: number
  staleMS?: number
  heartbeatMS?: number
}

function harnessLockDir() {
  return path.join(Global.Path.state, "harness", "locks")
}

function normalizeKey(key: string) {
  return key.replaceAll("\\", "/")
}

function fileLockPath(key: string) {
  const normalized = normalizeKey(key)
  if (path.isAbsolute(normalized)) return `${normalized}.lock`
  const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, "_")
  return path.join(harnessLockDir(), `${safe}.lock`)
}

export async function acquireFileLock(key: string, options: FileLockOptions = {}): Promise<Disposable> {
  const lockPath = fileLockPath(key)
  const timeoutMS = options.timeoutMS ?? 60_000
  const pollMS = options.pollMS ?? 100
  const staleMS = options.staleMS ?? 5 * 60_000
  const heartbeatMS = options.heartbeatMS ?? 0
  const startedAt = Date.now()

  await mkdir(path.dirname(lockPath), { recursive: true })

  while (true) {
    try {
      const handle = await open(lockPath, "wx")
      let released = false
      const writeMetadata = async () => {
        const payload = JSON.stringify({
          pid: process.pid,
          acquiredAt: startedAt,
          heartbeatAt: Date.now(),
          key: normalizeKey(key),
        })
        await handle.truncate(0).catch(() => undefined)
        await handle.write(payload, 0, "utf8").catch(() => undefined)
      }
      await writeMetadata().catch(() =>
        writeFile(
          lockPath,
          JSON.stringify({
            pid: process.pid,
            acquiredAt: startedAt,
            heartbeatAt: Date.now(),
            key: normalizeKey(key),
          }),
        ).catch(() => undefined),
      )
      const heartbeat =
        heartbeatMS > 0
          ? setInterval(() => {
              if (released) return
              void writeMetadata()
            }, heartbeatMS)
          : undefined
      heartbeat?.unref?.()
      return {
        [Symbol.dispose]: () => {
          released = true
          if (heartbeat) clearInterval(heartbeat)
          void handle.close().catch(() => undefined)
          void rm(lockPath, { force: true }).catch(() => undefined)
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes("EEXIST")) throw error

      const info = await stat(lockPath).catch(() => undefined)
      if (info && Date.now() - info.mtimeMs > staleMS) {
        await rm(lockPath, { force: true }).catch(() => undefined)
        continue
      }
      if (Date.now() - startedAt >= timeoutMS) {
        throw new Error(`Timed out waiting for file lock: ${normalizeKey(key)}`)
      }
      await Bun.sleep(pollMS)
    }
  }
}
