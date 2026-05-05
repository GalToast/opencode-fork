import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { SchedulerControl } from "../../src/scheduler/control-plane"
import { SessionForeground } from "../../src/session/foreground"

describe("scheduler control plane", () => {
  test("dispatches queued jobs by priority within a lane", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            experimental: {
              orchestration: {
                global_scheduler: {
                  enabled: true,
                  profile: "balanced_pro",
                  lane_concurrency: {
                    main_turns: 1,
                  },
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const order: string[] = []
        await SchedulerControl.setLanePaused("main_turns", true)

        await SchedulerControl.submit({
          kind: "prompt",
          lane: "main_turns",
          priority: "background",
          sessionID: "session_bg" as any,
          description: "background",
          waitForResult: false,
          run: async () => {
            order.push("background")
          },
        })
        await SchedulerControl.submit({
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          sessionID: "session_normal" as any,
          description: "normal",
          waitForResult: false,
          run: async () => {
            order.push("normal")
          },
        })
        await SchedulerControl.submit({
          kind: "prompt",
          lane: "main_turns",
          priority: "steer",
          sessionID: "session_steer" as any,
          description: "steer",
          waitForResult: false,
          run: async () => {
            order.push("steer")
          },
        })

        await SchedulerControl.setLanePaused("main_turns", false)
        for (let attempt = 0; attempt < 20 && order.length < 3; attempt++) {
          await Bun.sleep(50)
        }

        expect(order).toEqual(["steer", "normal", "background"])
      },
    })
  })

  test(
    "vanilla mode bypasses lane queueing",
    async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const order: string[] = []
        await SchedulerControl.setMode("vanilla")
        await SchedulerControl.setLanePaused("longrun_jobs", true)

        await SchedulerControl.submit({
          kind: "command",
          lane: "longrun_jobs",
          priority: "normal",
          sessionID: "session_vanilla" as any,
          description: "vanilla command",
          waitForResult: true,
          run: async () => {
            order.push("executed")
            return "ok"
          },
        })

        expect(order).toEqual(["executed"])
      },
    })
    },
    20_000,
  )

  test("status exposes lane metrics", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const status = await SchedulerControl.getStatus()
        const lanes = status.lanes.map((lane) => lane.lane)
        expect(lanes).toContain("user_ingress")
        expect(lanes).toContain("main_turns")
        expect(lanes).toContain("steer_fastlane")
        expect(lanes).toContain("orchestrator_swarm")
        expect(lanes).toContain("adversarial_review")
        expect(lanes).toContain("subagent_tasks")
        expect(lanes).toContain("tool_io")
        expect(lanes).toContain("longrun_jobs")
        expect(status.lanes.find((lane) => lane.lane === "user_ingress")?.role).toBe("ingress")
        expect(status.lanes.find((lane) => lane.lane === "main_turns")?.role).toBe("foreground")
      },
    })
  })

  test("status tracks latest lane activity", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.submit({
          kind: "prompt",
          lane: "user_ingress",
          priority: "normal",
          sessionID: "session_ingress_latest" as any,
          description: "session.prompt.ingress",
          waitForResult: true,
          run: async () => "ok",
        })

        const status = await SchedulerControl.getStatus()
        const ingress = status.lanes.find((lane) => lane.lane === "user_ingress")
        expect(ingress?.latest?.description).toBe("session.prompt.ingress")
        expect(ingress?.latest?.status).toBe("completed")
        expect(ingress?.latest?.priority).toBe("normal")
      },
    })
  })

  test("dedupes durable background jobs by key", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.setLanePaused("longrun_jobs", true)

        const first = await SchedulerControl.submit({
          kind: "command",
          lane: "longrun_jobs",
          priority: "background",
          sessionID: "session_dedupe" as any,
          description: "background refresh",
          waitForResult: false,
          durable: true,
          dedupeKey: "background.refresh",
          resume: {
            key: "background.refresh",
            payload: {
              reason: "test",
              force: true,
            },
          },
          run: async () => "first",
        })
        const second = await SchedulerControl.submit({
          kind: "command",
          lane: "longrun_jobs",
          priority: "background",
          sessionID: "session_dedupe" as any,
          description: "background refresh",
          waitForResult: false,
          durable: true,
          dedupeKey: "background.refresh",
          resume: {
            key: "background.refresh",
            payload: {
              reason: "test",
              force: true,
            },
          },
          run: async () => "second",
        })

        expect(second.jobID).toBe(first.jobID)

        const status = await SchedulerControl.getStatus()
        expect(status.lanes.find((lane) => lane.lane === "longrun_jobs")?.queued).toBe(1)
      },
    })
  })

  test("status exposes starved tool and longrun lanes", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            experimental: {
              orchestration: {
                global_scheduler: {
                  enabled: true,
                  guardrails: {
                    enabled: true,
                    tool_io_starvation_ms: 250,
                    longrun_jobs_starvation_ms: 250,
                  },
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SchedulerControl.setLanePaused("tool_io", true)
        await SchedulerControl.setLanePaused("longrun_jobs", true)

        await SchedulerControl.submit({
          kind: "tool_admission",
          lane: "tool_io",
          priority: "normal",
          sessionID: "session_tool_starved" as any,
          description: "tool admission waiting behind a pause",
          waitForResult: false,
          run: async () => "tool",
        })

        await SchedulerControl.submit({
          kind: "command",
          lane: "longrun_jobs",
          priority: "normal",
          sessionID: "session_longrun_starved" as any,
          description: "longrun work waiting behind a pause",
          waitForResult: false,
          run: async () => "longrun",
        })

        await Bun.sleep(320)

        const status = await SchedulerControl.getStatus()
        const tool = status.lanes.find((lane) => lane.lane === "tool_io")
        const longrun = status.lanes.find((lane) => lane.lane === "longrun_jobs")

        expect(tool?.health.starved).toBe(true)
        expect(tool?.health.starvationThresholdMS).toBe(250)
        expect(tool?.health.oldestQueuedAgeMS ?? 0).toBeGreaterThanOrEqual(250)
        expect(tool?.health.saturation).toBe("queued")

        expect(longrun?.health.starved).toBe(true)
        expect(longrun?.health.starvationThresholdMS).toBe(250)
        expect(longrun?.health.oldestQueuedAgeMS ?? 0).toBeGreaterThanOrEqual(250)
        expect(longrun?.health.saturation).toBe("queued")
      },
    })
  })

  test("foreground standby demand opens a spare main responder slot", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            experimental: {
              orchestration: {
                global_scheduler: {
                  enabled: true,
                  profile: "conservative",
                  autoscale: {
                    enabled: true,
                    main_turns_min: 1,
                    main_turns_max: 3,
                    cooldown_ms: 60_000,
                  },
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let release!: () => void
        const blocker = new Promise<void>((resolve) => {
          release = resolve
        })

        await SessionForeground.promote({
          sessionID: "session_root" as any,
          rootSessionID: "session_root",
          turnID: "turn_active",
          promotedAt: Date.now(),
        })
        await SessionForeground.accept({
          sessionID: "session_root" as any,
          rootSessionID: "session_root",
          messageID: "message_waiting" as any,
          intent: "take over while the first responder is still busy",
          acceptedAt: Date.now(),
        })

        await SchedulerControl.submit({
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          sessionID: "session_root" as any,
          description: "active foreground turn",
          waitForResult: false,
          run: async () => {
            await blocker
          },
        })

        await Bun.sleep(120)

        const status = await SchedulerControl.getStatus()
        expect(status.lanes.find((lane) => lane.lane === "main_turns")?.running).toBe(1)
        expect(status.lanes.find((lane) => lane.lane === "main_turns")?.concurrency).toBe(2)

        release()
        for (let attempt = 0; attempt < 20; attempt++) {
          const settled = await SchedulerControl.getStatus()
          if ((settled.lanes.find((lane) => lane.lane === "main_turns")?.running ?? 0) === 0) break
          await Bun.sleep(50)
        }
      },
    })
  })
})
