import { rm } from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { Global } from "../../src/global"



const transientCleanupCodes = new Set(process.platform === "win32" ? ["EBUSY", "ENOTEMPTY", "EPERM"] : ["EBUSY"])
const errorCode = (error: unknown) => (typeof error === "object" && error !== null && "code" in error ? String(error.code) : "")
const isTransientCleanupError = (error: unknown) => transientCleanupCodes.has(errorCode(error))

async function retryRm(target: string, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await rm(target, { force: true, recursive: true })
      return
    } catch (error) {
      if (!isTransientCleanupError(error)) throw error
      if (attempt === attempts) throw error
      await Bun.sleep(Math.min(500, attempt * 50))
    }
  }
}

export async function resetDatabase() {
  await Instance.disposeAll().catch(() => undefined)
  Database.close()
  Database.resetMigrationStatus()

  const dataDir = Global.Path.data
  const dbPath = path.join(dataDir, "opencode.db")

  await Promise.all([
    retryRm(dbPath),
    retryRm(`${dbPath}-wal`),
    retryRm(`${dbPath}-shm`),
    retryRm(path.join(dataDir, ".migration.lock")),
    retryRm(path.join(dataDir, ".migration-status.json")),
  ]).catch(() => undefined)
}
