import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { SchedulerControl } from "../../src/scheduler/control-plane"
import { tmpdir } from "../fixture/fixture"

describe("Provider-Agnostic Rate Limiting", () => {
  test("GLOBAL_PROMPT_CONCURRENCY limits concurrent prompt jobs", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Submit more than 15 prompt jobs simultaneously
        const promises: Promise<any>[] = []
        const jobIDs: string[] = []
        
        for (let i = 0; i < 20; i++) {
          const promise = SchedulerControl.submit({
            kind: "prompt",
            lane: "subagent_tasks",
            priority: "normal",
            sessionID: `test-session-${i}`,
            description: `Test prompt job ${i}`,
            waitForResult: false,
            run: async () => {
              await new Promise(resolve => setTimeout(resolve, 100))
              return `result-${i}`
            }
          })
          promises.push(promise)
        }
        
        const results = await Promise.all(promises)
        results.forEach((result, i) => {
          jobIDs.push(result.jobID)
          expect(result.background).toBe(true)
        })
        
        // Get scheduler status
        const status = await SchedulerControl.getStatus()
        
        // Count running prompt jobs across all lanes
        let runningPrompts = 0
        status.lanes.forEach(lane => {
          runningPrompts += lane.running
        })
        
        // Should not exceed GLOBAL_PROMPT_CONCURRENCY (15)
        expect(runningPrompts).toBeLessThanOrEqual(15)
        
        console.log(`✓ Rate limiting active: ${runningPrompts}/15 prompt jobs running`)
      },
    })
  })

  test("non-prompt jobs continue when prompt bucket is saturated", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Saturate prompt jobs
        const promptPromises: Promise<any>[] = []
        for (let i = 0; i < 15; i++) {
          promptPromises.push(SchedulerControl.submit({
            kind: "prompt",
            lane: "subagent_tasks",
            priority: "normal",
            sessionID: `prompt-session-${i}`,
            description: `Saturating prompt ${i}`,
            waitForResult: false,
            run: async () => {
              await new Promise(resolve => setTimeout(resolve, 500))
              return "prompt-result"
            }
          }))
        }
        
        // Wait for prompts to start
        await Promise.all(promptPromises)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        // Now submit a non-prompt job - should still be accepted
        const shellJob = await SchedulerControl.submit({
          kind: "shell",
          lane: "tool_io",
          priority: "normal",
          sessionID: "shell-session" as any,
          description: "Shell job while prompts saturated",
          waitForResult: false,
          run: async () => "shell-result"
        })
        
        expect(shellJob.background).toBe(true)
        expect(shellJob.jobID).toBeDefined()
        
        console.log("✓ Non-prompt jobs continue when prompt bucket saturated")
      },
    })
  })
})
