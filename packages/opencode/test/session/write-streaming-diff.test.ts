import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { WriteTool } from "../../src/tool/write"
import { FileTime } from "../../src/file/time"
import { tmpdir } from "../fixture/fixture"

const writeStreamingDiffTest = (name: string, fn: () => void | Promise<unknown>, timeout = 20_000) =>
  test(name, fn, { timeout })

describe("write tool streaming diff", () => {
  writeStreamingDiffTest("ctx.metadata is called with diff before file write", async () => {
    await using tmp = await tmpdir({ git: true })
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "test.txt")
        await fs.writeFile(testFile, "old content\n")
        
        // Read file first to satisfy FileTime check
        await FileTime.read("test-session", testFile)
        
        const toolInfo = await WriteTool.init()
        let metadataCalled = false
        let metadataDiff = ""
        let metadataExistedBeforeWrite = false
        
        const mockCtx = {
          sessionID: "test-session",
          messageID: "test-message",
          agent: "default",
          abort: new AbortController().signal,
          callID: "write-call",
          messages: [],
          extra: {},
          metadata: (input: any) => {
            metadataCalled = true
            metadataDiff = input.metadata.diff
            metadataExistedBeforeWrite = input.metadata.exists
          },
          ask: async () => {},
        } as any
        
        const result = await toolInfo.execute({
          content: "new content\n",
          filePath: testFile,
        }, mockCtx)
        
        expect(metadataCalled).toBe(true)
        expect(metadataDiff).toContain("old content")
        expect(metadataDiff).toContain("new content")
        expect(metadataExistedBeforeWrite).toBe(true)
        expect(result.metadata.diff).toContain("old content")
        expect(result.metadata.diff).toContain("new content")
      },
    })
  })
  
  writeStreamingDiffTest("ctx.metadata includes diff for new files", async () => {
    await using tmp = await tmpdir({ git: true })
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "new-file.txt")
        
        const toolInfo = await WriteTool.init()
        let metadataCalled = false
        let metadataExists = true
        
        const mockCtx = {
          sessionID: "test-session",
          messageID: "test-message",
          agent: "default",
          abort: new AbortController().signal,
          callID: "write-call",
          messages: [],
          extra: {},
          metadata: (input: any) => {
            metadataCalled = true
            metadataExists = input.metadata.exists
          },
          ask: async () => {},
        } as any
        
        await toolInfo.execute({
          content: "brand new file\n",
          filePath: testFile,
        }, mockCtx)
        
        expect(metadataCalled).toBe(true)
        expect(metadataExists).toBe(false)
      },
    })
  })
})
