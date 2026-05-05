import { describe, expect, test, spyOn, beforeAll, afterAll } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { WriteTool } from "../../src/tool/write"
import { LSP } from "../../src/lsp"
import { FileTime } from "../../src/file/time"
import { tmpdir } from "../fixture/fixture"

describe("LSP diagnostics timeout", () => {
  test("write tool completes even when LSP.diagnostics() is slow", async () => {
    await using tmp = await tmpdir({ git: true })
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "test.txt")
        await fs.writeFile(testFile, "old content\n")
        
        await FileTime.read("test-session" as any, testFile)
        
        const slowDiagnostics = spyOn(LSP, "diagnostics").mockImplementation(
          () => new Promise(resolve => setTimeout(() => resolve({}), 10000))
        )
        
        try {
          const start = Date.now()
          const toolInfo = await WriteTool.init()
          const result = await toolInfo.execute({
            content: "new content\n",
            filePath: testFile,
          }, {
            sessionID: "test-session" as any,
            messageID: "test-message" as any,
            agent: "default",
            abort: new AbortController().signal,
            callID: "write-call",
            messages: [],
            extra: {},
            metadata: () => {},
            ask: async () => {},
          } as any)
          const elapsed = Date.now() - start
          
          expect(result.output).toContain("Wrote file successfully")
          expect(elapsed).toBeLessThan(2000)
        } finally {
          slowDiagnostics.mockRestore()
        }
      },
    })
  })

  test("write tool includes diagnostics when LSP responds quickly", async () => {
    await using tmp = await tmpdir({ git: true })
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "test.ts")
        await fs.writeFile(testFile, "old content\n")
        
        await FileTime.read("test-session" as any, testFile)
        
        const fastDiagnostics = spyOn(LSP, "diagnostics").mockResolvedValue({
          [testFile]: [{
            severity: 1,
            message: "Test error",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          }],
        })
        
        try {
          const toolInfo = await WriteTool.init()
          const result = await toolInfo.execute({
            content: "new content\n",
            filePath: testFile,
          }, {
            sessionID: "test-session" as any,
            messageID: "test-message" as any,
            agent: "default",
            abort: new AbortController().signal,
            callID: "write-call",
            messages: [],
            extra: {},
            metadata: () => {},
            ask: async () => {},
          } as any)
          
          expect(result.output).toContain("Wrote file successfully")
          expect(result.output).toContain("LSP errors")
          expect(result.output).toContain("Test error")
        } finally {
          fastDiagnostics.mockRestore()
        }
      },
    })
  })

  test("write tool handles LSP.diagnostics() rejection gracefully", async () => {
    await using tmp = await tmpdir({ git: true })
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "test.txt")
        await fs.writeFile(testFile, "old content\n")
        
        await FileTime.read("test-session" as any, testFile)
        
        const failingDiagnostics = spyOn(LSP, "diagnostics").mockRejectedValue(
          new Error("LSP server crashed")
        )
        
        try {
          const toolInfo = await WriteTool.init()
          const result = await toolInfo.execute({
            content: "new content\n",
            filePath: testFile,
          }, {
            sessionID: "test-session" as any,
            messageID: "test-message" as any,
            agent: "default",
            abort: new AbortController().signal,
            callID: "write-call",
            messages: [],
            extra: {},
            metadata: () => {},
            ask: async () => {},
          } as any)
          
          expect(result.output).toContain("Wrote file successfully")
          expect(result.output).not.toContain("LSP server crashed")
        } finally {
          failingDiagnostics.mockRestore()
        }
      },
    })
  })
})
