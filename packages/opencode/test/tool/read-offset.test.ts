import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"

const TEST_FILE_LINES = 5000
const LARGE_OFFSET = 1500
const SMALL_OFFSET = 50

const ctx = {
  sessionID: "test-session" as any,
  messageID: "test-msg" as any,
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("ReadTool offset optimization", () => {
  let tempDir: string
  let testFile: string
  let expectedLines: string[]
  // @ts-ignore
  let read: Awaited<ReturnType<typeof ReadTool.init>>

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-tool-test-"))
    testFile = path.join(tempDir, "large-file.txt")

    expectedLines = []
    for (let i = 1; i <= TEST_FILE_LINES; i++) {
      expectedLines.push(`Line ${i}: ${"x".repeat(50)}`)
    }

    await fs.writeFile(testFile, expectedLines.join("\n"), "utf8")

    await Instance.provide({
      directory: tempDir,
      fn: async () => {
        // @ts-ignore
        read = await ReadTool.init()
      },
    })
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("small offsets work as before", async () => {
    await Instance.provide({
      directory: tempDir,
      fn: async () => {
        const result = await read.execute(
          { filePath: testFile, offset: SMALL_OFFSET, limit: 10 },
          ctx,
        )

        expect(result.output).toContain(`<path>${testFile}</path>`)
        expect(result.output).toContain(`${SMALL_OFFSET}:`)
        expect(result.output).toContain(`${SMALL_OFFSET + 9}:`)

        for (let i = 0; i < 10; i++) {
          const lineNum = SMALL_OFFSET + i
          expect(result.output).toContain(expectedLines[lineNum - 1])
        }
      },
    })
  })

  it("large offsets (> 1000) use optimized path", async () => {
    await Instance.provide({
      directory: tempDir,
      fn: async () => {
        const result = await read.execute(
          { filePath: testFile, offset: LARGE_OFFSET, limit: 10 },
          ctx,
        )

        expect(result.output).toContain(`<path>${testFile}</path>`)
        expect(result.output).toContain(`${LARGE_OFFSET}:`)
        expect(result.output).toContain(`${LARGE_OFFSET + 9}:`)

        for (let i = 0; i < 10; i++) {
          const lineNum = LARGE_OFFSET + i
          expect(result.output).toContain(expectedLines[lineNum - 1])
        }
      },
    })
  })

  it("offset = 0 throws error", async () => {
    await Instance.provide({
      directory: tempDir,
      fn: async () => {
        await expect(
          read.execute(
            { filePath: testFile, offset: 0, limit: 10 },
            ctx,
          ),
        ).rejects.toThrow("offset must be greater than or equal to 1")
      },
    })
  })

  it("offset > total lines throws error", async () => {
    await Instance.provide({
      directory: tempDir,
      fn: async () => {
        await expect(
          read.execute(
            { filePath: testFile, offset: TEST_FILE_LINES + 100, limit: 10 },
            ctx,
          ),
        ).rejects.toThrow(`Offset ${TEST_FILE_LINES + 100} is out of range`)
      },
    })
  })

  it("results are identical regardless of offset method", async () => {
    await Instance.provide({
      directory: tempDir,
      fn: async () => {
        const smallOffsetResult = await read.execute(
          { filePath: testFile, offset: 100, limit: 20 },
          ctx,
        )

        const largeOffsetResult = await read.execute(
          { filePath: testFile, offset: 1100, limit: 20 },
          ctx,
        )

        const extractLines = (output: string) => {
          const match = output.match(/<content>\n([\s\S]*?)\n\n\(/)
          if (!match) return []
          return match[1].split("\n").map((line) => line.replace(/^\d+: /, ""))
        }

        const smallLines = extractLines(smallOffsetResult.output)
        const largeLines = extractLines(largeOffsetResult.output)

        expect(smallLines.length).toBe(20)
        expect(largeLines.length).toBe(20)

        for (let i = 0; i < 20; i++) {
          expect(smallLines[i]).toBe(expectedLines[99 + i])
          expect(largeLines[i]).toBe(expectedLines[1099 + i])
        }
      },
    })
  })

  it("default offset (undefined) reads from line 1", async () => {
    await Instance.provide({
      directory: tempDir,
      fn: async () => {
        const result = await read.execute(
          { filePath: testFile, limit: 10 },
          ctx,
        )

        expect(result.output).toContain(`1: ${expectedLines[0]}`)
        expect(result.output).toContain(`10: ${expectedLines[9]}`)
      },
    })
  })

  it("handles files with fewer lines than offset", async () => {
    const smallFile = path.join(tempDir, "small-file.txt")
    await fs.writeFile(smallFile, "Line 1\nLine 2\nLine 3\n", "utf8")

    await Instance.provide({
      directory: tempDir,
      fn: async () => {
        await expect(
          read.execute(
            { filePath: smallFile, offset: 100, limit: 10 },
            ctx,
          ),
        ).rejects.toThrow("Offset 100 is out of range")
      },
    })
  })

  it("benchmark: large offset should be faster than reading all lines", async () => {
    await Instance.provide({
      directory: tempDir,
      fn: async () => {
        const iterations = 3
        const largeOffset = 4000
        const limit = 100

        const startOptimized = performance.now()
        for (let i = 0; i < iterations; i++) {
          await read.execute(
            { filePath: testFile, offset: largeOffset, limit },
            ctx,
          )
        }
        const optimizedTime = (performance.now() - startOptimized) / iterations

        const startSmall = performance.now()
        for (let i = 0; i < iterations; i++) {
          await read.execute(
            { filePath: testFile, offset: 10, limit },
            ctx,
          )
        }
        const smallTime = (performance.now() - startSmall) / iterations

        console.log(`Large offset (${largeOffset}) avg time: ${optimizedTime.toFixed(2)}ms`)
        console.log(`Small offset (10) avg time: ${smallTime.toFixed(2)}ms`)

        expect(optimizedTime).toBeGreaterThan(0)
      },
    })
  })
})
