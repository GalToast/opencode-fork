// @ts-nocheck - integration test fixtures intentionally use broad table and tool result shapes.
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { RetrievalPolicy, RetrievalService } from "../../src/retrieval"
import { RetrievalRuntime } from "../../src/retrieval/runtime"
import { RecallTool } from "../../src/tool/recall"
import { RetrievalStatusTool } from "../../src/tool/retrieval_status"
import { SessionWorkGraph } from "../../src/session/workgraph"
import { Identifier } from "../../src/id/id"
import { Database, eq } from "../../src/storage/db"
import { RetrievalEmbeddingTable, RetrievalRunTable } from "../../src/retrieval/retrieval.sql"

describe("tool.recall", () => {
  afterEach(async () => {
    RetrievalRuntime.reset()
    await resetDatabase()
  })

  test(
    "indexes the current session and returns matching recall results",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const notePath = `${tmp.path}/orchard-notes.ts`
          await Bun.write(notePath, 'export const orchardHandshakeProtocol = "amber ladder fix"\n')

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [
              { type: "text", text: "Remember the orchard handshake protocol and the amber ladder fix." },
              {
                type: "file",
                mime: "text/plain",
                url: `file://${notePath.replace(/\\/g, "/")}`,
                filename: "orchard-notes.ts",
              },
            ],
          })

          const tool = await RecallTool.init()
          const result = await tool.execute(
            {
              query: "orchard handshake",
              limit: 3,
            },
            {
              sessionID: session.id,
              messageID: "msg-test-recall" as any,
              callID: "call-test-recall",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          const stats = await RetrievalService.stats(Instance.project.id)

          const second = await tool.execute(
            {
              query: "orchard handshake",
              limit: 3,
            },
            {
              sessionID: session.id,
              messageID: "message-2" as any,
              callID: "call-2",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: {},
              ask: async () => {
                throw new Error("ask should not be called")
              },
            },
          )

          const statsAfterSecond = await RetrievalService.stats(Instance.project.id)

          expect(result.title).toBe("Recall: orchard handshake")
          expect(result.metadata.indexedDocuments).toBeGreaterThan(0)
          expect(result.metadata.indexedChunks).toBeGreaterThan(0)
          expect(result.metadata.candidateCount).toBeGreaterThan(0)
          expect(result.output).toContain("indexed_documents:")
          expect(result.output).toContain("candidate_count:")
          expect(result.output).toContain("orchard handshake protocol")
          expect(result.output).toContain("orchard-notes.ts")
          expect(stats.documentCount).toBeGreaterThan(0)
          expect(stats.chunkCount).toBeGreaterThan(0)
          expect(stats.runCount).toBeGreaterThan(0)
          expect(second.metadata.indexedDocuments).toBe(0)
          expect(second.metadata.indexedChunks).toBe(0)
          expect(statsAfterSecond.documentCount).toBe(stats.documentCount)
          expect(statsAfterSecond.chunkCount).toBe(stats.chunkCount)
          expect(statsAfterSecond.runCount).toBe(stats.runCount + 1)
        },
      })
    },
    20_000,
  )

  test(
    "routes auto retrieval prompts by query intent and records the effective prompt family",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "The retrieval service owns scoped feedback bias and run metadata, and the compaction baton heuristic lives in compaction.ts.",
              },
            ],
          })

          await RetrievalService.indexSession({
            projectID: Instance.project.id,
            sessionID: session.id,
          })

          const result = await RetrievalService.search({
            projectID: Instance.project.id,
            sessionID: session.id,
            preferredSessionIDs: [session.id],
            query: "which file owns scoped feedback bias and retrieval run metadata",
            policy: "auto",
            limit: 3,
          })

          expect(result.candidates.length).toBeGreaterThan(0)
          expect(result.policy.metadata?.routingMode).toBe("intent_router")
          expect(result.policy.metadata?.routedIntent).toBe("file")
          expect(result.policy.metadata?.baseEmbedderInstructionPreset).toBe("memory.task_pattern")
          expect(result.policy.metadata?.baseRerankerInstructionPreset).toBe("memory.decision")
          expect(result.policy.embedder?.instructionPreset).toBeUndefined()
          expect(result.policy.reranker?.instructionPreset).toBeUndefined()
          expect(result.policy.embedder?.instruction).toContain("exact file paths")
          expect(result.policy.reranker?.instruction).toContain("exact file or module")
          expect(result.runMetadata?.routedIntent).toBe("file")
          expect(result.runMetadata?.routingMode).toBe("intent_router")
          expect(result.runMetadata?.embedderInstruction).toContain("exact file paths")
          expect(result.runMetadata?.rerankerInstruction).toContain("exact file or module")
          expect(result.runMetadata?.baseEmbedderInstructionPreset).toBe("memory.task_pattern")
          expect(result.runMetadata?.baseRerankerInstructionPreset).toBe("memory.decision")

          const runs = await Database.use((db) =>
            db.select().from(RetrievalRunTable).where(eq(RetrievalRunTable.id, result.runID)),
          )
          const latestRun = runs[0]
          expect(latestRun?.metadata?.routedIntent).toBe("file")
          expect(latestRun?.metadata?.routingMode).toBe("intent_router")
          expect(latestRun?.metadata?.embedderInstruction).toContain("exact file paths")
          expect(latestRun?.metadata?.rerankerInstruction).toContain("exact file or module")
        },
      })
    },
    20_000,
  )

  test(
    "indexes and retrieves task artifacts from workgraph",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const rootSessionID = session.id

          await SessionWorkGraph.recordArtifact({
            rootSessionID,
            sessionID: session.id,
            taskID: "task-test-artifact",
            messageID: "msg-test-artifact" as any,
            type: "patch",
            summary: "Test patch artifact for retrieval",
          })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Artifact content: the Pissbean artifact index implements task-artifact ingestion for retrieval.",
              },
            ],
          })

          const tool = await RecallTool.init()
          const result = await tool.execute(
            {
              query: "Pissbean artifact index task artifact",
              limit: 5,
            },
            {
              sessionID: session.id,
              rootSessionID,
              messageID: "msg-test-recall-artifact" as any,
              callID: "call-test-recall-artifact",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          expect(result.metadata.indexedDocuments).toBeGreaterThan(0)
          expect(result.output).toContain("task_artifact")
          expect(result.output).toContain("Pissbean")
        },
      })
    },
    20_000,
  )

  test(
    "filters recall results by source type",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const rootSessionID = session.id

          await SessionWorkGraph.recordArtifact({
            rootSessionID,
            sessionID: session.id,
            taskID: "task-filter-artifact",
            messageID: "msg-filter-artifact" as any,
            type: "summary",
            summary: "Wobble artifact summary",
          })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Wobble appears in both the regular session notes and the artifact summary.",
              },
            ],
          })

          const tool = await RecallTool.init()
          const result = await tool.execute(
            {
              query: "Wobble",
              limit: 5,
              source_types: ["task_artifact"],
            },
            {
              sessionID: session.id,
              rootSessionID,
              messageID: "msg-test-recall-filter" as any,
              callID: "call-test-recall-filter",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          expect(result.output).toContain("source_types: task_artifact")
          expect(result.output).toContain("task_artifact")
          expect(result.output).not.toContain("session_message")
        },
      })
    },
    20_000,
  )

  test(
    "persists local embeddings for semantic rerank",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Semantic orchard memory includes apricot relay handshake and mulberry vector routing.",
              },
            ],
          })

          const tool = await RecallTool.init()
          const result = await tool.execute(
            {
              query: "apricot relay vector",
              limit: 5,
            },
            {
              sessionID: session.id,
              rootSessionID: session.id,
              messageID: "msg-test-recall-semantic" as any,
              callID: "call-test-recall-semantic",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          const embeddings = await Database.use((db) =>
            db.select().from(RetrievalEmbeddingTable).where(eq(RetrievalEmbeddingTable.provider_id, "local")),
          )

          expect(result.metadata.candidateCount).toBeGreaterThan(0)
          expect(result.output).toContain("apricot relay handshake")
          expect(embeddings.length).toBeGreaterThan(0)
        },
      })
    },
    20_000,
  )

  test(
    "records the effective retrieval lane and index-space metadata for benchmarking",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Mixed-lane retrieval should remember the orchard relay baton and prior recovery summary.",
              },
            ],
          })

          const tool = await RecallTool.init()
          await tool.execute(
            {
              query: "orchard relay recovery",
              limit: 5,
            },
            {
              sessionID: session.id,
              rootSessionID: session.id,
              messageID: "msg-test-recall-lane-metadata" as any,
              callID: "call-test-recall-lane-metadata",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          const runs = await Database.use((db) =>
            db.select().from(RetrievalRunTable).where(eq(RetrievalRunTable.session_id, session.id)),
          )
          const latestRun = runs.at(-1)

          expect(latestRun).toBeDefined()
          expect(latestRun?.metadata?.effectiveLane).toBe("auto")
          expect(latestRun?.metadata?.pairStrategy).toBe("matched_pair")
          expect(latestRun?.metadata?.indexSpace).toBe("qwen3-embedding-0.6b")
          expect(latestRun?.metadata?.runtime).toBe("cuda")
          expect(latestRun?.metadata?.embedderModelID).toBe("qwen3-embedding-0.6b")
          expect(latestRun?.metadata?.rerankerModelID).toBe("qwen3-reranker-0.6b")
          expect(latestRun?.metadata?.queryEmbeddingSource).toBeDefined()
          expect(latestRun?.metadata?.rerankSource).toBeDefined()
          expect(latestRun?.metadata?.searchScope).toBe("session_only")
          expect(latestRun?.metadata?.sessionSelectedCount).toBeGreaterThanOrEqual(1)
          expect(latestRun?.metadata?.familySelectedCount).toBe(0)
          expect(latestRun?.metadata?.projectSelectedCount).toBe(0)
          expect(latestRun?.metadata?.phase).toBe(
            latestRun?.metadata?.queryEmbeddingSource === "provider" && latestRun?.metadata?.rerankSource === "provider"
              ? "provider-embedding-rerank"
              : latestRun?.metadata?.queryEmbeddingSource === "synthetic_fallback" &&
                  latestRun?.metadata?.rerankSource === "synthetic_fallback"
                ? "synthetic-embedding-rerank"
                : "hybrid-embedding-rerank",
          )
        },
      })
    },
    20_000,
  )

  test(
    "stores chunk embeddings separately for each retrieval index space",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let chunkEmbedCalls = 0

          RetrievalRuntime.configure({
            async embedText(input) {
              if (input.purpose === "chunk") {
                chunkEmbedCalls += 1
              }

              const indexSpace =
                (typeof input.policy.metadata?.indexSpace === "string" ? input.policy.metadata.indexSpace : undefined) ??
                (typeof input.policy.embedder?.settings?.indexSpace === "string" ? input.policy.embedder.settings.indexSpace : undefined) ??
                "default"

              const vector =
                indexSpace === "qwen3-embedding-4b-gguf"
                  ? [0.91, 0.09]
                  : [0.11, 0.89]

              return {
                dimensions: vector.length,
                vector,
                metadata: {
                  source: "test-embedder",
                  indexSpace,
                },
              }
            },
            async rerank(input) {
              return {
                candidates: input.candidates.map((candidate) => ({
                  ...candidate,
                  rerankScore: candidate.score ?? 0,
                })),
                metadata: {
                  source: "test-reranker",
                },
              }
            },
          })

          const documentID = "retrieval-document-index-space"
          await RetrievalService.upsertDocument({
            id: documentID,
            projectID: Instance.project.id,
            sourceType: "note",
            sourceID: "note:index-space",
            title: "Index space note",
            fingerprint: "fingerprint:index-space:v1",
          })
          const chunks = await RetrievalService.replaceChunks({
            documentID,
            projectID: Instance.project.id,
            content: "Index space isolation means fast and quality lanes must not reuse the same chunk vector.",
          })

          expect(chunks.length).toBeGreaterThan(0)

          await RetrievalService.search({
            projectID: Instance.project.id,
            query: "index space fast lane",
            policy: "auto",
            limit: 3,
          })

          await RetrievalService.search({
            projectID: Instance.project.id,
            query: "index space quality lane",
            policy: "quality",
            limit: 3,
          })

          const embeddings = await Database.use((db) =>
            db.select().from(RetrievalEmbeddingTable).where(eq(RetrievalEmbeddingTable.chunk_id, chunks[0]!.id)),
          )

          expect(chunkEmbedCalls).toBe(2)
          expect(embeddings.length).toBe(2)
          expect(embeddings.map((row) => row.metadata?.indexSpace).sort()).toEqual([
            "qwen3-embedding-0.6b",
            "qwen3-embedding-4b-gguf",
          ])
        },
      })
    },
    20_000,
  )

  test(
    "re-embeds a chunk when embedder semantics change within the same index space",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let chunkEmbedCalls = 0

          RetrievalRuntime.configure({
            async embedText(input) {
              if (input.purpose === "chunk") chunkEmbedCalls += 1

              const semantics = `${input.policy.embedder?.instructionPreset ?? "none"}:${input.policy.embedder?.dimensions ?? "na"}`
              const vector = semantics === "memory.task_pattern:256" ? [0.8, 0.2] : [0.2, 0.8]
              return {
                dimensions: vector.length,
                vector,
                metadata: {
                  source: "test-embedder",
                },
              }
            },
            async rerank(input) {
              return {
                candidates: input.candidates.map((candidate) => ({
                  ...candidate,
                  rerankScore: candidate.score ?? 0,
                })),
                metadata: {
                  source: "test-reranker",
                },
              }
            },
          })

          const documentID = "retrieval-document-semantic-version"
          await RetrievalService.upsertDocument({
            id: documentID,
            projectID: Instance.project.id,
            sourceType: "note",
            sourceID: "note:semantic-version",
            title: "Semantic version note",
            fingerprint: "fingerprint:semantic-version:v1",
          })
          const chunks = await RetrievalService.replaceChunks({
            documentID,
            projectID: Instance.project.id,
            content: "One semantic version orchard chunk should be re-embedded when the embedder semantics change.",
          })

          const autoPolicy = RetrievalPolicy.resolve("auto")
          const originalResolve = RetrievalPolicy.resolve
          const resolveSpy = spyOn(RetrievalPolicy, "resolve")

          try {
            if (!autoPolicy.embedder) throw new Error("auto policy embedder missing in test")

            autoPolicy.embedder.instructionPreset = "memory.task_pattern"
            autoPolicy.embedder.dimensions = 256
            autoPolicy.embedder.outputType = "dense"
            resolveSpy.mockImplementation((name) => (name === "auto" ? autoPolicy : originalResolve(name)))

            await RetrievalService.search({
              projectID: Instance.project.id,
              query: "semantic version orchard",
              policy: "auto",
              limit: 3,
            })

            autoPolicy.embedder.instructionPreset = "memory.decision"
            autoPolicy.embedder.dimensions = 1024
            autoPolicy.embedder.outputType = "float"
            resolveSpy.mockImplementation((name) => (name === "auto" ? autoPolicy : originalResolve(name)))

            await RetrievalService.search({
              projectID: Instance.project.id,
              query: "semantic version orchard",
              policy: "auto",
              limit: 3,
            })
          } finally {
            resolveSpy.mockRestore()
          }

          const embeddings = await Database.use((db) =>
            db.select().from(RetrievalEmbeddingTable).where(eq(RetrievalEmbeddingTable.chunk_id, chunks[0]!.id)),
          )

          expect(chunkEmbedCalls).toBe(2)
          expect(embeddings.length).toBe(2)
          expect(new Set(embeddings.map((row) => row.metadata?.semanticSignature)).size).toBe(2)
        },
      })
    },
    20_000,
  )

  test(
    "summarizes retrieval runs by lane, index space, and runtime sources",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "The orchard relay recovery notes include both a fast lane memory and a quality rerank decision.",
              },
            ],
          })

          const tool = await RecallTool.init()
          await tool.execute(
            { query: "orchard relay", limit: 5, policy: "auto" },
            {
              sessionID: session.id,
              rootSessionID: session.id,
              messageID: "msg-benchmark-auto" as any,
              callID: "call-benchmark-auto",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          await tool.execute(
            { query: "orchard relay", limit: 5, policy: "quality" },
            {
              sessionID: session.id,
              rootSessionID: session.id,
              messageID: "msg-benchmark-quality" as any,
              callID: "call-benchmark-quality",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          const stats = await RetrievalService.stats(Instance.project.id)
          const autoSummary = stats.benchmarkSummary.find((entry) => entry.effectiveLane === "auto")
          const qualitySummary = stats.benchmarkSummary.find((entry) => entry.effectiveLane === "quality")

          expect(autoSummary).toBeDefined()
          expect(autoSummary?.pairStrategy).toBe("matched_pair")
          expect(autoSummary?.indexSpace).toBe("qwen3-embedding-0.6b")
          expect(autoSummary?.runCount).toBe(1)

          expect(qualitySummary).toBeDefined()
          expect(qualitySummary?.pairStrategy).toBe("matched_pair")
          expect(qualitySummary?.indexSpace).toBe("qwen3-embedding-4b-gguf")
          expect(qualitySummary?.runCount).toBe(1)
        },
      })
    },
    20_000,
  )

  test(
    "retrieval_status reports grouped lane stats and recent runs to the agent",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Retrieval status should expose both mixed and matched lane history for orchard relay recovery.",
              },
            ],
          })

          const recall = await RecallTool.init()
          await recall.execute(
            { query: "orchard relay", limit: 5, policy: "auto" },
            {
              sessionID: session.id,
              rootSessionID: session.id,
              messageID: "msg-status-auto" as any,
              callID: "call-status-auto",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          await recall.execute(
            { query: "orchard relay", limit: 5, policy: "quality" },
            {
              sessionID: session.id,
              rootSessionID: session.id,
              messageID: "msg-status-quality" as any,
              callID: "call-status-quality",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          const status = await RetrievalStatusTool.init()
          const result = await status.execute(
            { limit: 5 },
            {
              sessionID: session.id,
              rootSessionID: session.id,
              messageID: "msg-status-readout" as any,
              callID: "call-status-readout",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          expect(result.title).toBe("Retrieval Status")
          expect(result.output).toContain("benchmark_summary:")
          expect(result.output).toContain("lane=auto")
          expect(result.output).toContain("lane=quality")
          expect(result.output).toContain("policy_mode=baseline")
          expect(result.output).toContain("recent_runs:")
          expect(result.output).toContain("requested_embedding_model=")
          expect(result.output).toContain("observed_embedding_model=")
          expect(result.output).toContain("routing=intent_router intent=task_pattern")
          expect(result.output).toContain("scope=session_only")
          expect(result.metadata.runCount).toBeGreaterThanOrEqual(2)
          expect(Array.isArray(result.metadata.benchmarkSummary)).toBe(true)
          expect(result.metadata.recentRunCount).toBeGreaterThanOrEqual(2)
        },
      })
    },
    20_000,
  )

  test(
    "recall and retrieval_status surface fallback diagnostics when retrieval degrades",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          RetrievalRuntime.configure({
            async embedText(input) {
              return {
                dimensions: 2,
                vector: input.purpose === "query" ? [1, 0] : [0, 1],
                metadata: {
                  source: "synthetic_fallback",
                  fallbackReason: "provider_error",
                  originalError: "embedding endpoint unavailable",
                  modelID: "fallback-embedder" as any,
                },
              }
            },
            async rerank(input) {
              return {
                candidates: input.candidates.map((candidate) => ({
                  ...candidate,
                  rerankScore: candidate.score ?? 0,
                })),
                metadata: {
                  source: "synthetic_fallback",
                  fallbackReason: "provider_not_configured",
                  originalError: "rerank endpoint missing",
                  modelID: "fallback-reranker" as any,
                },
              }
            },
          })

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Fallback diagnostics should be visible when orchard relay retrieval degrades.",
              },
            ],
          })

          const recall = await RecallTool.init()
          const recallResult = await recall.execute(
            { query: "orchard relay", limit: 5, policy: "auto" },
            {
              sessionID: session.id,
              rootSessionID: session.id,
              messageID: "msg-fallback-diagnostics" as any,
              callID: "call-fallback-diagnostics",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          expect(recallResult.output).toContain("intent: task_pattern (intent_router")
          expect(recallResult.output).toContain("diagnostics: query_embedding=synthetic_fallback(provider_error) rerank=synthetic_fallback(provider_not_configured)")
          expect(recallResult.metadata.routingMode).toBe("intent_router")
          expect(recallResult.metadata.routedIntent).toBe("task_pattern")
          expect(recallResult.metadata.queryEmbeddingFallbackReason).toBe("provider_error")
          expect(recallResult.metadata.rerankFallbackReason).toBe("provider_not_configured")

          const status = await RetrievalStatusTool.init()
          const statusResult = await status.execute(
            { limit: 5 },
            {
              sessionID: session.id,
              rootSessionID: session.id,
              messageID: "msg-status-fallback" as any,
              callID: "call-status-fallback",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          expect(statusResult.output).toContain("requested_embedding_model=qwen3-embedding-0.6b")
          expect(statusResult.output).toContain("observed_embedding_model=fallback-embedder")
          expect(statusResult.output).toContain("observed_reranker_model=fallback-reranker")
          expect(statusResult.output).toContain("routing=intent_router intent=task_pattern")
          expect(statusResult.output).toContain("diagnostics: query_embedding=synthetic_fallback(provider_error) rerank=synthetic_fallback(provider_not_configured)")
        },
      })
    },
    20_000,
  )

  test(
    "applies scoped session feedback bias to later retrieval candidates and run metadata",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          RetrievalRuntime.configure({
            async embedText(input) {
              const vector =
                /route success/.test(input.text) || /orchard recall route/.test(input.text)
                  ? [1, 0]
                  : [0, 1]
              return {
                dimensions: vector.length,
                vector,
                metadata: {
                  source: "test-embedder",
                },
              }
            },
            async rerank(input) {
              return {
                candidates: input.candidates.map((candidate) => ({
                  ...candidate,
                  rerankScore: candidate.documentID === "retrieval-document-feedback-route" ? 1 : 2,
                })),
                metadata: {
                  source: "test-reranker",
                },
              }
            },
          })

          await RetrievalService.upsertDocument({
            id: "retrieval-document-feedback-route",
            projectID: Instance.project.id,
            sessionID: session.id,
            sourceType: "note",
            sourceID: "feedback-route",
            title: "Task interaction outcome: general -> success",
            fingerprint: "feedback-route-v1",
            metadata: {
              kind: "task_interaction_outcome",
              hasOrchestrationRecall: true,
            },
            outcomeScore: 0,
            negativeSignal: false,
          })
          await RetrievalService.replaceChunks({
            documentID: "retrieval-document-feedback-route",
            projectID: Instance.project.id,
            content: "orchard recall route success pattern",
            chunkType: "task_interaction_outcome",
          })

          await RetrievalService.upsertDocument({
            id: "retrieval-document-feedback-competitor",
            projectID: Instance.project.id,
            sessionID: session.id,
            sourceType: "note",
            sourceID: "feedback-competitor",
            title: "Competitor note",
            fingerprint: "feedback-competitor-v1",
            metadata: {
              kind: "task_interaction_outcome",
            },
            outcomeScore: 0,
            negativeSignal: false,
          })
          await RetrievalService.replaceChunks({
            documentID: "retrieval-document-feedback-competitor",
            projectID: Instance.project.id,
            content: "orchard recall route competitor pattern",
            chunkType: "task_interaction_outcome",
          })

          const baseline = await RetrievalService.search({
            projectID: Instance.project.id,
            sessionID: session.id,
            preferredSessionIDs: [session.id],
            query: "orchard recall route",
            policy: "auto",
            limit: 5,
          })

          expect(baseline.candidates[0]?.documentID).toBe("retrieval-document-feedback-competitor")

          await RetrievalService.feedback({
            runID: baseline.runID,
            verdict: "orchestration_recall_success",
            score: 2,
            note: "recalled orchard route was useful",
          })
          await RetrievalService.feedback({
            runID: baseline.runID,
            verdict: "orchestration_recall_success",
            score: 2,
            note: "recalled orchard route stayed useful",
          })
          await RetrievalService.feedback({
            runID: baseline.runID,
            verdict: "orchestration_recall_success",
            score: 2,
            note: "recalled orchard route resolved the next turn",
          })
          await RetrievalService.feedback({
            runID: baseline.runID,
            verdict: "orchestration_recall_success",
            score: 2,
            note: "recalled orchard route stayed durable across retries",
          })

          const biased = await RetrievalService.search({
            projectID: Instance.project.id,
            sessionID: session.id,
            preferredSessionIDs: [session.id],
            query: "orchard recall route",
            policy: "auto",
            limit: 5,
          })

          expect(biased.candidates.length).toBeGreaterThan(0)
          expect(biased.candidates[0]?.documentID).toBe("retrieval-document-feedback-route")
          const seededCandidate = biased.candidates.find((candidate) => candidate.documentID === "retrieval-document-feedback-route")
          expect(seededCandidate).toBeDefined()
          expect(seededCandidate?.feedbackScore).toBeGreaterThan(0)

          const runs = await Database.use((db) =>
            db.select().from(RetrievalRunTable).where(eq(RetrievalRunTable.id, biased.runID)),
          )
          const latestRun = runs[0]

          expect(latestRun).toBeDefined()
          expect((latestRun?.metadata?.feedbackBias as any)?.orchestrationRecall).toBeGreaterThan(0)
          expect(latestRun?.metadata?.feedbackBiasScope).toBe("session_only")
        },
      })
    },
    20_000,
  )

  test(
    "does not leak feedback bias across sibling sessions in the same project",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const seededSession = await Session.create({})
          const isolatedSession = await Session.create({})

          RetrievalRuntime.configure({
            async embedText(input) {
              const vector =
                /route success/.test(input.text) || /orchard recall route/.test(input.text)
                  ? [1, 0]
                  : [0, 1]
              return {
                dimensions: vector.length,
                vector,
                metadata: {
                  source: "test-embedder",
                },
              }
            },
            async rerank(input) {
              return {
                candidates: input.candidates.map((candidate) => ({
                  ...candidate,
                  rerankScore: candidate.documentID.includes("feedback-route") ? 1 : 2,
                })),
                metadata: {
                  source: "test-reranker",
                },
              }
            },
          })

          for (const [session, suffix] of [
            [seededSession, "seeded"],
            [isolatedSession, "isolated"],
          ] as const) {
            await RetrievalService.upsertDocument({
              id: `retrieval-document-feedback-route-${suffix}`,
              projectID: Instance.project.id,
              sessionID: session.id,
              sourceType: "note",
              sourceID: `feedback-route-${suffix}`,
              title: "Task interaction outcome: general -> success",
              fingerprint: `feedback-route-${suffix}-v1`,
              metadata: {
                kind: "task_interaction_outcome",
                hasOrchestrationRecall: true,
              },
              outcomeScore: 0,
              negativeSignal: false,
            })
            await RetrievalService.replaceChunks({
              documentID: `retrieval-document-feedback-route-${suffix}`,
              projectID: Instance.project.id,
              content: "orchard recall route success pattern",
              chunkType: "task_interaction_outcome",
            })

            await RetrievalService.upsertDocument({
              id: `retrieval-document-feedback-competitor-${suffix}`,
              projectID: Instance.project.id,
              sessionID: session.id,
              sourceType: "note",
              sourceID: `feedback-competitor-${suffix}`,
              title: "Competitor note",
              fingerprint: `feedback-competitor-${suffix}-v1`,
              metadata: {
                kind: "task_interaction_outcome",
              },
              outcomeScore: 0,
              negativeSignal: false,
            })
            await RetrievalService.replaceChunks({
              documentID: `retrieval-document-feedback-competitor-${suffix}`,
              projectID: Instance.project.id,
              content: "orchard recall route competitor pattern",
              chunkType: "task_interaction_outcome",
            })
          }

          const seededBaseline = await RetrievalService.search({
            projectID: Instance.project.id,
            sessionID: seededSession.id,
            preferredSessionIDs: [seededSession.id],
            query: "orchard recall route",
            policy: "auto",
            limit: 5,
          })

          expect(seededBaseline.candidates[0]?.documentID).toBe("retrieval-document-feedback-competitor-seeded")

          for (const note of [
            "recalled orchard route was useful",
            "recalled orchard route stayed useful",
            "recalled orchard route resolved the next turn",
            "recalled orchard route stayed durable across retries",
          ]) {
            await RetrievalService.feedback({
              runID: seededBaseline.runID,
              verdict: "orchestration_recall_success",
              score: 2,
              note,
            })
          }

          const isolatedSearch = await RetrievalService.search({
            projectID: Instance.project.id,
            sessionID: isolatedSession.id,
            preferredSessionIDs: [isolatedSession.id],
            query: "orchard recall route",
            policy: "auto",
            limit: 5,
          })

          expect(isolatedSearch.candidates[0]?.documentID).toBe("retrieval-document-feedback-competitor-isolated")

          const isolatedSeededCandidate = isolatedSearch.candidates.find(
            (candidate) => candidate.documentID === "retrieval-document-feedback-route-isolated",
          )
          expect(isolatedSeededCandidate?.feedbackScore ?? 0).toBe(0)

          const runs = await Database.use((db) =>
            db.select().from(RetrievalRunTable).where(eq(RetrievalRunTable.id, isolatedSearch.runID)),
          )
          const latestRun = runs[0]
          expect((latestRun?.metadata?.feedbackBias as any)?.orchestrationRecall ?? 0).toBe(0)
          expect(latestRun?.metadata?.feedbackBiasScope).toBe("session_only")
        },
      })
    },
    20_000,
  )

  test(
    "recall retrieves compaction-relevant context with intent routing",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Keep the compaction baton heuristic alive — the index-space rule for fast and quality lanes must stay isolated.",
              },
            ],
          })

          const tool = await RecallTool.init()
          const result = await tool.execute(
            {
              query: "keep alive through compaction index space rule",
              limit: 5,
            },
            {
              sessionID: session.id,
              messageID: "msg-compaction-recall" as any,
              callID: "call-compaction-recall",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          expect(result.metadata.candidateCount).toBeGreaterThan(0)
          expect(result.output).toContain("compaction")
          expect(result.output).toContain("index-space")
        },
      })
    },
    20_000,
  )

  test(
    "recall diagnostics report embedding and rerank source in output",
    async () => {
      await using tmp = await tmpdir({ git: true })

      RetrievalRuntime.configure({
        async embedText(input) {
          return {
            dimensions: 3,
            vector: [0.5, 0.5, 0.0],
            metadata: {
              source: "synthetic_fallback",
              fallbackReason: "provider_unavailable",
              modelID: "synthetic-embedder" as any,
            },
          }
        },
        async rerank(input) {
          return {
            candidates: input.candidates.map((c: any) => ({ ...c, rerankScore: c.score ?? 0 })),
            metadata: {
              source: "synthetic_fallback",
              fallbackReason: "reranker_unavailable",
              modelID: "synthetic-reranker" as any,
            },
          }
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [
              {
                type: "text",
                text: "Diagnostic recall: orchard relay with synthetic fallback.",
              },
            ],
          })

          const tool = await RecallTool.init()
          const result = await tool.execute(
            {
              query: "orchard relay diagnostic",
              limit: 3,
            },
            {
              sessionID: session.id,
              messageID: "msg-diagnostic-recall" as any,
              callID: "call-diagnostic-recall",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata() {},
              async ask() {},
            },
          )

          expect(result.output).toContain("diagnostics:")
          expect(result.output).toContain("query_embedding=synthetic_fallback")
          expect(result.output).toContain("rerank=synthetic_fallback")
        },
      })
    },
    20_000,
  )
})
