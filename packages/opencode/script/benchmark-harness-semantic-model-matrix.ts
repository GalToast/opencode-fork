import { $ } from "bun"
import { mkdtemp, mkdir, rm } from "fs/promises"
import os from "os"
import path from "path"
import { Log } from "../src/util/log"
import { runSemanticLiftBenchmark, type SemanticLiftBenchmarkResult } from "../src/harness/semantic-benchmark"
import { Instance } from "../src/project/instance"
import { Provider } from "../src/provider/provider"

const LIMIT = Number(process.env.HARNESS_BENCH_MODEL_LIMIT ?? "0")
const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"

async function createWorkspace(baseDir: string, scenarioID: string) {
  const directory = path.join(baseDir, scenarioID)
  await mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await $`git commit --allow-empty -m ${`root commit ${scenarioID}`}`.cwd(directory).quiet()
  return directory
}

type MatrixRow = {
  modelID: string
  ok: boolean
  successRate: number
  passedCount: number
  scenarioCount: number
  routingGain: number
  planningGain: number
  recoveryDeltaMS: number
}

function toRow(result: SemanticLiftBenchmarkResult): MatrixRow {
  return {
    modelID: result.benchmarkModel.modelID,
    ok: result.failedCount === 0,
    successRate: result.successRate,
    passedCount: result.passedCount,
    scenarioCount: result.scenarioCount,
    routingGain: result.comparativeDeltas.routing.confidenceGain,
    planningGain: result.comparativeDeltas.planning.confidenceGain,
    recoveryDeltaMS: result.comparativeDeltas.recovery.elapsedMSDelta,
  }
}

await Log.init({ print: false })

const instanceRoot = await mkdtemp(path.join(os.tmpdir(), "opencode-semantic-model-matrix-instance-"))
const benchmarkRoot = await mkdtemp(path.join(os.tmpdir(), "opencode-semantic-model-matrix-"))

try {
  const results: SemanticLiftBenchmarkResult[] = []

  await Instance.provide({
    directory: instanceRoot,
    fn: async () => {
      const discovered = Object.values((await Provider.getProvider("opencode" as any)).models)
      const selected = LIMIT > 0 ? discovered.slice(0, LIMIT) : discovered
      for (const model of selected) {
        const modelRoot = path.join(benchmarkRoot, model.id.replace(/[^a-z0-9._-]+/gi, "_"))
        const result = await runSemanticLiftBenchmark({
          benchmarkModel: { providerID: "opencode" as any, modelID: model.id },
          prepareWorkspace: (scenarioID) => createWorkspace(modelRoot, scenarioID),
        })
        results.push(result)
      }
    },
  })

  const ranked = [...results].sort((a, b) => {
    if (b.successRate !== a.successRate) return b.successRate - a.successRate
    const aLift = a.comparativeDeltas.routing.confidenceGain + a.comparativeDeltas.planning.confidenceGain
    const bLift = b.comparativeDeltas.routing.confidenceGain + b.comparativeDeltas.planning.confidenceGain
    if (bLift !== aLift) return bLift - aLift
    return a.benchmarkModel.modelID.localeCompare(b.benchmarkModel.modelID)
  })

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ suite: "semantic_lift_model_matrix", modelCount: ranked.length, results: ranked }, null, 2))
  } else {
    console.log("Semantic lift model matrix")
    console.log(`tested_models: ${ranked.length}`)
    console.table(
      ranked.map((result) => ({
        model: result.benchmarkModel.modelID,
        ok: result.failedCount === 0,
        success_rate: `${Math.round(result.successRate * 100)}%`,
        passed: `${result.passedCount}/${result.scenarioCount}`,
        routing_gain: result.comparativeDeltas.routing.confidenceGain,
        planning_gain: result.comparativeDeltas.planning.confidenceGain,
        recovery_delta_ms: result.comparativeDeltas.recovery.elapsedMSDelta,
      })),
    )
  }

  if (ranked.some((result) => result.failedCount > 0)) process.exitCode = 1
} finally {
  await rm(benchmarkRoot, { recursive: true, force: true }).catch(() => {})
  await rm(instanceRoot, { recursive: true, force: true }).catch(() => {})
}
