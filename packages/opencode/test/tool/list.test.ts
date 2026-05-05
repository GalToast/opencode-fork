import { describe, expect, test } from "bun:test"
import path from "path"
import { ListTool } from "../../src/tool/ls"
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

describe("tool.list", () => {
  test("renders a tree and honors default ignore patterns", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "src", "index.ts"), "export const value = 1")
        await Bun.write(path.join(dir, "src", "nested", "child.ts"), "export const child = 1")
        await Bun.write(path.join(dir, "node_modules", "left-pad", "index.js"), "module.exports = {}")
        await Bun.write(path.join(dir, "dist", "bundle.js"), "console.log('built')")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        // @ts-ignore
        const result = await list.execute({ path: tmp.path }, ctx)

        expect(result.metadata.count).toBe(2)
        expect(result.metadata.truncated).toBe(false)
        expect(result.output).toContain(`${tmp.path}/`)
        expect(result.output).toContain("src/")
        expect(result.output).toContain("index.ts")
        expect(result.output).toContain("nested/")
        expect(result.output).toContain("child.ts")
        expect(result.output).not.toContain("node_modules/")
        expect(result.output).not.toContain("dist/")
      },
    })
  })

  test("applies caller-provided ignore globs", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "docs", "keep.txt"), "keep")
        await Bun.write(path.join(dir, "docs", "skip.md"), "skip")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        // @ts-ignore
        const result = await list.execute({ path: tmp.path, ignore: ["docs/*.md"] }, ctx)

        expect(result.output).toContain("keep.txt")
        expect(result.output).not.toContain("skip.md")
      },
    })
  })

  test("marks output as truncated after the tree limit", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Promise.all(
          Array.from({ length: 101 }, (_, i) => Bun.write(path.join(dir, `file-${i.toString().padStart(3, "0")}.txt`), "x")),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        // @ts-ignore
        const result = await list.execute({ path: tmp.path }, ctx)

        expect(result.metadata.count).toBe(100)
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("file-001.txt")
        expect(result.output).toContain("file-100.txt")
        expect(result.output).not.toContain("file-101.txt")
      },
    })
  })
})
