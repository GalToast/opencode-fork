import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { SchedulerControl } from "../../src/scheduler/control-plane"

function lane(status: Awaited<ReturnType<typeof SchedulerControl.getStatus>>, name: SchedulerControl.Lane) {
  const item = status.lanes.find((x) => x.lane === name)
  if (item) return item
  throw new Error(`Missing lane: ${name}`)
}

describe("scheduler soak", () => {
  test(
    "mixed load autoscales lanes and drains without dropping work",
    async () => {
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
                    aging_ms: 1_000,
                    fairness_penalty: 0.05,
                    lane_concurrency: {
                      tool_io: 2,
                      longrun_jobs: 2,
                    },
                    autoscale: {
                      enabled: true,
                      main_turns_min: 2,
                      main_turns_max: 10,
                      scale_up_queue_threshold: 1,
                      scale_down_running_threshold: 0,
                      cooldown_ms: 1_000,
                      steer_fastlane_enabled: true,
                      steer_fastlane_min: 2,
                      steer_fastlane_max: 12,
                      steer_scale_up_queue_threshold: 1,
                      steer_scale_down_running_threshold: 0,
                      steer_cooldown_ms: 1_000,
                    },
                    guardrails: {
                      enabled: true,
                      tool_io_starvation_ms: 250,
                      longrun_jobs_starvation_ms: 250,
                      tool_io_bias: 0.35,
                      longrun_jobs_bias: 0.25,
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
          const total = {
            main: 40,
            steer: 30,
            tool: 12,
            long: 12,
          }
          const done = {
            main: 0,
            steer: 0,
            tool: 0,
            long: 0,
          }
          const peak = {
            main: 0,
            steer: 0,
          }
          const laneSeen = {
            toolWhileMainBusy: false,
            longWhileMainBusy: false,
          }

          const queue = (input: {
            lane: SchedulerControl.Lane
            kind: SchedulerControl.Kind
            priority: SchedulerControl.Priority
            count: number
            sleepMS: number
            key: "main" | "steer" | "tool" | "long"
          }) =>
            Promise.all(
              Array.from({ length: input.count }, (_, i) =>
                SchedulerControl.submit({
                  kind: input.kind,
                  lane: input.lane,
                  priority: input.priority,
                  sessionID: `${input.lane}_${i}`,
                  description: `soak ${input.lane}`,
                  waitForResult: false,
                  run: async () => {
                    await Bun.sleep(input.sleepMS)
                    done[input.key] += 1
                  },
                }),
              ),
            )

          await Promise.all([
            queue({
              lane: "main_turns",
              kind: "prompt",
              priority: "normal",
              count: total.main,
              sleepMS: 180,
              key: "main",
            }),
            queue({
              lane: "steer_fastlane",
              kind: "prompt",
              priority: "steer",
              count: total.steer,
              sleepMS: 120,
              key: "steer",
            }),
            queue({
              lane: "tool_io",
              kind: "tool_admission",
              priority: "normal",
              count: total.tool,
              sleepMS: 90,
              key: "tool",
            }),
            queue({
              lane: "longrun_jobs",
              kind: "command",
              priority: "background",
              count: total.long,
              sleepMS: 140,
              key: "long",
            }),
          ])

          const deadline = Date.now() + 30_000
          while (Date.now() < deadline) {
            const status = await SchedulerControl.getStatus()
            const main = lane(status, "main_turns")
            const steer = lane(status, "steer_fastlane")
            const tool = lane(status, "tool_io")
            const long = lane(status, "longrun_jobs")

            peak.main = Math.max(peak.main, main.concurrency)
            peak.steer = Math.max(peak.steer, steer.concurrency)

            const mainBusy = main.running + main.queued > 0
            if (mainBusy && tool.running > 0) laneSeen.toolWhileMainBusy = true
            if (mainBusy && long.running > 0) laneSeen.longWhileMainBusy = true

            const allDone =
              done.main === total.main &&
              done.steer === total.steer &&
              done.tool === total.tool &&
              done.long === total.long
            if (allDone && status.queuedTotal === 0 && status.runningTotal === 0) break
            await Bun.sleep(40)
          }

          expect(done.main).toBe(total.main)
          expect(done.steer).toBe(total.steer)
          expect(done.tool).toBe(total.tool)
          expect(done.long).toBe(total.long)

          expect(peak.main).toBeGreaterThan(2)
          expect(peak.main).toBeLessThanOrEqual(10)
          expect(peak.steer).toBeGreaterThanOrEqual(2)
          expect(peak.steer).toBeLessThanOrEqual(12)

          expect(laneSeen.toolWhileMainBusy).toBe(true)
          expect(laneSeen.longWhileMainBusy).toBe(true)
        },
      })
    },
    40_000,
  )
})
