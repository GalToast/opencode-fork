import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { mkdir, readFile, rm } from "fs/promises"
import {
  heartbeatRuntimeRegistryEntry,
  removeRuntimeRegistryEntry,
  startRuntimeRegistryHeartbeat,
  upsertRuntimeRegistryEntry,
} from "../../../../src/cli/cmd/tui/runtime-registry"

const runtimeRegistryPath = path.join(process.cwd(), "tmp", "tui-runtime-registry.test.json")
const originalRegistry = process.env.OPENCODE_RUNTIME_REGISTRY
const originalRuntimeID = process.env.OPENCODE_RUNTIME_ID
const originalRuntimeRole = process.env.OPENCODE_RUNTIME_ROLE

async function readEntries() {
  const raw = await readFile(runtimeRegistryPath, "utf8")
  return JSON.parse(raw).entries as Array<{
    runtimeID: string
    pid: number
    ppid: number
    role: string
    startedAt: number
    lastHeartbeatAt: number
    directory?: string
  }>
}

describe("tui runtime registry", () => {
  beforeEach(async () => {
    process.env.OPENCODE_RUNTIME_REGISTRY = runtimeRegistryPath
    process.env.OPENCODE_RUNTIME_ID = "test-runtime"
    process.env.OPENCODE_RUNTIME_ROLE = "tui_supervisor"
    await mkdir(path.dirname(runtimeRegistryPath), { recursive: true })
    await rm(runtimeRegistryPath, { force: true }).catch(() => undefined)
  })

  afterEach(async () => {
    if (originalRegistry === undefined) delete process.env.OPENCODE_RUNTIME_REGISTRY
    else process.env.OPENCODE_RUNTIME_REGISTRY = originalRegistry
    if (originalRuntimeID === undefined) delete process.env.OPENCODE_RUNTIME_ID
    else process.env.OPENCODE_RUNTIME_ID = originalRuntimeID
    if (originalRuntimeRole === undefined) delete process.env.OPENCODE_RUNTIME_ROLE
    else process.env.OPENCODE_RUNTIME_ROLE = originalRuntimeRole
    await rm(runtimeRegistryPath, { force: true }).catch(() => undefined)
  })

  test("upserts and heartbeats a runtime entry", async () => {
    await upsertRuntimeRegistryEntry({ directory: "/repo" })
    const first = await readEntries()
    expect(first).toHaveLength(1)
    expect(first[0]?.directory).toBe("/repo")
    const startedAt = first[0]?.startedAt ?? 0
    const firstHeartbeat = first[0]?.lastHeartbeatAt ?? 0

    await Bun.sleep(5)
    await heartbeatRuntimeRegistryEntry()
    const second = await readEntries()
    expect(second).toHaveLength(1)
    expect(second[0]?.startedAt).toBe(startedAt)
    expect((second[0]?.lastHeartbeatAt ?? 0) >= firstHeartbeat).toBe(true)
  })

  test("removes the current runtime entry", async () => {
    await upsertRuntimeRegistryEntry({ directory: "/repo" })
    await removeRuntimeRegistryEntry()
    await expect(readFile(runtimeRegistryPath, "utf8")).rejects.toThrow()
  })

  test("heartbeat helper registers and unregisters on stop", async () => {
    const handle = startRuntimeRegistryHeartbeat({ directory: "/repo", intervalMS: 10 })
    await Bun.sleep(20)
    expect((await readEntries())[0]?.runtimeID).toBe("test-runtime")
    await handle.stop()
    await expect(readFile(runtimeRegistryPath, "utf8")).rejects.toThrow()
  })
})
