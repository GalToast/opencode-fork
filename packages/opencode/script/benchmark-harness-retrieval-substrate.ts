import { $ } from "bun"
import { mkdtemp, mkdir, rm } from "fs/promises"
import os from "os"
import path from "path"
import { Log } from "../src/util/log"
import { runRetrievalSubstrateBenchmark } from "../src/harness/retrieval-substrate-benchmark"

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"

async function createWorkspace(baseDir: string, scenarioID: string) {
  const directory = path.join(baseDir, scenarioID)
  await mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await $`git commit --allow-empty -m ${`root commit ${scenarioID}`}`.cwd(directory).quiet()
  return directory
}

await Log.init({ print: false })

const root = await mkdtemp(path.join(os.tmpdir(), "opencode-retrieval-substrate-benchmark-"))

try {
  const result = await runRetrievalSubstrateBenchmark({
    prepareWorkspace: (scenarioID) => createWorkspace(root, scenarioID),
  })

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log("Retrieval substrate benchmark")
    console.log(`success_rate: ${Math.round(result.successRate * 100)}% (${result.passedCount}/${result.scenarioCount})`)
    console.log(`average_elapsed_ms: ${result.averageElapsedMS}`)
    console.table(
      result.results.map((item) => ({
        scenario: item.id,
        category: item.category,
        ok: item.ok,
        elapsedMS: item.elapsedMS,
        summary: item.summary,
      })),
    )
  }

  if (result.failedCount > 0) process.exitCode = 1
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
