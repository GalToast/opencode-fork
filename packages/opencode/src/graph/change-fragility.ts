// Change Fragility — scores how "dangerous" a file is to modify based on
// its position in the code graph for informing risk classification and
// JIT paging of dependents.

import { Log } from "@/util/log"

const log = Log.create({ service: "graph.fragility" })

export type FragilityScore = {
  file: string
  score: number
  inbound: number
  outbound: number
  depth: number
  tests: number
  risk: "low" | "medium" | "elevated" | "critical"
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

async function score(rel: string): Promise<FragilityScore> {
  const { CodeGraph } = await import("./code-graph")

  const impact = CodeGraph.impact(rel)
  const deps = CodeGraph.descendants(rel)
  const testFiles = CodeGraph.tests(rel)

  const inbound = impact.count
  const outbound = deps.length
  const depth = impact.depth

  // Coverage proxy: more test files = better coverage
  const coverage = testFiles.length > 0 ? 1 / (1 + testFiles.length) : 1.0

  // Fragility formula:
  //   (inbound_edges × 2 + outbound_edges) × (1 / test_coverage) × depth_weight
  const raw = (inbound * 2 + outbound) * coverage * Math.log2(depth + 2)

  const risk = classify(raw)

  log.debug("fragility.score", {
    file: rel,
    score: Math.round(raw * 100) / 100,
    inbound,
    outbound,
    depth,
    tests: testFiles.length,
    risk,
  })

  return {
    file: rel,
    score: raw,
    inbound,
    outbound,
    depth,
    tests: testFiles.length,
    risk,
  }
}

/** Score multiple files and sort by fragility (most fragile first). */
async function rank(files: string[]): Promise<FragilityScore[]> {
  const scores = await Promise.all(files.map((f) => score(f)))
  return scores.sort((a, b) => b.score - a.score)
}

/** Get the most fragile files in the entire graph. */
async function hotspots(limit = 10): Promise<FragilityScore[]> {
  const { CodeGraph } = await import("./code-graph")
  const stats = CodeGraph.stats()
  if (!stats.indexed) return []

  // Get all indexed file paths
  const allFiles: string[] = []
  // Access via CodeGraph's internal state through symbols
  const symbols = new Set<string>()
  for (const sym of [...Array(stats.symbols)].map((_, i) => i)) {
    // We can't iterate symbols directly — use a different approach
    void sym
  }

  // Instead, walk via Ripgrep and filter to indexed
  const { Ripgrep } = await import("@/file/ripgrep")
  const { Instance } = await import("@/project/instance")
  const path = await import("path")
  const exts = [".ts", ".tsx", ".js", ".jsx"]

  for await (const file of Ripgrep.files({ cwd: Instance.directory })) {
    const ext = path.extname(file).toLowerCase()
    if (exts.includes(ext)) allFiles.push(file)
    if (allFiles.length > 200) break // cap for performance
  }

  return rank(allFiles.slice(0, limit * 5)).then((scores) => scores.slice(0, limit))
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function classify(score: number): "low" | "medium" | "elevated" | "critical" {
  if (score >= 50) return "critical"
  if (score >= 20) return "elevated"
  if (score >= 8) return "medium"
  return "low"
}

export const ChangeFragility = {
  score,
  rank,
  hotspots,
} as const
