import { describe, test, expect, mock, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { SearchReplaceTool } from "../../src/tool/search_replace"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test-search-replace" as any,
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.search_replace", () => {
  afterEach(() => {
    mock.restore()
  })

  test("replaces pattern across multiple files", async () => {
    await using tmp = await tmpdir()
    const file1 = path.join(tmp.path, "file1.ts")
    const file2 = path.join(tmp.path, "file2.ts")
    const file3 = path.join(tmp.path, "ignore.js")
    
    await fs.writeFile(file1, "const MY_VAR = 1;\nconsole.log(MY_VAR);", "utf-8")
    await fs.writeFile(file2, "function test() { return MY_VAR; }", "utf-8")
    await fs.writeFile(file3, "const MY_VAR = 1;", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sr = await SearchReplaceTool.init()
        const result = await sr.execute(
          {
            pattern: "MY_VAR",
            replacement: "NEW_VAR",
            glob: "**/*.ts",
          },
          // @ts-ignore
          ctx,
        )

        expect(result.metadata.filesChanged).toBe(2)
        expect(result.metadata.dryRun).toBe(false)
        expect(result.metadata.matchCount).toBe(3) // 2 in file1, 1 in file2
        
        const c1 = await fs.readFile(file1, "utf-8")
        expect(c1).toBe("const NEW_VAR = 1;\nconsole.log(NEW_VAR);")
        
        const c2 = await fs.readFile(file2, "utf-8")
        expect(c2).toBe("function test() { return NEW_VAR; }")
        
        const c3 = await fs.readFile(file3, "utf-8")
        expect(c3).toBe("const MY_VAR = 1;")
      },
    })
  })

  test("dryRun previews changes without applying", async () => {
    await using tmp = await tmpdir()
    const file1 = path.join(tmp.path, "file1.ts")
    const file2 = path.join(tmp.path, "file2.ts")
    
    const originalContent1 = "const OLD_NAME = 1;\nconsole.log(OLD_NAME);"
    const originalContent2 = "function test() { return OLD_NAME; }"
    
    await fs.writeFile(file1, originalContent1, "utf-8")
    await fs.writeFile(file2, originalContent2, "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sr = await SearchReplaceTool.init()
        const result = await sr.execute(
          {
            pattern: "OLD_NAME",
            replacement: "NEW_NAME",
            glob: "**/*.ts",
            dryRun: true,
          },
          // @ts-ignore
          ctx,
        )

        // Metadata should show dryRun and matches
        expect(result.metadata.dryRun).toBe(true)
        expect(result.metadata.filesChanged).toBe(2)
        expect(result.metadata.matchCount).toBe(3)
        
        // Title should indicate preview
        expect(result.title).toContain("Preview")
        
        // Output should show [DRY RUN]
        expect(result.output).toContain("[DRY RUN]")
        expect(result.output).toContain("Would update 2 files")
        
        // Files should NOT be changed
        const c1 = await fs.readFile(file1, "utf-8")
        const c2 = await fs.readFile(file2, "utf-8")
        expect(c1).toBe(originalContent1)
        expect(c2).toBe(originalContent2)
      },
    })
  })
})
