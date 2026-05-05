import { $ } from "bun"
import { mkdtemp, mkdir, rm } from "fs/promises"
import os from "os"
import path from "path"
import { Log } from "../src/util/log"
import { runSemanticLiftBenchmark } from "../src/harness/semantic-benchmark"

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"

async function createWorkspace(baseDir: string, scenarioID: string) {
  const directory = path.join(baseDir, scenarioID)
  await mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await $`git commit --allow-empty -m ${`root commit ${scenarioID}`}`.cwd(directory).quiet()
  return directory
}

await Log.init({ print: false })

const root = await mkdtemp(path.join(os.tmpdir(), "opencode-semantic-benchmark-"))

try {
  const result = await runSemanticLiftBenchmark({
    prepareWorkspace: (scenarioID) => createWorkspace(root, scenarioID),
  })

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log("Semantic lift benchmark")
    console.log(`success_rate: ${Math.round(result.successRate * 100)}% (${result.passedCount}/${result.scenarioCount})`)
    console.log(
      `routing_confidence_gain: +${result.comparativeDeltas.routing.confidenceGain} | context_token_delta: ${result.comparativeDeltas.routing.contextTokenDelta} | gain_per_semantic_token: ${result.comparativeDeltas.routing.confidenceGainPerSemanticToken}`,
    )
    console.log(
      `planning_confidence_gain: +${result.comparativeDeltas.planning.confidenceGain} | context_token_delta: ${result.comparativeDeltas.planning.contextTokenDelta} | gain_per_semantic_token: ${result.comparativeDeltas.planning.confidenceGainPerSemanticToken}`,
    )
    console.log(
      `recovery_elapsed_ms_delta: ${result.comparativeDeltas.recovery.elapsedMSDelta} | recovery_context_token_delta: ${result.comparativeDeltas.recovery.contextTokenDelta}`,
    )
    console.table(
      result.results.map((item) => ({
        scenario: item.id,
        category: item.category,
        ok: item.ok,
        summary: item.summary,
      })),
    )
  }

  if (result.failedCount > 0) process.exitCode = 1
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
