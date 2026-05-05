import { readFile } from "fs/promises"
import { retrievalTracePath, type RetrievalTraceEntry } from "../src/retrieval/trace"

const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"
const LIMIT = Number(process.env.RETRIEVAL_TRACE_EXTRACT_LIMIT ?? "20")
const INPUT_PATH = process.env.OPENCODE_DEBUG_RETRIEVAL_TRACE_PATH?.trim() || retrievalTracePath()

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
}

function parseLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RetrievalTraceEntry)
}

function uniqueKey(entry: RetrievalTraceEntry) {
  return [entry.query.trim(), entry.detail?.trim() ?? "", entry.routedIntent ?? "", entry.routingStrategy ?? ""].join("::")
}

function sharedContext(entry: RetrievalTraceEntry) {
  const parts = [
    "captured real retrieval trace",
    entry.effectivePolicy ? `policy=${entry.effectivePolicy}` : undefined,
    entry.routedIntent ? `intent=${entry.routedIntent}` : undefined,
    entry.routingConfidence ? `confidence=${entry.routingConfidence}` : undefined,
  ]
  return parts.filter(Boolean).join(" | ")
}

function detail(entry: RetrievalTraceEntry) {
  const topSnippet = entry.topCandidates[0]?.snippet
  const parts = [
    entry.detail?.trim(),
    topSnippet ? `captured top snippet: ${topSnippet}` : undefined,
    entry.topCandidates[0]?.sourceType ? `top source: ${entry.topCandidates[0].sourceType}` : undefined,
  ]
  return parts.filter(Boolean).join(" | ") || `captured ${entry.routedIntent ?? "unclassified"} retrieval trace`
}

const text = await readFile(INPUT_PATH, "utf8")
const traces = parseLines(text)
  .filter((entry) => !!entry.query?.trim())
  .filter((entry) => !!entry.routedIntent)
  .filter((entry) => entry.selectedCandidateCount > 0)
  .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))

const seen = new Set<string>()
const cases = traces
  .filter((entry) => {
    const key = uniqueKey(entry)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  .slice(0, LIMIT)
  .map((entry, index) => ({
    id: `trace_${entry.routedIntent}_${String(index + 1).padStart(2, "0")}_${slugify(entry.query)}`,
    category: entry.routedIntent,
    query: entry.query,
    sharedContext: sharedContext(entry),
    detail: detail(entry),
  }))

if (JSON_OUTPUT) {
  console.log(JSON.stringify({ inputPath: INPUT_PATH, traceCount: traces.length, caseCount: cases.length, cases }, null, 2))
} else {
  console.log(`retrieval_trace_input: ${INPUT_PATH}`)
  console.log(`trace_count: ${traces.length}`)
  console.log(`case_count: ${cases.length}`)
  console.log("")
  console.log("Paste-ready cases:")
  console.log("export const GENERATED_RETRIEVAL_TRACE_CASES = [")
  for (const item of cases) {
    console.log("  {")
    console.log(`    id: ${JSON.stringify(item.id)},`)
    console.log(`    category: ${JSON.stringify(item.category)},`)
    console.log(`    query: ${JSON.stringify(item.query)},`)
    console.log(`    sharedContext: ${JSON.stringify(item.sharedContext)},`)
    console.log(`    detail: ${JSON.stringify(item.detail)},`)
    console.log("  },")
  }
  console.log("] as const")
}
