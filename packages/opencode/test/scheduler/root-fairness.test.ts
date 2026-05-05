import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { SchedulerControl } from "../../src/scheduler/control-plane"

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMS: number = 5_000) {
  const deadline = Date.now() + timeoutMS
  while (Date.now() < deadline) {
    if (await condition()) return
    await Bun.sleep(20)
  }
  throw new Error("Timed out waiting for scheduler condition")
}

describe("scheduler root fairness", () => {
  test("main turns do not let one root occupy multiple responder slots before another queued root starts", async () => {
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
                  fairness_penalty: 0.1,
                  autoscale: {
                    enabled: false,
                    main_turns_min: 2,
                    main_turns_max: 2,
                    steer_fastlane_enabled: false,
                  },
                  lane_concurrency: {
                    main_turns: 2,
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
        const started: string[] = []
        let releaseRootA1: (() => void) | undefined
        let releaseRootA2: (() => void) | undefined
        let releaseRootB1: (() => void) | undefined

        const block = (label: string, assign: (release: () => void) => void) =>
          new Promise<void>((resolve) => {
            started.push(label)
            assign(resolve)
          })

        await SchedulerControl.submit({
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          sessionID: "root-a-turn-1",
          rootSessionID: "root-a",
          description: "root a turn 1",
          waitForResult: false,
          run: () => block("root-a-1", (release) => (releaseRootA1 = release)),
        })
        await waitFor(() => started.includes("root-a-1"))

        await Promise.all([
          SchedulerControl.submit({
            kind: "prompt",
            lane: "main_turns",
            priority: "normal",
            sessionID: "root-a-turn-2",
            rootSessionID: "root-a",
            description: "root a turn 2",
            waitForResult: false,
            run: () => block("root-a-2", (release) => (releaseRootA2 = release)),
          }),
          SchedulerControl.submit({
            kind: "prompt",
            lane: "main_turns",
            priority: "normal",
            sessionID: "root-b-turn-1",
            rootSessionID: "root-b",
            description: "root b turn 1",
            waitForResult: false,
            run: () => block("root-b-1", (release) => (releaseRootB1 = release)),
          }),
        ])

        await waitFor(() => started.length >= 2)
        expect(started.slice(0, 2)).toEqual(["root-a-1", "root-b-1"])

        releaseRootA1?.()
        releaseRootB1?.()
        await waitFor(() => started.includes("root-a-2"))
        releaseRootA2?.()

        await waitFor(async () => {
          const status = await SchedulerControl.getStatus()
          return status.queuedTotal === 0 && status.runningTotal === 0
        })
      },
    })
  }, 20_000)
})
