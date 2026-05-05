import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { SchedulerControl } from "../../src/scheduler/control-plane"
import { ExecutionLedger } from "../../src/execution/ledger"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"
import { Bus } from "../../src/bus"

async function waitFor(assertion: () => Promise<void>, attempts = 30, delayMS = 25) {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await Bun.sleep(delayMS)
    }
  }
  throw lastError
}

describe("scheduler execution ledger", () => {
  test("publishes an append event after persisting ledger entries", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const seen: Array<unknown> = []
        const unsub = Bus.subscribe(ExecutionLedger.BusEvent.Appended, (event) => {
          seen.push(event.properties.event)
        })

        try {
          const appended = await ExecutionLedger.append({
            jobID: "job_bus",
            sessionID: "session_ledger_bus" as any,
            kind: "prompt",
            lane: "main_turns",
            priority: "normal",
            phase: "queued",
            status: "queued",
            description: "bus event",
            time: 5,
            source: "scheduler",
          })

          expect(seen).toHaveLength(1)
          expect(seen[0]).toMatchObject({
            id: appended.id,
            jobID: "job_bus",
            phase: "queued",
          })
        } finally {
          unsub()
        }
      },
    })
  })

  test("records queued to completed lifecycle events", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.setLanePaused("main_turns", true)
        const submitted = await SchedulerControl.submit({
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          sessionID: "session_ledger_lifecycle" as any,
          description: "ledger lifecycle",
          waitForResult: false,
          run: async () => "ok",
        })

        expect((await ExecutionLedger.list({ jobID: submitted.jobID })).map((event) => event.phase)).toEqual(["queued"])

        await SchedulerControl.setLanePaused("main_turns", false)

        await waitFor(async () => {
          const phases = (await ExecutionLedger.list({ jobID: submitted.jobID })).map((event) => event.phase)
          expect(phases).toEqual(["queued", "dispatched", "running", "completed"])
        })
      },
    })
  })

  test("records cancel events for queued jobs", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.setLanePaused("main_turns", true)
        const submitted = await SchedulerControl.submit({
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          sessionID: "session_ledger_cancel" as any,
          description: "ledger cancel",
          waitForResult: false,
          run: async () => "ok",
        })

        await SchedulerControl.cancelSession({ sessionID: "session_ledger_cancel" as any })

        const events = await ExecutionLedger.list({ jobID: submitted.jobID })
        expect(events.map((event) => event.phase)).toEqual(["queued", "canceled"])
        expect(events.at(-1)?.error).toContain("Canceled for session")
      },
    })
  })

  test("records recovered events when durable jobs are requeued on restart", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.setLanePaused("main_turns", true)
        await SchedulerControl.submit({
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          sessionID: "session_ledger_recovery" as any,
          description: "ledger recovery",
          waitForResult: false,
          durable: true,
          resume: {
            key: "scheduler.execution-ledger.resume",
            payload: { ok: true },
          },
          run: async () => "queued-first-run",
        })
      },
    })
    await Instance.disposeAll()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SchedulerControl.registerResumeHandler("scheduler.execution-ledger.resume", async () => "recovered-run")

        await waitFor(async () => {
          await SchedulerControl.getStatus()
          const recovered = await ExecutionLedger.list({
            sessionID: "session_ledger_recovery" as any,
            phase: "recovered",
          })
          expect(recovered).toHaveLength(1)
        })
      },
    })
    await Instance.disposeAll()
  })

  test("keeps durable jobs pending until a resume handler registers after restart", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.setLanePaused("main_turns", true)
        await SchedulerControl.submit({
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          sessionID: "session_ledger_late_resume" as any,
          description: "late resume recovery",
          waitForResult: false,
          durable: true,
          resume: {
            key: "scheduler.execution-ledger.late",
            payload: { ok: true },
          },
          run: async () => "queued-first-run",
        })
      },
    })
    await Instance.disposeAll()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const before = await SchedulerControl.getStatus()
        expect(before.lanes.find((lane) => lane.lane === "main_turns")?.queued).toBe(0)

        SchedulerControl.registerResumeHandler("scheduler.execution-ledger.late", async () => "recovered-late-run")

        await waitFor(async () => {
          const recovered = await ExecutionLedger.list({
            sessionID: "session_ledger_late_resume" as any,
            phase: "recovered",
          })
          expect(recovered).toHaveLength(1)
        })

        await waitFor(async () => {
          const completed = await ExecutionLedger.list({
            sessionID: "session_ledger_late_resume" as any,
            phase: "completed",
          })
          expect(completed).toHaveLength(1)
        })
      },
    })
    await Instance.disposeAll()
  })

  test("query filters by session and clamps limit safely", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const scoped = await Session.create({ title: "scoped" })
        const other = await Session.create({ title: "other" })
        await ExecutionLedger.append({
          jobID: "job_one",
          sessionID: scoped.id,
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          phase: "queued",
          status: "queued",
          description: "first",
          time: 10,
          source: "scheduler",
        })
        await ExecutionLedger.append({
          jobID: "job_one",
          sessionID: scoped.id,
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          phase: "completed",
          status: "completed",
          description: "second",
          time: 20,
          source: "scheduler",
        })
        await ExecutionLedger.append({
          jobID: "job_two",
          sessionID: other.id,
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          phase: "completed",
          status: "completed",
          description: "other session",
          time: 30,
          source: "scheduler",
        })

        const timeline = await ExecutionLedger.query({
          sessionID: scoped.id,
          order: "desc",
          limit: 999,
        })

        expect(timeline.total).toBe(2)
        expect(timeline.events).toHaveLength(2)
        expect(timeline.events.map((event) => event.description)).toEqual(["second", "first"])

        const filtered = await ExecutionLedger.query({
          sessionID: scoped.id,
          phase: "completed",
        })
        expect(filtered.total).toBe(1)
        expect(filtered.events[0]?.description).toBe("second")
      },
    })
  })
})
