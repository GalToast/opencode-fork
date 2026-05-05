// @ts-nocheck
import { expect, test } from "bun:test"
import { utimes, writeFile } from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { acquireFileLock } from "../../src/harness/coordination"

test("acquireFileLock evicts a fresh lock left behind by a dead process", async () => {
  await using tmp = await tmpdir({})

  const key = path.join(tmp.path, "session_restart_recovery")
  const lockPath = `${key}.lock`
  await writeFile(
    lockPath,
    JSON.stringify({
      pid: 999_999_999,
      acquiredAt: Date.now(),
      heartbeatAt: Date.now(),
      key,
    }),
    "utf8",
  )
  // Set mtime to epoch to make the lock actually stale (diff > staleMS)
  const epoch = new Date(0)
  await utimes(lockPath, epoch, epoch)

  using lock = await acquireFileLock(key, {
    timeoutMS: 250,
    pollMS: 10,
    staleMS: 60_000,
  })

  expect(lock).toBeDefined()
})
