import {
  runRetrievalParallelToolCallingBenchmark,
  classifyRetrievalParallelToolCallingLift,
  retrievalParallelToolCallingPolicyHint,
} from "../src/harness/retrieval-parallel-tool-calling-benchmark"
import { mkdir, mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "../src/project/instance"
import { Log } from "../src/util/log"
import { ProviderID } from "../src/provider/schema"
import { ModelID } from "../src/provider/schema"

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"
const benchmarkModel =
  process.env.HARNESS_BENCH_PROVIDER_ID && process.env.HARNESS_BENCH_MODEL_ID
    ? {
        providerID: ProviderID.make(process.env.HARNESS_BENCH_PROVIDER_ID),
        modelID: ModelID.make(process.env.HARNESS_BENCH_MODEL_ID),
      }
    : undefined

async function withWorkspace<T>(fn: (prepareWorkspace: (scenarioID: string) => Promise<string>) => Promise<T>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-parallel-tool-call-"))
  const directories: string[] = []
  const prepareWorkspace = async (scenarioID: string) => {
    const dir = path.join(root, scenarioID)
    await mkdir(dir, { recursive: true })
    await Bun.write(path.join(dir, ".keep"), "")
    directories.push(dir)
    return dir
  }
  try {
    return await fn(prepareWorkspace)
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

await Log.init({ print: false })

const result = await withWorkspace((prepareWorkspace) =>
  Instance.provide({
    directory: process.cwd(),
    fn: async () =>
      runRetrievalParallelToolCallingBenchmark({
        benchmarkModel,
        prepareWorkspace,
        onProgress: JSON_OUTPUT
          ? undefined
          : (event) => {
              if (event.type === "scenario_start") {
                console.log(`starting ${event.scenarioID} [${event.category}]`)
              }
              if (event.type === "baseline_complete" || event.type === "semantic_complete") {
                const label = event.type === "baseline_complete" ? "baseline" : "semantic"
                const suffix = event.error ? ` error=${event.error}` : ""
                console.log(
                  `${event.scenarioID} ${label}: ${event.canonical || event.output || "<empty>"} (${event.elapsedMS}ms)${suffix}`,
                )
              }
              if (event.type === "scenario_complete") {
                console.log(
                  `${event.scenarioID} score: baseline=${event.baselineCorrect ? "strict" : event.baselineLooseCorrect ? "loose" : "miss"} semantic=${event.semanticCorrect ? "strict" : event.semanticLooseCorrect ? "loose" : "miss"}`,
                )
              }
            },
      }),
  }),
)
const profile = classifyRetrievalParallelToolCallingLift(result)

if (JSON_OUTPUT) {
  console.log(JSON.stringify({ ...result, profile, recommended_use: retrievalParallelToolCallingPolicyHint(profile) }, null, 2))
} else {
  console.log("Retrieval parallel tool-calling benchmark")
  console.log(`model: ${result.benchmarkModel.providerID}/${result.benchmarkModel.modelID}`)
  console.log(`scenario_count: ${result.scenarioCount}`)
  console.log(
    `baseline_accuracy: ${Math.round(result.baselineAccuracy * 100)}% (${result.baselineCorrectCount}/${result.scenarioCount})`,
  )
  console.log(
    `semantic_accuracy: ${Math.round(result.semanticAccuracy * 100)}% (${result.semanticCorrectCount}/${result.scenarioCount})`,
  )
  console.log(
    `baseline_loose_accuracy: ${Math.round(result.baselineLooseAccuracy * 100)}% (${result.baselineLooseCorrectCount}/${result.scenarioCount})`,
  )
  console.log(
    `semantic_loose_accuracy: ${Math.round(result.semanticLooseAccuracy * 100)}% (${result.semanticLooseCorrectCount}/${result.scenarioCount})`,
  )
  console.log(`decision_lift: ${result.decisionLift >= 0 ? "+" : ""}${result.decisionLift}`)
  console.log(`loose_decision_lift: ${result.looseDecisionLift >= 0 ? "+" : ""}${result.looseDecisionLift}`)
  console.log(`profile: ${profile}`)
  console.log(`recommended_use: ${retrievalParallelToolCallingPolicyHint(profile)}`)
  console.table(
    result.results.map((scenario) => ({
      scenario: scenario.id,
      category: scenario.category,
      expected: scenario.expected,
      baseline: scenario.baselineCanonical || scenario.baselineOutput,
      semantic: scenario.semanticCanonical || scenario.semanticOutput,
      baseline_ok: scenario.baselineCorrect,
      semantic_ok: scenario.semanticCorrect,
      baseline_loose_ok: scenario.baselineLooseCorrect,
      semantic_loose_ok: scenario.semanticLooseCorrect,
    })),
  )
}
