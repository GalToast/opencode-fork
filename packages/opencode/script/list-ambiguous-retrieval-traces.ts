import { readFile } from "fs/promises"
import { retrievalTracePath, retrievalTraceAmbiguityFlags, type RetrievalTraceEntry } from "../src/retrieval/trace"

interface ExtendedTraceEntry extends RetrievalTraceEntry {
  routingScoreSpread?: number
  topCandidateScoreGap?: number
  routedIntentSecondary?: string
  topCandidateRerankGap?: number
}

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"
const INPUT_PATH = process.env.OPENCODE_DEBUG_RETRIEVAL_TRACE_PATH?.trim() || retrievalTracePath()
const LIMIT = Number(process.env.RETRIEVAL_TRACE_AMBIGUOUS_LIMIT ?? "20")

function parseLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ExtendedTraceEntry)
}

function ambiguityScore(entry: ExtendedTraceEntry) {
  const flags = entry.ambiguityFlags?.length ? entry.ambiguityFlags : retrievalTraceAmbiguityFlags(entry)
  const scoreSpreadWeight =
    typeof entry.routingScoreSpread === "number" ? Math.max(0, 2 - Math.min(2, entry.routingScoreSpread)) : 0
  const topGapWeight =
    typeof entry.topCandidateScoreGap === "number" ? Math.max(0, 0.5 - Math.min(0.5, entry.topCandidateScoreGap)) : 0
  return Number((flags.length + scoreSpreadWeight + topGapWeight).toFixed(4))
}

const text = await readFile(INPUT_PATH, "utf8")
const traces = parseLines(text)
  .map((entry) => ({
    ...entry,
    ambiguityFlags: entry.ambiguityFlags?.length ? entry.ambiguityFlags : retrievalTraceAmbiguityFlags(entry),
  }))
  .filter((entry) => entry.ambiguityFlags.length > 0)
  .sort((a, b) => {
    const scoreDiff = ambiguityScore(b) - ambiguityScore(a)
    if (scoreDiff !== 0) return scoreDiff
    return Date.parse(b.timestamp) - Date.parse(a.timestamp)
  })
  .slice(0, LIMIT)

if (JSON_OUTPUT) {
  console.log(
    JSON.stringify(
      {
        inputPath: INPUT_PATH,
        traceCount: traces.length,
        traces: traces.map((entry) => ({
          timestamp: entry.timestamp,
          query: entry.query,
          detail: entry.detail,
          routedIntent: entry.routedIntent,
          routedIntentSecondary: entry.routedIntentSecondary,
          routingConfidence: entry.routingConfidence,
          routingStrategy: entry.routingStrategy,
          routingScoreSpread: entry.routingScoreSpread,
          topCandidateScoreGap: entry.topCandidateScoreGap,
          topCandidateRerankGap: entry.topCandidateRerankGap,
          ambiguityFlags: entry.ambiguityFlags,
          topCandidates: entry.topCandidates.slice(0, 3),
        })),
      },
      null,
      2,
    ),
  )
} else {
  console.log(`retrieval_trace_input: ${INPUT_PATH}`)
  console.log(`ambiguous_trace_count: ${traces.length}`)
  console.log("")
  console.table(
    traces.map((entry) => ({
      timestamp: entry.timestamp,
      routed_intent: entry.routedIntent ?? "-",
      secondary_intent: entry.routedIntentSecondary ?? "-",
      confidence: entry.routingConfidence ?? "-",
      strategy: entry.routingStrategy ?? "-",
      score_spread: entry.routingScoreSpread ?? "-",
      top_gap: entry.topCandidateScoreGap ?? "-",
      flags: entry.ambiguityFlags.join(", "),
      query: entry.query.slice(0, 80),
    })),
  )
}
