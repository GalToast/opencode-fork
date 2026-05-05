import { runRetrievalTraceRankerAblationBenchmark } from "../src/harness/retrieval-trace-ranker-ablation-benchmark"

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"
const LIMIT = Number(process.env.RETRIEVAL_TRACE_REPLAY_LIMIT ?? "50")

const result = await runRetrievalTraceRankerAblationBenchmark({
  limit: Number.isFinite(LIMIT) && LIMIT > 0 ? LIMIT : undefined,
})

if (JSON_OUTPUT) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log("Retrieval trace ranker ablation benchmark")
  console.log(`scenario_count: ${result.scenarioCount}`)
  console.log(`variant_count: ${result.variantCount}`)
  console.log(
    `overall_winner: ${result.overallWinner.id} (${Math.round(result.overallWinner.topDocumentReplayAccuracy * 100)}% top-doc, MRR ${result.overallWinner.meanReciprocalRank.toFixed(3)}, avg-rank ${result.overallWinner.averageCorrectDocumentRank.toFixed(2)})`,
  )
  console.table(
    result.variants.map((variant) => ({
      variant: variant.id,
      top_document_replay_accuracy: `${Math.round(variant.topDocumentReplayAccuracy * 100)}%`,
      mean_reciprocal_rank: variant.meanReciprocalRank.toFixed(3),
      average_correct_document_rank: variant.averageCorrectDocumentRank.toFixed(2),
    })),
  )
}
