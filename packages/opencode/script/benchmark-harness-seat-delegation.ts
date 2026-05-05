import { mkdtemp, mkdir, rm } from "fs/promises"
import os from "os"
import path from "path"
import { Log } from "../src/util/log"
import { runSeatDelegationBenchmark } from "../src/harness/seat-delegation-benchmark"

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"

async function createWorkspace(baseDir: string, scenarioID: string) {
  const directory = path.join(baseDir, scenarioID)
  await mkdir(directory, { recursive: true })
  return directory
}

await Log.init({ print: false })

const root = await mkdtemp(path.join(os.tmpdir(), "opencode-seat-delegation-benchmark-"))

try {
  const result = await runSeatDelegationBenchmark({
    benchmarkModel: { providerID: "alibaba-coding-plan" as any, modelID: "glm-5" as any },
    prepareWorkspace: (scenarioID) => createWorkspace(root, scenarioID),
  })

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log("Seat-agent delegation benchmark")
    console.log(
      `strict_lift: ${result.qualityLift >= 0 ? "+" : ""}${result.qualityLift} | baseline_accuracy: ${Math.round(result.baselineAccuracy * 100)}% | semantic_accuracy: ${Math.round(result.semanticAccuracy * 100)}%`,
    )
    console.log(
      `loose_lift: ${result.looseQualityLift >= 0 ? "+" : ""}${result.looseQualityLift} | baseline_loose_accuracy: ${Math.round(result.baselineLooseAccuracy * 100)}% | semantic_loose_accuracy: ${Math.round(result.semanticLooseAccuracy * 100)}%`,
    )
    console.log(`avg_latency_delta_ms: ${result.averageLatencyDeltaMS}`)
    console.table(
      result.results.map((item) => ({
        scenario: item.id,
        category: item.category,
        difficulty: item.difficulty,
        expected: item.expected,
        baseline: item.baselineCanonical,
        semantic: item.semanticCanonical,
        strict_semantic_ok: item.semanticCorrect,
        strict_baseline_ok: item.baselineCorrect,
      })),
    )
  }

  if (result.semanticCorrectCount < result.baselineCorrectCount) process.exitCode = 1
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
