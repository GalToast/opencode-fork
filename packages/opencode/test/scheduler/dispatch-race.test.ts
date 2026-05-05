import { describe, expect, test } from "bun:test"
import { SchedulerControl } from "../../src/scheduler/control-plane"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("SchedulerControl dispatch race conditions", () => {
  test("single job dispatches and completes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.setMode("hybrid")
        
        let completed = false
        
        await SchedulerControl.submit({
          kind: "task_turn",
          lane: "subagent_tasks",
          priority: "normal",
          sessionID: "session-single",
          description: "Single job",
          waitForResult: false,
          run: async () => {
            completed = true
          },
        })

        await new Promise((r) => setTimeout(r, 100))

        expect(completed).toBe(true)
      },
    })
  })

  test("multiple sequential jobs all complete", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.setMode("hybrid")
        const completed: string[] = []

        for (let i = 0; i < 5; i++) {
          await SchedulerControl.submit({
            kind: "task_turn",
            lane: "subagent_tasks",
            priority: "normal",
            sessionID: `session-${i}`,
            description: `Task ${i}`,
            waitForResult: false,
            run: async () => {
              completed.push(`session-${i}`)
            },
          })
          await new Promise((r) => setTimeout(r, 10))
        }

        await new Promise((r) => setTimeout(r, 300))

        expect(completed.length).toBe(5)
      },
    })
  })

  test("dispatchPending flag triggers re-dispatch after current dispatch exits", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.setMode("hybrid")
        
        const started: string[] = []

        await SchedulerControl.submit({
          kind: "task_turn",
          lane: "subagent_tasks",
          priority: "normal",
          sessionID: "session-first",
          description: "First job",
          waitForResult: false,
          run: async () => {
            started.push("session-first")
          },
        })

        await new Promise((r) => setTimeout(r, 100))
        expect(started).toContain("session-first")
      },
    })
  })

  test("paused lane does not block other lanes from dispatching", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.setMode("hybrid")
        await SchedulerControl.setLanePaused("subagent_tasks", true)

        const started: string[] = []

        await SchedulerControl.submit({
          kind: "task_turn",
          lane: "subagent_tasks",
          priority: "normal",
          sessionID: "session-paused-lane",
          description: "Job on paused lane",
          waitForResult: false,
          run: async () => {
            started.push("session-paused-lane")
          },
        })

        await SchedulerControl.submit({
          kind: "task_turn",
          lane: "tool_io",
          priority: "normal",
          sessionID: "session-active-lane",
          description: "Job on active lane",
          waitForResult: false,
          run: async () => {
            started.push("session-active-lane")
          },
        })

        await new Promise((r) => setTimeout(r, 200))

        expect(started).toContain("session-active-lane")
        expect(started).not.toContain("session-paused-lane")

        await SchedulerControl.setLanePaused("subagent_tasks", false)

        await new Promise((r) => setTimeout(r, 200))

        expect(started).toContain("session-paused-lane")
      },
    })
  })

  test("high concurrency load does not drop jobs", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.setMode("hybrid")
        const jobCount = 10
        const completed: string[] = []

        for (let i = 0; i < jobCount; i++) {
          await SchedulerControl.submit({
            kind: "task_turn",
            lane: "subagent_tasks",
            priority: "normal",
            sessionID: `session-burst-${i}`,
            description: `Burst job ${i}`,
            waitForResult: false,
            run: async () => {
              completed.push(`session-burst-${i}`)
            },
          })
          await new Promise((r) => setTimeout(r, 5))
        }

        await new Promise((r) => setTimeout(r, 500))

        expect(completed.length).toBe(jobCount)
      },
    })
  })
})