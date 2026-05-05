// @ts-nocheck
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { runRetrievalTraceReplayBenchmark } from "../../src/harness/retrieval-trace-replay-benchmark"

describe("harness retrieval trace replay benchmark", () => {
  test("live trace replay favors intent routing over the static default pair", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-trace-replay-test-"))
    const tracePath = path.join(root, "search-trace.jsonl")

    try {
      const lines = [
        {
          timestamp: "2026-03-28T10:00:00.000Z",
          runID: "run-1",
          projectID: "proj-1",
          query: "which file actually routes auto retrieval prompts by query intent",
          detail: "exact owner file for intent routing",
          requestedPolicy: "auto",
          effectivePolicy: "auto",
          limit: 5,
          routedIntent: "file",
          lexicalCandidateCount: 12,
          selectedCandidateCount: 3,
          topCandidates: [
            {
              rank: 1,
              documentID: "doc-file",
              chunkID: "doc-file-chunk-0",
              sourceType: "note",
              title: "retrieval prompt router owner",
              snippet: "packages/opencode/src/retrieval/prompt.ts routes query intent",
            },
            {
              rank: 2,
              documentID: "doc-decision",
              chunkID: "doc-decision-chunk-0",
              sourceType: "note",
              title: "lane policy decision",
              snippet: "settled default lane and compatibility rule",
            },
          ],
        },
        {
          timestamp: "2026-03-28T11:00:00.000Z",
          runID: "run-2",
          projectID: "proj-1",
          query: "find the regression where provider rerank and fallback rerank diverged and how we fixed it",
          detail: "provider fallback parity recovery",
          requestedPolicy: "auto",
          effectivePolicy: "auto",
          limit: 5,
          routedIntent: "recovery",
          lexicalCandidateCount: 8,
          selectedCandidateCount: 3,
          topCandidates: [
            {
              rank: 1,
              documentID: "doc-recovery",
              chunkID: "doc-recovery-chunk-0",
              sourceType: "note",
              title: "provider fallback recovery",
              snippet: "fallback rerank divergence and the parity fix",
            },
            {
              rank: 2,
              documentID: "doc-decision-2",
              chunkID: "doc-decision-2-chunk-0",
              sourceType: "note",
              title: "compatibility commitment",
              snippet: "settled retrieval constraint and lane default",
            },
          ],
        },
        {
          timestamp: "2026-03-28T12:00:00.000Z",
          runID: "run-3",
          projectID: "proj-1",
          query: "preserve terse symbols filenames and identifiers through prompt compaction",
          detail: "short technical symbol retention during compaction",
          requestedPolicy: "auto",
          effectivePolicy: "auto",
          limit: 5,
          routedIntent: "compaction",
          lexicalCandidateCount: 7,
          selectedCandidateCount: 3,
          topCandidates: [
            {
              rank: 1,
              documentID: "doc-compaction",
              chunkID: "doc-compaction-chunk-0",
              sourceType: "note",
              title: "compaction retention",
              snippet: "retain terse identifiers and filenames through compaction",
            },
            {
              rank: 2,
              documentID: "doc-file-2",
              chunkID: "doc-file-2-chunk-0",
              sourceType: "note",
              title: "file owner lookup",
              snippet: "exact file path and module owner for retrieval routing",
            },
          ],
        },
      ]

      await writeFile(tracePath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8")

      const result = await runRetrievalTraceReplayBenchmark({ tracePath, includeSeededScenarios: false })

      expect(result.suite).toBe("retrieval_trace_replay")
      expect(result.scenarioCount).toBe(3)
      expect(result.variantCount).toBe(2)
      expect(result.overallWinner.id).toBe("auto_routed_current")

      const byID = new Map(result.variants.map((variant) => [variant.id, variant]))
      expect(byID.get("auto_current_static_pair")?.primaryIntentAccuracy).toBe(0)
      expect(byID.get("auto_routed_current")?.primaryIntentAccuracy).toBe(1)
      expect(byID.get("auto_routed_current")?.embedderIntentAccuracy).toBe(1)
      expect(byID.get("auto_routed_current")?.rerankerIntentAccuracy).toBe(1)
      expect(byID.get("auto_routed_current")?.topDocumentReplayAccuracy).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {})
    }
  })
})
