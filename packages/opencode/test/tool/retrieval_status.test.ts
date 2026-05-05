import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { Instance } from "../../src/project/instance"
import { RetrievalService } from "../../src/retrieval"
import { RetrievalRuntime } from "../../src/retrieval/runtime"
import { RetrievalStatusTool } from "../../src/tool/retrieval_status"

const ctx = {
  sessionID: "test" as any,
  rootSessionID: "test",
  messageID: "message" as any,
  callID: "call",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.retrieval_status", () => {
  beforeEach(async () => {
    RetrievalRuntime.reset()
    await resetDatabase()
  })

  afterEach(async () => {
    RetrievalRuntime.reset()
    await resetDatabase()
  })

  test("reports the empty retrieval state when no runs exist yet", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "retrieval-status-empty-session" as any
        const tool = await RetrievalStatusTool.init()
        // @ts-ignore
        const result = await tool.execute({ limit: 3 }, { ...ctx, sessionID, rootSessionID: sessionID })

        expect(result.title).toBe("Retrieval Status")
        expect(result.metadata.runCount).toBe(0)
        expect(result.metadata.recentRunCount).toBe(0)
        expect(result.output).toContain("document_count: 0")
        expect(result.output).toContain("run_count: 0")
        expect(result.output).toContain("benchmark_summary:")
        expect(result.output).toContain("recent_runs:")
        expect(result.output).toContain("no retrieval runs recorded yet")
      },
    })
  })

  test(
    "formats routing and fallback diagnostics from recent retrieval runs",
    async () => {
      await using tmp = await tmpdir({ git: true })

      RetrievalRuntime.configure({
        async embedText(input) {
          const vector = input.text.toLowerCase().includes("orchard") ? [1, 0] : [0, 1]
          return {
            dimensions: vector.length,
            vector,
            metadata: {
              source: "synthetic_fallback",
              fallbackReason: "provider_error",
              modelID: "fallback-embedder" as any,
            },
          }
        },
        async rerank(input) {
          return {
            candidates: input.candidates.map((item) => ({
              ...item,
              rerankScore: item.score ?? 0,
            })),
            metadata: {
              source: "synthetic_fallback",
              fallbackReason: "provider_not_configured",
              modelID: "fallback-reranker" as any,
            },
          }
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sessionID = "retrieval-status-diagnostics-session" as any
          await RetrievalService.upsertDocument({
            id: "retrieval-status-diagnostics-doc",
            projectID: Instance.project.id,
            sessionID,
            sourceType: "note",
            sourceID: "retrieval-status-diagnostics",
            title: "Retrieval status diagnostics",
            fingerprint: "retrieval-status-diagnostics-v1",
          })
          await RetrievalService.replaceChunks({
            documentID: "retrieval-status-diagnostics-doc",
            projectID: Instance.project.id,
            content: "Fallback diagnostics should stay visible when orchard relay retrieval degrades.",
          })
          await RetrievalService.search({
            projectID: Instance.project.id,
            sessionID,
            preferredSessionIDs: [sessionID],
            query: "orchard relay retrieval diagnostics",
            limit: 5,
            policy: "auto",
          })

          const tool = await RetrievalStatusTool.init()
          // @ts-ignore
          const result = await tool.execute({ limit: 1 }, { ...ctx, sessionID, rootSessionID: sessionID })

          expect(result.metadata.runCount).toBeGreaterThan(0)
          expect(result.metadata.recentRunCount).toBe(1)
          expect(result.output).toContain("routing=intent_router")
          expect(result.output).toContain("diagnostics: query_embedding=synthetic_fallback(provider_error) rerank=synthetic_fallback(provider_not_configured)")
          expect(result.output).toContain("observed_embedding_model=fallback-embedder")
          expect(result.output).toContain("observed_reranker_model=fallback-reranker")
        },
      })
    },
    20_000,
  )
})
