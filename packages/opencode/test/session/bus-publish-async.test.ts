import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { WriteTool } from "../../src/tool/write"
import { ReadTool } from "../../src/tool/read"
import { tmpdir } from "../fixture/fixture"

describe("bus publish fire-and-forget", () => {
  test("write tool does not await Bus.publish events", async () => {
    await using tmp = await tmpdir({ git: true })
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "test.txt")
        await fs.writeFile(testFile, "old content\n")
        
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
        
        const toolInfo = await WriteTool.init()
        const mockCtx = {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          agent: "default",
          abort: new AbortController().signal,
          callID: "write-call",
          messages: [],
          extra: {},
          metadata: () => {},
          ask: async () => {},
        } as any
        
        const result = await toolInfo.execute({
          content: "new content\n",
          filePath: testFile,
        }, mockCtx)
        
        expect(result.output).toContain("Wrote file successfully")
        // @ts-ignore
        expect(result.metadata.diff).toContain("new content")
      },
    })
  })
  
  test("write tool completes quickly without waiting for bus handlers", async () => {
    await using tmp = await tmpdir({ git: true })
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "test.txt")
        await fs.writeFile(testFile, "content\n")
        
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
        
        const start = Date.now()
        
        const toolInfo = await WriteTool.init()
        const mockCtx = {
          sessionID: "test-session" as any,
          messageID: "test-message" as any,
          agent: "default",
          abort: new AbortController().signal,
          callID: "write-call",
          messages: [],
          extra: {},
          metadata: () => {},
          ask: async () => {},
        } as any
        
        await toolInfo.execute({
          content: "updated content\n",
          filePath: testFile,
        }, mockCtx)
        
        const duration = Date.now() - start
        
        console.log("write tool duration:", duration, "ms")
        expect(duration).toBeLessThan(2000)
      },
    })
  })
})