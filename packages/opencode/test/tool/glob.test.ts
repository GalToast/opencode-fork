import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { GlobTool } from "../../src/tool/glob"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test" as any,
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.glob", () => {
  test("returns absolute matches sorted by most-recent mtime first", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const older = path.join(dir, "older.ts")
        const newer = path.join(dir, "newer.ts")
        await Bun.write(older, "export const older = true")
        await Bun.write(newer, "export const newer = true")

        const base = new Date("2026-01-01T00:00:00.000Z")
        await fs.utimes(older, base, base)
        await fs.utimes(newer, new Date(base.getTime() + 60_000), new Date(base.getTime() + 60_000))
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const glob = await GlobTool.init()
        // @ts-ignore
        const result = await glob.execute({ pattern: "*.ts", path: tmp.path }, ctx)
        const lines = result.output.split("\n")

        expect(result.metadata.count).toBe(2)
        expect(result.metadata.truncated).toBe(false)
        expect(lines[0]).toBe(path.join(tmp.path, "newer.ts"))
        expect(lines[1]).toBe(path.join(tmp.path, "older.ts"))
      },
    })
  })

  test("reports when no files match", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.txt"), "hello")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const glob = await GlobTool.init()
        // @ts-ignore
        const result = await glob.execute({ pattern: "*.ts", path: tmp.path }, ctx)

        expect(result.metadata.count).toBe(0)
        expect(result.metadata.truncated).toBe(false)
        expect(result.output).toBe("No files found")
      },
    })
  })

  test("adds truncation guidance when matches exceed the limit", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Promise.all(
          Array.from({ length: 101 }, (_, i) => Bun.write(path.join(dir, `match-${i.toString().padStart(3, "0")}.ts`), "export {}")),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const glob = await GlobTool.init()
        // @ts-ignore
        const result = await glob.execute({ pattern: "*.ts", path: tmp.path }, ctx)

        expect(result.metadata.count).toBe(100)
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("(Results are truncated: showing first 100 results.")
      },
    })
  })
})
