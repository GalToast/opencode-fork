// @ts-nocheck
import { afterEach, describe, expect, test } from "bun:test"
import { runSemanticLiftBenchmark } from "../../src/harness/semantic-benchmark"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { RetrievalRuntime } from "../../src/retrieval/runtime"

describe("harness semantic benchmark", () => {
  afterEach(async () => {
    RetrievalRuntime.reset()
    await resetDatabase()
  })

  test(
    "semantic lift benchmark stays green across routing, planning, recovery, and state visibility",
    async () => {
      const tmps: Array<Awaited<ReturnType<typeof tmpdir>>> = []
      const prepareWorkspace = async (scenarioID: string) => {
        const tmp = await tmpdir({ git: true })
        tmps.push(tmp)
        return tmp.path
      }

      try {
        const result = await runSemanticLiftBenchmark({ prepareWorkspace })

        expect(result.suite).toBe("semantic_lift")
        expect(result.benchmarkModel).toEqual({
          providerID: "alibaba-coding-plan" as any,
          modelID: "glm-5" as any,
        })
        expect(result.scenarioCount).toBe(7)
        expect(result.failedCount).toBe(0)
        expect(result.successRate).toBe(1)
        expect(result.categorySummary).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ category: "routing", passed: 2 }),
            expect.objectContaining({ category: "planning", passed: 2 }),
            expect.objectContaining({ category: "recovery", passed: 2 }),
            expect.objectContaining({ category: "state", passed: 1 }),
          ]),
        )
        expect(result.comparativeDeltas.routing.confidenceGain).toBeGreaterThan(0)
        expect(result.comparativeDeltas.planning.confidenceGain).toBeGreaterThan(0)
        expect(result.comparativeDeltas.recovery.semanticElapsedMS).toBeGreaterThan(0)
        expect(result.comparativeDeltas.recovery.baselineElapsedMS).toBeGreaterThan(0)
        expect(result.results.map((item) => item.id)).toEqual(
          expect.arrayContaining([
            "routing_confidence_high",
            "routing_baseline_fallback",
            "planning_execution_analog_reuse",
            "planning_baseline_neutral",
            "recovery_invalidation_awareness",
            "recovery_baseline_generic",
            "agent_state_visibility",
          ]),
        )
        expect(result.results.every((item) => item.ok)).toBe(true)
      } finally {
        while (tmps.length) {
          const tmp = tmps.pop()
          if (tmp) await tmp[Symbol.asyncDispose]()
        }
      }
    },
    60_000,
  )
})
