import { runRetrievalIntentRouterBenchmark } from "../src/harness/retrieval-intent-router-benchmark"

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"

const result = await runRetrievalIntentRouterBenchmark()

if (JSON_OUTPUT) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log("Retrieval intent router benchmark")
  console.log(`scenario_count: ${result.scenarioCount}`)
  console.log(`variant_count: ${result.variantCount}`)
  console.log(
    `overall_winner: ${result.overallWinner.id} (${Math.round(result.overallWinner.primaryIntentAccuracy * 100)}% primary, ${Math.round(result.overallWinner.exactRouteAccuracy * 100)}% exact-route)`,
  )
  console.table(
    result.variants.map((variant) => ({
      variant: variant.id,
      primary_intent_accuracy: `${Math.round(variant.primaryIntentAccuracy * 100)}%`,
      secondary_intent_accuracy: `${Math.round(variant.secondaryIntentAccuracy * 100)}%`,
      confidence_accuracy: `${Math.round(variant.confidenceAccuracy * 100)}%`,
      strategy_accuracy: `${Math.round(variant.strategyAccuracy * 100)}%`,
      exact_route_accuracy: `${Math.round(variant.exactRouteAccuracy * 100)}%`,
    })),
  )
}
