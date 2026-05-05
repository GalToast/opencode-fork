// @ts-nocheck
import { afterEach, describe, expect, test } from "bun:test"
import { runRetrievalQualityBenchmark } from "../../src/harness/retrieval-quality-benchmark"
import { resetDatabase } from "../fixture/db"
import { RetrievalRuntime } from "../../src/retrieval/runtime"

describe("harness retrieval quality benchmark", () => {
  afterEach(async () => {
    RetrievalRuntime.reset()
    await resetDatabase()
  })

  test(
    "retrieval quality benchmark compares lane and preset variants over the seeded eval set",
    async () => {
      const prepareCalls: string[] = []
      const result = await runRetrievalQualityBenchmark({
        prepareWorkspace: async (scenarioID: string) => {
          prepareCalls.push(scenarioID)
          return "."
        },
      })

      expect(result.suite).toBe("retrieval_quality")
      expect(result.scenarioCount).toBe(12)
      expect(result.variantCount).toBe(19)
      expect(result.overallWinner.id).toBeDefined()
      expect(result.categoryLeaders).toHaveLength(5)
      expect(prepareCalls).toHaveLength(result.scenarioCount * result.variantCount)

      const byID = new Map(result.variants.map((variant) => [variant.id, variant]))
      expect(byID.get("fast_current")).toBeDefined()
      expect(byID.get("quality_current")).toBeDefined()
      expect(byID.get("auto_current")).toBeDefined()
      expect(byID.get("auto_routed_best_of_category")).toBeDefined()
      expect(byID.get("fast_decision_tuned")).toBeDefined()
      expect(byID.get("auto_failure_tuned")).toBeDefined()
      expect(byID.get("quality_file_tuned")).toBeDefined()
      expect(byID.get("auto_failure_literal")).toBeDefined()
      expect(byID.get("quality_file_literal")).toBeDefined()
      expect(byID.get("quality_decision_commitments")).toBeDefined()
      expect(byID.get("auto_decision_guardrails")).toBeDefined()
      expect(byID.get("quality_decision_hybrid")).toBeDefined()
      expect(byID.get("quality_file_exact_owner")).toBeDefined()
      expect(byID.get("auto_file_locator")).toBeDefined()
      expect(byID.get("quality_file_hybrid")).toBeDefined()
      expect(byID.get("auto_compaction_tuned")).toBeDefined()
      expect(byID.get("auto_compaction_literal")).toBeDefined()
      expect(byID.get("quality_compaction_literal")).toBeDefined()
      expect(byID.get("auto_compaction_hybrid")).toBeDefined()

      expect(byID.get("quality_current")!.top1Accuracy).toBeGreaterThanOrEqual(byID.get("fast_current")!.top1Accuracy)
      expect(byID.get("auto_current")!.meanReciprocalRank).toBeGreaterThanOrEqual(byID.get("fast_current")!.meanReciprocalRank)
      expect(byID.get("auto_routed_best_of_category")!.top1Accuracy).toBeGreaterThanOrEqual(
        byID.get("auto_current")!.top1Accuracy,
      )
      expect(byID.get("auto_routed_best_of_category")!.meanReciprocalRank).toBeGreaterThanOrEqual(
        byID.get("auto_current")!.meanReciprocalRank,
      )
      expect(
        byID.get("auto_failure_tuned")!.categorySummary.find((item) => item.category === "recovery")!.top1Accuracy,
      ).toBeGreaterThanOrEqual(
        byID.get("auto_current")!.categorySummary.find((item) => item.category === "recovery")!.top1Accuracy,
      )
      expect(
        byID.get("quality_file_tuned")!.categorySummary.find((item) => item.category === "file")!.top1Accuracy,
      ).toBeGreaterThanOrEqual(
        byID.get("quality_current")!.categorySummary.find((item) => item.category === "file")!.top1Accuracy,
      )
      expect(
        byID.get("quality_decision_commitments")!.categorySummary.find((item) => item.category === "decision")!.top1Accuracy,
      ).toBeGreaterThanOrEqual(
        byID.get("quality_current")!.categorySummary.find((item) => item.category === "decision")!.top1Accuracy,
      )
      expect(
        byID.get("quality_file_exact_owner")!.categorySummary.find((item) => item.category === "file")!.meanReciprocalRank,
      ).toBeGreaterThanOrEqual(
        byID.get("quality_current")!.categorySummary.find((item) => item.category === "file")!.meanReciprocalRank,
      )
      expect(byID.get("auto_failure_literal")!.rerankerInstruction).toContain("failure")
      expect(byID.get("quality_file_literal")!.embedderInstruction).toContain("file")
      expect(byID.get("quality_decision_hybrid")!.promptMode).toBe("hybrid")
      expect(byID.get("quality_file_exact_owner")!.embedderInstruction).toContain("exact file")
      expect(
        byID.get("auto_compaction_tuned")!.categorySummary.find((item) => item.category === "compaction")!.top1Accuracy,
      ).toBeGreaterThanOrEqual(
        byID.get("auto_current")!.categorySummary.find((item) => item.category === "compaction")!.top1Accuracy,
      )
      expect(byID.get("auto_compaction_literal")!.embedderInstruction).toContain("survive compaction")
      expect(byID.get("auto_compaction_hybrid")!.promptMode).toBe("hybrid")
      expect(byID.get("auto_routed_best_of_category")!.promptMode).toBe("routed")
    },
    60_000,
  )
})
