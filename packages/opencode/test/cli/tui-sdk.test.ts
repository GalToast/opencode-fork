import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packageRoot = path.resolve(import.meta.dir, "..", "..")

async function runSdkHelper(code: string) {
  const scriptPath = path.join(packageRoot, `tmp-sdk-helper-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`)
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

    const sentinel = "__SDK_JSON__"
    const sentinelIndex = stdout.lastIndexOf(sentinel)
    if (sentinelIndex < 0) throw new Error(`SDK helper completed without a JSON payload. stdout=${stdout}`)
    return JSON.parse(stdout.slice(sentinelIndex + sentinel.length).trim())
  } finally {
    await fs.rm(scriptPath, { force: true }).catch(() => {})
  }
}

describe("tui sdk event coalescing", () => {
  test("coalesces repeated message.part.delta chunks for the same part field", async () => {
    const result = await runSdkHelper(`
      import { coalesceQueuedEvents } from "./src/cli/cmd/tui/context/sdk.tsx"

      const output = coalesceQueuedEvents([
        {
          type: "message.part.delta",
          properties: { messageID: "msg-1" as any, partID: "part-1", field: "text", delta: "hel" },
        },
        {
          type: "message.part.delta",
          properties: { messageID: "msg-1" as any, partID: "part-1", field: "text", delta: "lo" },
        },
        {
          type: "message.part.delta",
          properties: { messageID: "msg-1" as any, partID: "part-2", field: "text", delta: "world" },
        },
      ])
      console.log("__SDK_JSON__" + JSON.stringify(output))
    `)

    expect(result).toHaveLength(2)
    expect(result[0].properties.delta).toBe("hello")
    expect(result[1].properties.delta).toBe("world")
  })

  test("does not merge across a non-delta barrier", async () => {
    const result = await runSdkHelper(`
      import { coalesceQueuedEvents } from "./src/cli/cmd/tui/context/sdk.tsx"

      const output = coalesceQueuedEvents([
        {
          type: "message.part.delta",
          properties: { messageID: "msg-1" as any, partID: "part-1", field: "text", delta: "hel" },
        },
        {
          type: "message.part.updated",
          properties: {
            part: { id: "part-1", messageID: "msg-1" as any, sessionID: "ses-1" as any, type: "text", text: "hel" },
          },
        },
        {
          type: "message.part.delta",
          properties: { messageID: "msg-1" as any, partID: "part-1", field: "text", delta: "lo" },
        },
      ])
      console.log("__SDK_JSON__" + JSON.stringify(output))
    `)

    expect(result).toHaveLength(3)
    expect(result[0].properties.delta).toBe("hel")
    expect(result[2].properties.delta).toBe("lo")
  })
})
