import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { ReadTool } from "../../src/tool/read"
import { FileTime } from "../../src/file/time"
import { tmpdir } from "../fixture/fixture"

describe("apply_patch FileTime integration", () => {
  test("throws if file hasn't been read before applying patch update", async () => {
    await using tmp = await tmpdir({ git: true })
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "test.txt")
        await fs.writeFile(testFile, "old line 1\nold line 2\n")
        
        const toolInfo = await ApplyPatchTool.init()
        const mockCtx = {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          agent: "default",
          abort: new AbortController().signal,
          callID: "patch-call",
          messages: [],
          extra: {},
          metadata: () => {},
          ask: async () => {},
        } as any
        
        const patch = "*** Begin Patch\n*** Update File: test.txt\n@@\n old line 1\n-old line 2\n+new line 2\n*** End Patch"
        
        await expect(
          toolInfo.execute({ patchText: patch }, mockCtx),
        ).rejects.toThrow("You must read file")
      },
    })
  })

  test("succeeds if file has been read before applying patch update", async () => {
    await using tmp = await tmpdir({ git: true })
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "test.txt")
        await fs.writeFile(testFile, "old line 1\nold line 2\n")
        
        // @ts-ignore
        const readTool = await ReadTool.init()
        await readTool.execute({ filePath: testFile }, {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          agent: "default",
          abort: new AbortController().signal,
          callID: "read-call",
          messages: [],
          extra: {},
          metadata: () => {},
          ask: async () => {},
        } as any)
        
        const toolInfo = await ApplyPatchTool.init()
        const mockCtx = {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          agent: "default",
          abort: new AbortController().signal,
          callID: "patch-call",
          messages: [],
          extra: {},
          metadata: () => {},
          ask: async () => {},
        } as any
        
        const patch = "*** Begin Patch\n*** Update File: test.txt\n@@\n old line 1\n-old line 2\n+new line 2\n*** End Patch"
        
        const result = await toolInfo.execute({ patchText: patch }, mockCtx)
        
        expect(result.output).toContain("Updated")
        
        const content = await fs.readFile(testFile, "utf-8")
        expect(content).toContain("new line 2")
        expect(content).not.toContain("old line 2")
      },
    })
  })

  test("throws if file hasn't been read before applying patch delete", async () => {
    await using tmp = await tmpdir({ git: true })
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "test.txt")
        await fs.writeFile(testFile, "content to delete\n")
        
        const toolInfo = await ApplyPatchTool.init()
        const mockCtx = {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          agent: "default",
          abort: new AbortController().signal,
          callID: "patch-call",
          messages: [],
          extra: {},
          metadata: () => {},
          ask: async () => {},
        } as any
        
        const patch = "*** Begin Patch\n*** Delete File: test.txt\n*** End Patch"
        
        await expect(
          toolInfo.execute({ patchText: patch }, mockCtx),
        ).rejects.toThrow("You must read file")
      },
    })
  })

  test("FileTime.read is called after add operation", async () => {
    await using tmp = await tmpdir({ git: true })
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "new-file.txt")
        
        const toolInfo = await ApplyPatchTool.init()
        const mockCtx = {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          agent: "default",
          abort: new AbortController().signal,
          callID: "patch-call",
          messages: [],
          extra: {},
          metadata: () => {},
          ask: async () => {},
        } as any
        
        const patch = "*** Begin Patch\n*** Add File: new-file.txt\n+line 1\n+line 2\n*** End Patch"
        
        await toolInfo.execute({ patchText: patch }, mockCtx)
        
        // @ts-ignore
        const time = FileTime["get"]("test-session", testFile)
        expect(time).toBeDefined()
        
        const content = await fs.readFile(testFile, "utf-8")
        expect(content).toContain("line 1")
        expect(content).toContain("line 2")
      },
    })
  })
})