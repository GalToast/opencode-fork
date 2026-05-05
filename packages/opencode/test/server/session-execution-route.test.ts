import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { ExecutionLedger } from "../../src/execution/ledger"
import { tmpdir } from "../fixture/fixture"

describe("session.execution route", () => {
  test("returns only execution events for the requested session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "owner" })
        const other = await Session.create({ title: "other" })

        await ExecutionLedger.append({
          jobID: "job_session_one",
          sessionID: session.id,
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          phase: "queued",
          status: "queued",
          description: "session event",
          time: 10,
          source: "scheduler",
        })
        await ExecutionLedger.append({
          jobID: "job_session_two",
          sessionID: other.id,
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          phase: "completed",
          status: "completed",
          description: "other event",
          time: 20,
          source: "scheduler",
        })

        const response = await Server.App().request(`/session/${session.id}/execution`)
        expect(response.status).toBe(200)

        const payload = (await response.json()) as {
          sessionID: string
          total: number
          events: Array<{ sessionID: string; description: string }>
        }
        expect(payload.sessionID).toBe(session.id)
        expect(payload.total).toBe(1)
        expect(payload.events).toHaveLength(1)
        expect(payload.events[0]?.sessionID).toBe(session.id)
        expect(payload.events[0]?.description).toBe("session event")
      },
    })
  })

  test("applies execution filters and limit", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "filterable" })

        await ExecutionLedger.append({
          jobID: "job_filter_one",
          sessionID: session.id,
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          phase: "queued",
          status: "queued",
          description: "queued event",
          time: 10,
          source: "scheduler",
        })
        await ExecutionLedger.append({
          jobID: "job_filter_one",
          sessionID: session.id,
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          phase: "completed",
          status: "completed",
          description: "completed event",
          time: 20,
          source: "scheduler",
        })

        const response = await Server.App().request(
          `/session/${session.id}/execution?phase=completed&limit=1&order=desc`,
        )
        expect(response.status).toBe(200)

        const payload = (await response.json()) as {
          total: number
          events: Array<{ phase: string; description: string }>
        }
        expect(payload.total).toBe(1)
        expect(payload.events).toHaveLength(1)
        expect(payload.events[0]?.phase).toBe("completed")
        expect(payload.events[0]?.description).toBe("completed event")
      },
    })
  })

  test("returns 404 for unknown sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/session/ses_missing/execution")
        expect(response.status).toBe(404)
      },
    })
  })
})
