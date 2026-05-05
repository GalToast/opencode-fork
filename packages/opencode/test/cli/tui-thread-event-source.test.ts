import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packageRoot = path.resolve(import.meta.dir, "..", "..")

async function runThreadHelper(code: string) {
  const scriptPath = path.join(packageRoot, `tmp-thread-helper-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`)
  await Bun.write(scriptPath, code)
  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", scriptPath],
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })

    const stdout = new TextDecoder().decode(result.stdout).trim()
    const stderr = new TextDecoder().decode(result.stderr).trim()

    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })

    const sentinel = "__THREAD_JSON__"
    const sentinelIndex = stdout.lastIndexOf(sentinel)
    if (sentinelIndex < 0) throw new Error(`Thread helper completed without a JSON payload. stdout=${stdout}`)
    return JSON.parse(stdout.slice(sentinelIndex + sentinel.length).trim())
  } finally {
    await fs.rm(scriptPath, { force: true }).catch(() => {})
  }
}

describe("tui thread event source", () => {
  test("forwards worker and local bus events through one event source", async () => {
    const result = await runThreadHelper(`
      import { createEventSource } from "./src/cli/cmd/tui/event-source.ts"

      const workerHandlers = new Set<(event: any) => void>()
      const globalHandlers = new Set<(entry: { directory?: string; payload: unknown }) => void>()
      const received: any[] = []

      const source = createEventSource(
        {
          on: (_event, handler) => {
            workerHandlers.add(handler)
            return () => workerHandlers.delete(handler)
          },
        },
        { globalBus: {
            on: (_event, handler) => void globalHandlers.add(handler),
            off: (_event, handler) => void globalHandlers.delete(handler),
          } },
      )

      const stop = source.on((event) => received.push(event))
      const workerEvent = { type: "message.updated", properties: { info: { id: "msg-1", sessionID: "ses-1" as any, role: "assistant" } } }
      const localEvent = { type: "message.part.delta", properties: { sessionID: "ses-1" as any, messageID: "msg-1" as any, partID: "part-1", field: "text", delta: "hi" } }

      for (const handler of workerHandlers) handler(workerEvent)
      for (const handler of globalHandlers) handler({ directory: "C:/repo", payload: localEvent })
      stop()

      console.log("__THREAD_JSON__" + JSON.stringify(received))
    `)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe("message.updated")
    expect(result[1].type).toBe("message.part.delta")
  })

  test("dedupes identical events mirrored from worker and local bus", async () => {
    const result = await runThreadHelper(`
      import { createEventSource } from "./src/cli/cmd/tui/event-source.ts"

      const workerHandlers = new Set<(event: any) => void>()
      const globalHandlers = new Set<(entry: { directory?: string; payload: unknown }) => void>()
      const received: any[] = []

      const source = createEventSource(
        {
          on: (_event, handler) => {
            workerHandlers.add(handler)
            return () => workerHandlers.delete(handler)
          },
        },
        { globalBus: {
            on: (_event, handler) => void globalHandlers.add(handler),
            off: (_event, handler) => void globalHandlers.delete(handler),
          } },
      )

      const stop = source.on((event) => received.push(event))
      const event = { type: "message.part.delta", properties: { sessionID: "ses-1" as any, messageID: "msg-1" as any, partID: "part-1", field: "text", delta: "hi" } }

      for (const handler of workerHandlers) handler(event)
      for (const handler of globalHandlers) handler({ directory: "C:/repo", payload: event })
      stop()

      console.log("__THREAD_JSON__" + JSON.stringify(received))
    `)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("message.part.delta")
  })

  test("filters unrelated global-bus directories", async () => {
    const result = await runThreadHelper(`
      import { createEventSource } from "./src/cli/cmd/tui/event-source.ts"

      const workerHandlers = new Set<(event: any) => void>()
      const globalHandlers = new Set<(entry: { directory?: string; payload: unknown }) => void>()
      const received: any[] = []

      const source = createEventSource(
        {
          on: (_event, handler) => {
            workerHandlers.add(handler)
            return () => workerHandlers.delete(handler)
          },
        },
        {
          directory: "C:/repo-a",
          globalBus: {
            on: (_event, handler) => void globalHandlers.add(handler),
            off: (_event, handler) => void globalHandlers.delete(handler),
          },
        },
      )

      const stop = source.on((event) => received.push(event))
      const payload = { type: "message.part.delta", properties: { sessionID: "ses-1" as any, messageID: "msg-1" as any, partID: "part-1", field: "text", delta: "hi" } }

      for (const handler of globalHandlers) handler({ directory: "C:/repo-b", payload })
      for (const handler of globalHandlers) handler({ directory: "C:/repo-a", payload })
      stop()

      console.log("__THREAD_JSON__" + JSON.stringify(received))
    `)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("message.part.delta")
  })
})
