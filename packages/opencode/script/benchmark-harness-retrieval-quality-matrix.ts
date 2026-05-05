import { mkdtemp, mkdir, rm } from "fs/promises"
import os from "os"
import path from "path"
import { Log } from "../src/util/log"
import {
  runRetrievalQualityBenchmark,
  SEEDED_RETRIEVAL_QUALITY_SCENARIOS,
} from "../src/harness/retrieval-quality-benchmark"
import { REAL_RETRIEVAL_QUALITY_SCENARIOS } from "../src/harness/retrieval-quality-real-cases"

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"

async function createWorkspace(baseDir: string, scenarioID: string) {
  const directory = path.join(baseDir, scenarioID)
  await mkdir(directory, { recursive: true })
  return directory
}

await Log.init({ print: false })

const root = await mkdtemp(path.join(os.tmpdir(), "opencode-retrieval-quality-benchmark-"))

try {
  const result = await runRetrievalQualityBenchmark({
    prepareWorkspace: (scenarioID) => createWorkspace(root, scenarioID),
    scenarios: [...SEEDED_RETRIEVAL_QUALITY_SCENARIOS, ...REAL_RETRIEVAL_QUALITY_SCENARIOS as any[]],
  })

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log("Retrieval quality benchmark")
    console.log(`scenario_count: ${result.scenarioCount}`)
    console.log(`variant_count: ${result.variantCount}`)
    console.log(
      `overall_winner: ${result.overallWinner.id} (${Math.round(result.overallWinner.top1Accuracy * 100)}% top1, ${result.overallWinner.meanReciprocalRank.toFixed(3)} mrr)`,
    )
    console.table(
      result.variants.map((variant) => ({
        variant: variant.id,
        policy: variant.policy,
        focus: variant.focusCategory ?? "overall",
        embedder_model: variant.embedderModelID ?? "-",
        reranker_model: variant.rerankerModelID ?? "-",
        prompt_mode: variant.promptMode,
        embedder_preset: variant.embedderInstructionPreset ?? "-",
        reranker_preset: variant.rerankerInstructionPreset ?? "-",
        top1_accuracy: `${Math.round(variant.top1Accuracy * 100)}%`,
        top3_recall: `${Math.round(variant.top3Recall * 100)}%`,
        mrr: variant.meanReciprocalRank.toFixed(3),
        avg_elapsed_ms: variant.averageElapsedMS,
      })),
    )
    console.log("Category leaders")
    console.table(
      result.categoryLeaders.map((item) => ({
        category: item.category,
        winner: item.variantID,
        top1_accuracy: `${Math.round(item.top1Accuracy * 100)}%`,
        mrr: item.meanReciprocalRank.toFixed(3),
      })),
    )
  }
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
