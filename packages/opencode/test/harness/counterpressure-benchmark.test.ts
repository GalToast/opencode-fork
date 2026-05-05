// @ts-nocheck
import { describe, expect, test } from "bun:test"
import { runCounterpressureBenchmark } from "../../src/harness/counterpressure-benchmark"

describe("harness counterpressure benchmark", () => {
  test("counterpressure cues reduce repetitive keep-going judgments", async () => {
    const result = await runCounterpressureBenchmark()

    expect(result.suite).toBe("counterpressure_judgment")
    expect(result.benchmarkModel).toEqual({
      providerID: "alibaba-coding-plan" as any,
      modelID: "glm-5" as any,
    })
    expect(result.scenarioCount).toBe(4)
    expect(result.baselineCorrectCount).toBe(0)
    expect(result.semanticCorrectCount).toBe(4)
    expect(result.qualityLift).toBeGreaterThan(0)
    expect(result.categorySummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "repetition", counterpressureCorrect: 2 }),
        expect.objectContaining({ category: "invalidation", counterpressureCorrect: 1 }),
        expect.objectContaining({ category: "recovery", counterpressureCorrect: 1 }),
      ]),
    )
    expect(result.results.find((item) => item.id === "repetitive_retry_without_new_evidence")).toEqual(
      expect.objectContaining({
        baselineAction: "continue",
        counterpressureAction: "change_course",
        baselineCorrect: false,
        counterpressureCorrect: true,
      }),
    )
  })
})
