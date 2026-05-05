import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import path from "path"
import os from "os"
import { getDatabasePath } from "../../src/storage/db-path"

describe("Database Path Resolution", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
  const originalDbPath = process.env.OPENCODE_DB_PATH
  const originalXdgData = process.env.XDG_DATA_HOME
  const originalAppData = process.env.APPDATA
  const originalHome = process.env.HOME

  beforeEach(() => {
    delete process.env.OPENCODE_DB_PATH
    delete process.env.XDG_DATA_HOME
    delete process.env.APPDATA
    delete process.env.HOME
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform)
    }
    if (originalDbPath) process.env.OPENCODE_DB_PATH = originalDbPath
    else delete process.env.OPENCODE_DB_PATH
    if (originalXdgData) process.env.XDG_DATA_HOME = originalXdgData
    else delete process.env.XDG_DATA_HOME
    if (originalAppData) process.env.APPDATA = originalAppData
    else delete process.env.APPDATA
    if (originalHome) process.env.HOME = originalHome
    else delete process.env.HOME
  })

  test("uses OPENCODE_DB_PATH environment variable when set", () => {
    const customPath = "/custom/path/to/database.db"
    process.env.OPENCODE_DB_PATH = customPath

    const result = getDatabasePath()

    expect(result).toBe(customPath)
  })

  test("uses Windows AppData path on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    process.env.APPDATA = "C:\\Users\\TestUser\\AppData\\Roaming"

    const result = getDatabasePath()

    const expectedPath = path.join("C:\\Users\\TestUser\\AppData\\Roaming", "opencode", "opencode.db")
    expect(result).toBe(expectedPath)
  })

  test("uses fallback Windows path when APPDATA not set", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    delete process.env.APPDATA

    const result = getDatabasePath()

    const expectedPath = path.join(os.homedir(), "AppData", "Roaming", "opencode", "opencode.db")
    expect(result).toBe(expectedPath)
  })

  test("uses macOS Application Support path on Mac", () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true })

    const result = getDatabasePath()

    const expectedPath = path.join(os.homedir(), "Library", "Application Support", "opencode", "opencode.db")
    expect(result).toBe(expectedPath)
  })

  test("uses XDG_DATA_HOME on Linux when set", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true })
    process.env.XDG_DATA_HOME = "/custom/xdg/data"

    const result = getDatabasePath()

    const expectedPath = path.join("/custom/xdg/data", "opencode", "opencode.db")
    expect(result).toBe(expectedPath)
  })

  test("uses default Linux path when XDG_DATA_HOME not set", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true })
    delete process.env.XDG_DATA_HOME

    const result = getDatabasePath()

    const expectedPath = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")
    expect(result).toBe(expectedPath)
  })

  test("uses default path for unknown platforms (falls back to Linux)", () => {
    Object.defineProperty(process, "platform", { value: "freebsd", configurable: true })
    delete process.env.XDG_DATA_HOME

    const result = getDatabasePath()

    const expectedPath = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")
    expect(result).toBe(expectedPath)
  })

  test("OPENCODE_DB_PATH takes precedence over platform-specific paths", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    process.env.APPDATA = "C:\\Users\\TestUser\\AppData\\Roaming"
    process.env.OPENCODE_DB_PATH = "/override/from/env.db"

    const result = getDatabasePath()

    expect(result).toBe("/override/from/env.db")
  })

  test("resolves path using os.homedir() when platform-specific env vars not set", () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true })
    delete process.env.HOME

    const result = getDatabasePath()

    const expectedPath = path.join(os.homedir(), "Library", "Application Support", "opencode", "opencode.db")
    expect(result).toBe(expectedPath)
  })

  test("handles Windows path with os.homedir() fallback", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    delete process.env.APPDATA

    const result = getDatabasePath()

    const expectedPath = path.join(os.homedir(), "AppData", "Roaming", "opencode", "opencode.db")
    expect(result).toBe(expectedPath)
  })
})
