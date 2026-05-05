import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { Database } from "../../src/storage/db"
import path from "path"
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs"
import { Global } from "../../src/global"

const MIGRATION_STATUS_FILE = path.join(Global.Path.data, ".migration-status.json")
const MIGRATION_LOCK_FILE = path.join(Global.Path.data, ".migration.lock")

describe("Database Migrations", () => {
  beforeEach(() => {
    Database.close()
    // @ts-ignore
    Database.resetMigrationStatus()
    if (existsSync(MIGRATION_STATUS_FILE)) {
      rmSync(MIGRATION_STATUS_FILE)
    }
    if (existsSync(MIGRATION_LOCK_FILE)) {
      rmSync(MIGRATION_LOCK_FILE)
    }
  })

  afterEach(() => {
    Database.close()
  })

  test("migration runs on startup", () => {
    const db = Database.Client()
    expect(db).toBeDefined()
    
    // @ts-ignore
    const status = Database.getMigrationStatus()
    expect(status.status).toBe("completed")
    expect(status.migrationsApplied).toBeGreaterThan(0)
  })

  test("Client returns same instance (lazy initialization)", () => {
    const db1 = Database.Client()
    const db2 = Database.Client()
    expect(db1).toBe(db2)
  })

  test("migration status file is created on successful migration", () => {
    Database.Client()

    expect(existsSync(MIGRATION_STATUS_FILE)).toBe(true)

    const content = readFileSync(MIGRATION_STATUS_FILE, "utf-8")
    const status = JSON.parse(content)

    expect(status.status).toBe("completed")
    expect(status.lastRun).toBeDefined()
    expect(status.migrationsApplied).toBeGreaterThan(0)
  })

  test("resetMigrationStatus clears in-memory state", () => {
    Database.Client()
    // @ts-ignore
    expect(Database.hasMigrationsCompleted()).toBe(true)

    // @ts-ignore
    Database.resetMigrationStatus()
    // @ts-ignore
    expect(Database.hasMigrationsCompleted()).toBe(false)
    // @ts-ignore
    expect(Database.getMigrationError()).toBeUndefined()

    // @ts-ignore
    const status = Database.getMigrationStatus()
    expect(status.status).toBe("pending")
  })

  test("migration lock prevents execution when held", () => {
    writeFileSync(MIGRATION_LOCK_FILE, JSON.stringify({ pid: 99999, time: Date.now() }))

    Database.Client()

    // @ts-ignore
    const status = Database.getMigrationStatus()
    expect(status.status).not.toBe("running")
  })

  test("stale migration lock is cleaned up", () => {
    const staleTime = Date.now() - 120000
    writeFileSync(MIGRATION_LOCK_FILE, JSON.stringify({ pid: process.pid, time: staleTime }))

    Database.Client()

    expect(existsSync(MIGRATION_LOCK_FILE)).toBe(false)
  })

  test("concurrent process lock is respected", () => {
    writeFileSync(MIGRATION_LOCK_FILE, JSON.stringify({ pid: process.pid, time: Date.now() }))

    Database.Client()

    // @ts-ignore
    const status = Database.getMigrationStatus()
    expect(status.status).toBe("pending")
    // @ts-ignore
    expect(Database.hasMigrationsCompleted()).toBe(false)
  })

  test("getMigrationStatus returns status object", () => {
    Database.Client()
    
    // @ts-ignore
    const status = Database.getMigrationStatus()
    expect(status).toBeDefined()
    expect(status.status).toBeDefined()
    expect(["pending", "running", "completed", "failed"]).toContain(status.status)
  })

  test("migration failures are logged", () => {
    const migrateSpy = mock(() => {
      throw new Error("Test migration failure")
    })

    mock.module("drizzle-orm/bun-sqlite/migrator", () => ({
      migrate: migrateSpy,
    }))

    try {
      Database.Client()

      // @ts-ignore
      expect(Database.hasMigrationsCompleted()).toBe(false)
      // @ts-ignore
      const error = Database.getMigrationError()
      expect(error).toBeDefined()
      expect(error?.message).toContain("Test migration failure")

      // @ts-ignore
      const status = Database.getMigrationStatus()
      expect(status.status).toBe("failed")
      expect(status.error).toContain("Test migration failure")
    } finally {
      mock.restore()
    }
  })

  test("database can start even with migration errors", () => {
    const testError = new Error("Simulated migration error")

    mock.module("drizzle-orm/bun-sqlite/migrator", () => ({
      migrate: mock(() => {
        throw testError
      }),
    }))

    try {
      const db = Database.Client()
      expect(db).toBeDefined()
      // @ts-ignore
      expect(Database.hasMigrationsCompleted()).toBe(false)
      // @ts-ignore
      expect(Database.getMigrationError()).toBeDefined()
    } finally {
      mock.restore()
    }
  })

  test("migration error details are preserved", () => {
    const testError = new Error("Test error with details")
    testError.stack = "Error: Test error with details\n    at test:1:1"

    mock.module("drizzle-orm/bun-sqlite/migrator", () => ({
      migrate: mock(() => {
        throw testError
      }),
    }))

    try {
      Database.Client()

      // @ts-ignore
      const error = Database.getMigrationError()
      expect(error?.message).toBe("Test error with details")

      // @ts-ignore
      const status = Database.getMigrationStatus()
      expect(status.error).toBe("Test error with details")
    } finally {
      mock.restore()
    }
  })

  test("getMigrationError returns error when present", () => {
    const testError = new Error("Test error")

    mock.module("drizzle-orm/bun-sqlite/migrator", () => ({
      migrate: mock(() => {
        throw testError
      }),
    }))

    try {
      Database.Client()
      // @ts-ignore
      const error = Database.getMigrationError()
      expect(error).toBeDefined()
      expect(error?.message).toBe("Test error")
    } finally {
      mock.restore()
    }
  })
})
