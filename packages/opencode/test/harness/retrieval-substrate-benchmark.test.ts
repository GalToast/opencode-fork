// @ts-nocheck
import { afterEach, describe, expect, test } from "bun:test"
import { runRetrievalSubstrateBenchmark } from "../../src/harness/retrieval-substrate-benchmark"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { RetrievalRuntime } from "../../src/retrieval/runtime"

describe("harness retrieval substrate benchmark", () => {
  afterEach(async () => {
    RetrievalRuntime.reset()
    await resetDatabase()
  })

  test(
    "retrieval substrate benchmark stays green across identity, ranking, scope, and observability scenarios",
    async () => {
      const tmps: Array<Awaited<ReturnType<typeof tmpdir>>> = []
      const prepareWorkspace = async (scenarioID: string) => {
        const tmp = await tmpdir({ git: true })
        tmps.push(tmp)
        return tmp.path
      }

      try {
        const result = await runRetrievalSubstrateBenchmark({ prepareWorkspace })

        expect(result.suite).toBe("retrieval_substrate")
        expect(result.scenarioCount).toBe(4)
        expect(result.failedCount).toBe(0)
        expect(result.successRate).toBe(1)
        expect(result.averageElapsedMS).toBeGreaterThan(0)
        expect(result.categorySummary).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ category: "identity", passed: 1 }),
            expect.objectContaining({ category: "ranking", passed: 1 }),
            expect.objectContaining({ category: "scope", passed: 1 }),
            expect.objectContaining({ category: "observability", passed: 1 }),
          ]),
        )
        expect(result.results.map((item) => item.id)).toEqual(
          expect.arrayContaining([
            "embedding_identity_by_lane",
            "provider_fallback_ranking_parity",
            "feedback_scope_isolation",
            "fallback_diagnostics_truthful",
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
