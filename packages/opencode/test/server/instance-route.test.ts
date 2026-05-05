import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("instance diagnostics route", () => {
  test("reports cached workspace instances and initialized state counts", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    await Instance.provide({
      directory: first.path,
      fn: async () => undefined,
    })
    await Instance.provide({
      directory: second.path,
      fn: async () => undefined,
    })

    const response = await Server.App().request(`/instance/status?directory=${encodeURIComponent(first.path)}`)
    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      count: number
      activeDirectory?: string
      entries: Array<{
        directory: string
        worktree: string
        projectID: string
        createdAt: number
        lastAccessAt: number
        stateCount: number
        stateKeys: string[]
        pendingStateCount: number
        disposableStateCount: number
      }>
    }

    expect(payload.count).toBeGreaterThanOrEqual(2)
    expect(payload.activeDirectory).toBe(first.path)
    expect(payload.entries.some((entry) => entry.directory === first.path)).toBe(true)
    expect(payload.entries.some((entry) => entry.directory === second.path)).toBe(true)

    const firstEntry = payload.entries.find((entry) => entry.directory === first.path)
    expect(firstEntry).toBeDefined()
    expect(firstEntry!.projectID.length).toBeGreaterThan(0)
    expect(firstEntry!.stateCount).toBeGreaterThanOrEqual(0)
    expect(firstEntry!.pendingStateCount).toBeGreaterThanOrEqual(0)
    expect(firstEntry!.disposableStateCount).toBeGreaterThanOrEqual(0)
  })
})
