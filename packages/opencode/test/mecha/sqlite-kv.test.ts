import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { configureSQLiteKVConnection, SQLITE_KV_BUSY_TIMEOUT_MS } from "../../src/mecha/sqlite-kv"

function firstValue(row: Record<string, unknown> | null | undefined) {
  return row ? Object.values(row)[0] : undefined
}

describe("sqlite kv", () => {
  test("configures sqlite connections for concurrent benchmark access", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "state.sqlite")
    const conn = new Database(file)

    try {
      configureSQLiteKVConnection(conn)

      const journalMode = firstValue(conn.query("PRAGMA journal_mode").get() as Record<string, unknown>)
      const busyTimeout = firstValue(conn.query("PRAGMA busy_timeout").get() as Record<string, unknown>)
      const synchronous = firstValue(conn.query("PRAGMA synchronous").get() as Record<string, unknown>)

      expect(journalMode).toBe("wal")
      expect(busyTimeout).toBe(SQLITE_KV_BUSY_TIMEOUT_MS)
      expect(synchronous).toBe(1)
    } finally {
      conn.close()
    }
  })
})
