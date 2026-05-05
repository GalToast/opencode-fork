import { runRetrievalTraceReplayBenchmark } from "../src/harness/retrieval-trace-replay-benchmark"

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"
const LIMIT = Number(process.env.RETRIEVAL_TRACE_REPLAY_LIMIT ?? "50")

const result = await runRetrievalTraceReplayBenchmark({
  limit: Number.isFinite(LIMIT) && LIMIT > 0 ? LIMIT : undefined,
})

if (JSON_OUTPUT) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log("Retrieval trace replay benchmark")
  console.log(`trace_path: ${result.tracePath}`)
  console.log(`scenario_count: ${result.scenarioCount}`)
  console.log(`variant_count: ${result.variantCount}`)
  console.log(
    `overall_winner: ${result.overallWinner.id} (${Math.round(result.overallWinner.primaryIntentAccuracy * 100)}% primary, ${Math.round(result.overallWinner.topDocumentReplayAccuracy * 100)}% top-doc, ${Math.round(result.overallWinner.exactRouteAccuracy * 100)}% exact)`,
  )
  console.table(
    result.variants.map((variant) => ({
      variant: variant.id,
      primary_intent_accuracy: `${Math.round(variant.primaryIntentAccuracy * 100)}%`,
      top_document_replay_accuracy: `${Math.round(variant.topDocumentReplayAccuracy * 100)}%`,
      exact_route_accuracy: `${Math.round(variant.exactRouteAccuracy * 100)}%`,
      embedder_intent_accuracy: `${Math.round(variant.embedderIntentAccuracy * 100)}%`,
      reranker_intent_accuracy: `${Math.round(variant.rerankerIntentAccuracy * 100)}%`,
      avg_elapsed_ms: variant.averageElapsedMS,
    })),
  )
}
