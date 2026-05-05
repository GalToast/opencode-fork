import { HarnessState } from "../src/harness/state"
import { extractHarnessRecoveryConfidenceCases } from "../src/harness/recovery-confidence-case-extractor"

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"
const LIMIT = Number(process.env.HARNESS_RECOVERY_CONFIDENCE_LIMIT ?? "20")

const [snapshot, observations] = await Promise.all([HarnessState.getSnapshot(), HarnessState.listObservations(500)])
const result = extractHarnessRecoveryConfidenceCases({
  snapshot,
  observations,
  limit: LIMIT,
})

if (JSON_OUTPUT) {
  console.log(
    JSON.stringify(
      {
        snapshotPath: HarnessState.snapshotPath(),
        observationsPath: HarnessState.observationsPath(),
        ...result,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

console.log(`harness_snapshot: ${HarnessState.snapshotPath()}`)
console.log(`harness_observations: ${HarnessState.observationsPath()}`)
console.log(`observation_count: ${result.summary.observationCount}`)
console.log(`proposal_group_count: ${result.summary.proposalGroupCount}`)
console.log(`candidate_count: ${result.summary.candidateCount}`)
console.log(`confidence_candidate_count: ${result.summary.byFamily.retrieval_confidence_quality}`)
console.log(`recovery_candidate_count: ${result.summary.byFamily.retrieval_multiturn_recovery}`)
console.log("")

if (result.candidates.length === 0) {
  console.log("No recovery/confidence replay candidates found in the current harness runtime.")
  process.exit(0)
}

console.log("Top candidates:")
for (const item of result.candidates) {
  console.log(`- ${item.id}`)
  console.log(`  family: ${item.benchmarkFamily}`)
  console.log(`  category: ${item.category}`)
  console.log(`  proposal: ${item.proposalID ?? "none"}`)
  console.log(`  expected_action_hint: ${item.expectedActionHint}`)
  console.log(`  observations: ${item.observationCount}`)
  console.log(`  detail: ${item.detail}`)
}

console.log("")
console.log("Paste-ready candidates:")
console.log("export const GENERATED_HARNESS_RECOVERY_CONFIDENCE_CASES = [")
for (const item of result.candidates) {
  console.log("  {")
  console.log(`    id: ${JSON.stringify(item.id)},`)
  console.log(`    benchmarkFamily: ${JSON.stringify(item.benchmarkFamily)},`)
  console.log(`    category: ${JSON.stringify(item.category)},`)
  console.log(`    proposalID: ${JSON.stringify(item.proposalID)},`)
  console.log(`    title: ${JSON.stringify(item.title)},`)
  console.log(`    detail: ${JSON.stringify(item.detail)},`)
  console.log(`    expectedActionHint: ${JSON.stringify(item.expectedActionHint)},`)
  console.log(`    observationKinds: ${JSON.stringify(item.observationKinds)},`)
  console.log(`    observationDigest: ${JSON.stringify(item.observationDigest)},`)
  console.log("  },")
}
console.log("] as const")
