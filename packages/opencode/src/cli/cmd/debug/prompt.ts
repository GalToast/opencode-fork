import { EOL } from "os"
import { basename } from "path"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import {
  resolvePromptTuningModels,
  runPromptTuningBenchmark,
  summarizePromptTuningRecommendations,
  type PromptTuningBenchmarkResult,
  type PromptTuningModelPoolID,
} from "../../../harness/prompt-tuning-benchmark"

function printHuman(results: PromptTuningBenchmarkResult[]) {
  process.stdout.write(`Prompt tuning benchmark${EOL}`)
  process.stdout.write(`${"=".repeat(24)}${EOL}`)
  for (const result of results) {
    const misses = result.results.filter((item) => !item.correct)
    process.stdout.write(
      [
        `${result.benchmarkModel.providerID}/${result.benchmarkModel.modelID}`,
        `  accuracy: ${result.correctCount}/${result.scenarioCount} (${Math.round(result.accuracy * 100)}%)`,
        `  loose: ${result.looseCorrectCount}/${result.scenarioCount} (${Math.round(result.looseAccuracy * 100)}%)`,
        `  avg latency: ${result.averageLatencyMS}ms`,
        ...result.categorySummary.map(
          (category) =>
            `  - ${category.category}: ${category.correctCount}/${category.scenarioCount} (${Math.round(category.accuracy * 100)}%)`,
        ),
        ...misses.map((item) =>
          [
            `  ${item.looseCorrect ? "~" : "x"} ${item.id}: ${item.looseCorrect ? "contract drift" : "decision miss"}`,
            `    expected: ${item.expected}`,
            `    canonical: ${item.canonical || "<none>"}`,
            `    output: ${JSON.stringify(item.output)}`,
            ...(item.error ? [`    error: ${item.error}`] : []),
          ].join(EOL),
        ),
        "",
      ].join(EOL),
    )
  }

  const recommendations = summarizePromptTuningRecommendations(results)
  if (recommendations.length === 0) return

  process.stdout.write(`Recommendations${EOL}`)
  process.stdout.write(`${"-".repeat(15)}${EOL}`)
  for (const item of recommendations) {
    process.stdout.write(
      [
        `${item.category}: ${Math.round(item.averageAccuracy * 100)}% strict / ${Math.round(item.averageLooseAccuracy * 100)}% loose`,
        `  models: ${item.modelIDs.join(", ")}`,
        `  tune: ${item.recommendation}`,
      ].join(EOL) + EOL,
    )
  }
}

export const PromptBenchmarkCommand = cmd({
  command: "prompt-benchmark",
  describe: "run prompt-tuning benchmark scenarios across selected model pools",
  builder: (yargs) =>
    yargs
      .option("pool", {
        type: "string",
        choices: ["alibaba-coding-plan", "free-opencode", "all"],
        default: "all",
        description: "Which benchmark model pool to run",
      })
      .option("model", {
        type: "string",
        description: "Run only one exact model id from the selected pool",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description: "Emit machine-readable JSON instead of a human summary",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const pool = (args.pool ?? "all") as PromptTuningModelPoolID
      const selected = resolvePromptTuningModels(pool)
      const models = args.model ? selected.filter((item) => item.modelID === args.model) : selected

      if (models.length === 0) {
        const scope = args.model ? ` in pool ${pool}` : ""
        process.stderr.write(
          `No prompt-benchmark models found${scope}. Run '${basename(process.execPath)} debug prompt-benchmark --pool ${pool}' to inspect available choices.${EOL}`,
        )
        process.exit(1)
      }

      const results: PromptTuningBenchmarkResult[] = []
      for (const benchmarkModel of models) {
        process.stderr.write(`Running ${benchmarkModel.providerID}/${benchmarkModel.modelID}...${EOL}`)
        results.push(await runPromptTuningBenchmark({ benchmarkModel }))
      }

      if (args.json) {
        process.stdout.write(JSON.stringify({ pool, results, recommendations: summarizePromptTuningRecommendations(results) }, null, 2) + EOL)
        return
      }

      printHuman(results)
    })
  },
})
