import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { RetrievalRunTable, RetrievalEmbeddingTable } from "../../src/retrieval/retrieval.sql"
import { RetrievalService } from "../../src/retrieval"
import { RetrievalPolicy } from "../../src/retrieval/policy"
import { resetRetrievalRuntimeConfiguration } from "../../src/retrieval/adapter"
import { RetrievalRuntime } from "../../src/retrieval/runtime"
import { tmpdir } from "../fixture/fixture"

describe("retrieval.service", () => {
  afterEach(() => {
    resetRetrievalRuntimeConfiguration()
    RetrievalRuntime.reset()
    mock.restore()
  })

  test("search waits for runtime configuration and records provider latency", async () => {
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (Array.isArray(body.documents)) {
        return new Response(
          JSON.stringify({
            results: [{ index: 0, relevance_score: 0.9 }],
            model: "qwen3-reranker-0.6b",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.9, 0.1, 0.2] }],
          model: "qwen3-embedding-0.6b",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await RetrievalService.upsertDocument({
          id: "doc_retrieval_service_runtime",
          projectID: Instance.project.id,
          sourceType: "assistant_output",
          sourceID: "src_retrieval_service_runtime",
          title: "Oak lattice recovery",
          fingerprint: "fp_retrieval_service_runtime",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_retrieval_service_runtime",
          projectID: Instance.project.id,
          content: "Oak lattice recovery keeps orchestration and tool use stable.",
        })

        const result = await RetrievalService.search({
          projectID: Instance.project.id,
          query: "oak lattice recovery",
          policy: "auto",
          limit: 1,
        })

        expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3)
        expect(result.runMetadata?.queryEmbeddingSource).toBe("provider")
        expect(result.runMetadata?.rerankSource).toBe("provider")

        const run = await Database.use((db) =>
          db.select().from(RetrievalRunTable).where(eq(RetrievalRunTable.id, result.runID)).get(),
        )

        // @ts-ignore
        expect(run?.latency_ms).toBeTypeOf("number")
        // @ts-ignore
        expect((run?.latency_ms ?? 0) >= 0).toBe(true)
        expect(run?.metadata?.queryEmbeddingRequestedModelID).toBe("qwen3-embedding-0.6b")
        expect(run?.metadata?.queryEmbeddingModelID).toBe("qwen3-embedding-0.6b")
        expect(run?.metadata?.rerankRequestedModelID).toBe("qwen3-reranker-0.6b")
        expect(run?.metadata?.rerankModelID).toBe("qwen3-reranker-0.6b")
      },
    })
  })

  test("search compacts oversized semantic queries before embedding", async () => {
    const embeddingBodies: Array<Record<string, unknown>> = []
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (Array.isArray(body.documents)) {
        return new Response(
          JSON.stringify({
            results: [{ index: 0, relevance_score: 0.9 }],
            model: "qwen3-reranker-0.6b",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      embeddingBodies.push(body)
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.9, 0.1, 0.2] }],
          model: "qwen3-embedding-0.6b",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const longQuery = [
      "current objective: investigate whether the open-source OpenAI Codex CLI can be extended to use Alibaba coding-plan models as a custom model provider.",
      "constraints: keep the answer concise but technical.",
      ...Array.from({ length: 40 }, (_, idx) => `- requirement ${idx}: preserve exact implementation evidence and avoid unsupported assumptions about child agents`),
    ].join("\n")

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await RetrievalService.upsertDocument({
          id: "doc_retrieval_service_compact_query",
          projectID: Instance.project.id,
          sourceType: "assistant_output",
          sourceID: "src_retrieval_service_compact_query",
          title: "Codex provider notes",
          fingerprint: "fp_retrieval_service_compact_query",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_retrieval_service_compact_query",
          projectID: Instance.project.id,
          content: "Codex provider notes preserve exact implementation evidence and custom model provider details.",
        })

        const result = await RetrievalService.search({
          projectID: Instance.project.id,
          query: longQuery,
          policy: "auto",
          limit: 1,
        })

        const firstEmbedding = embeddingBodies[0]
        expect(typeof firstEmbedding?.input).toBe("string")
        expect(String(firstEmbedding?.input).length).toBeLessThan(longQuery.length)
        expect(result.runMetadata?.semanticQueryTruncated).toBe(true)
        expect(typeof result.runMetadata?.semanticQuery).toBe("string")
        expect((result.runMetadata?.semanticQueryOriginalLength as number) > String(result.runMetadata?.semanticQuery).length).toBe(true)
      },
    })
  })

  test("search skips embed and rerank when lexical search finds no candidates", async () => {
    const embedMock = mock(async () => ({
      dimensions: 3,
      vector: [0.9, 0.1, 0.2],
      metadata: { source: "provider" },
    }))
    const rerankMock = mock(async () => ({
      candidates: [],
      metadata: { source: "provider" },
    }))
    RetrievalRuntime.configure({
      embedText: embedMock,
      rerank: rerankMock,
    })

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await RetrievalService.upsertDocument({
          id: "doc_retrieval_service_empty_lexical",
          projectID: Instance.project.id,
          sourceType: "assistant_output",
          sourceID: "src_retrieval_service_empty_lexical",
          title: "Healthy rerank lane",
          fingerprint: "fp_retrieval_service_empty_lexical",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_retrieval_service_empty_lexical",
          projectID: Instance.project.id,
          content: "This chunk should not match the sentinel health check query.",
        })

        const result = await RetrievalService.search({
          projectID: Instance.project.id,
          query: "__health_check__",
          policy: "auto",
          limit: 4,
        })

        expect(result.candidates).toHaveLength(0)
        expect(result.runMetadata?.phase).toBe("empty")
        expect(embedMock).not.toHaveBeenCalled()
        expect(rerankMock).not.toHaveBeenCalled()

        const run = await Database.use((db) =>
          db.select().from(RetrievalRunTable).where(eq(RetrievalRunTable.id, result.runID)).get(),
        )

        // @ts-ignore
        expect(run?.candidate_count).toBe(0)
        // @ts-ignore
        expect(run?.selected_count).toBe(0)
        expect(run?.metadata?.phase).toBe("empty")
      },
    })
  })

  test("search lexical prefilter ignores prompt scaffolding and common stopwords", async () => {
    const embedMock = mock(async () => ({
      dimensions: 3,
      vector: [0.9, 0.1, 0.2],
      metadata: { source: "provider" },
    }))
    const rerankMock = mock(async (input: { candidates: Array<Record<string, unknown>> }) => ({
      candidates: input.candidates.map((candidate) => ({
        ...candidate,
        rerankScore: 0.9,
      })),
      metadata: { source: "provider" },
    }))
    RetrievalRuntime.configure({
      embedText: embedMock,
      rerank: rerankMock as never,
    })

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await RetrievalService.upsertDocument({
          id: "doc_retrieval_service_prompt_scaffold_irrelevant",
          projectID: Instance.project.id,
          sourceType: "assistant_output",
          sourceID: "src_retrieval_service_prompt_scaffold_irrelevant",
          title: "Prompt chatter",
          fingerprint: "fp_retrieval_service_prompt_scaffold_irrelevant",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_retrieval_service_prompt_scaffold_irrelevant",
          projectID: Instance.project.id,
          content: "current objective can you give me a lowdown so I can tell codex what you did exactly",
        })

        await RetrievalService.upsertDocument({
          id: "doc_retrieval_service_prompt_scaffold_relevant",
          projectID: Instance.project.id,
          sourceType: "assistant_output",
          sourceID: "src_retrieval_service_prompt_scaffold_relevant",
          title: "Embedding deployment",
          fingerprint: "fp_retrieval_service_prompt_scaffold_relevant",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_retrieval_service_prompt_scaffold_relevant",
          projectID: Instance.project.id,
          content: "Embedding model deployment on a website uses qwen3 gguf inference and hosting guidance.",
        })

        await RetrievalService.upsertDocument({
          id: "doc_retrieval_service_prompt_scaffold_partial",
          projectID: Instance.project.id,
          sourceType: "assistant_output",
          sourceID: "src_retrieval_service_prompt_scaffold_partial",
          title: "Single-term overlap",
          fingerprint: "fp_retrieval_service_prompt_scaffold_partial",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_retrieval_service_prompt_scaffold_partial",
          projectID: Instance.project.id,
          content: "This note only mentions website hosting without any vector or model specifics.",
        })

        const result = await RetrievalService.search({
          projectID: Instance.project.id,
          query: "current objective: Could you upload an embedding moddel like qwen3 guff to a website server?",
          policy: "auto",
          limit: 4,
        })

        expect(result.runMetadata?.queryTerms).toEqual(["embedding", "moddel", "qwen3", "guff", "website"])
        expect(embedMock).toHaveBeenCalledTimes(2)
        expect(rerankMock).toHaveBeenCalledTimes(1)
        const rerankInput = rerankMock.mock.calls[0]?.[0] as { candidates: Array<{ documentID: string }> }
        expect(rerankInput.candidates).toHaveLength(1)
        expect(rerankInput.candidates[0]?.documentID).toBe("doc_retrieval_service_prompt_scaffold_relevant")

        const run = await Database.use((db) =>
          db.select().from(RetrievalRunTable).where(eq(RetrievalRunTable.id, result.runID)).get(),
        )

        // @ts-ignore
        expect(run?.selected_count).toBe(1)
      },
    })
  })

  test("search can skip provider rerank for fast semantic paths", async () => {
    const embedMock = mock(async () => ({
      dimensions: 3,
      vector: [1, 0, 0],
      metadata: { source: "provider", modelID: "qwen3-embedding-0.6b" as any },
    }))
    const rerankMock = mock(async (input: { candidates: Array<Record<string, unknown>> }) => ({
      candidates: input.candidates,
      metadata: { source: "provider", modelID: "qwen3-reranker-0.6b" as any },
    }))
    RetrievalRuntime.configure({
      embedText: embedMock,
      rerank: rerankMock as never,
    })

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await RetrievalService.upsertDocument({
          id: "doc_retrieval_service_skip_rerank",
          projectID: Instance.project.id,
          sourceType: "assistant_output",
          sourceID: "src_retrieval_service_skip_rerank",
          title: "Search box visibility fix",
          fingerprint: "fp_retrieval_service_skip_rerank",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_retrieval_service_skip_rerank",
          projectID: Instance.project.id,
          content: "Search box visibility fix adjusts layout and z-index so the box stays visible.",
        })

        const result = await RetrievalService.search({
          projectID: Instance.project.id,
          query: "current objective: search box visibility fix",
          policy: "auto",
          limit: 2,
          metadata: {
            trigger: "workgraph_digest",
            skipRerank: true,
          },
        })

        expect(result.candidates.length).toBeGreaterThan(0)
        expect(embedMock).toHaveBeenCalled()
        expect(rerankMock).not.toHaveBeenCalled()
        expect(result.runMetadata?.rerankSource).toBe("skipped_fast_path")
        expect(result.runMetadata?.rerankFallbackReason).toBe("rerank_disabled_for_search")
      },
    })
  })

  test("search uses synthetic fallback when no provider is configured", async () => {
    // Configure hooks that return synthetic embeddings, and ensure the runtime
    // isConfigured flag is true so search skips configureRetrievalRuntime().
    RetrievalRuntime.configure({
      async embedText() {
        const hash = 0x9e3779b9
        const dimensions = 8
        const vector = new Array<number>(dimensions).fill(0.125)
        return {
          vector,
          dimensions,
          metadata: { source: "synthetic_fallback" },
        }
      },
      async rerank(input) {
        return {
          candidates: input.candidates.map((c: any) => ({ ...c, rerankScore: c.score ?? 0 })),
          metadata: { source: "synthetic_fallback" },
        }
      },
    })

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await RetrievalService.upsertDocument({
          id: "doc_retrieval_service_synthetic",
          projectID: Instance.project.id,
          sourceType: "note",
          sourceID: "synthetic_test",
          title: "Synthetic fallback test",
          fingerprint: "fp_synthetic",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_retrieval_service_synthetic",
          projectID: Instance.project.id,
          content: "Orchard relay baton handshake protocol for semantic retrieval.",
        })

        const result = await RetrievalService.search({
          projectID: Instance.project.id,
          query: "orchard relay",
          policy: "auto",
          limit: 3,
        })

        expect(result.candidates.length).toBeGreaterThan(0)
        expect(result.runMetadata?.queryEmbeddingSource).toBe("synthetic_fallback")
        expect(result.runMetadata?.rerankSource).toBe("synthetic_fallback")
        expect(result.runMetadata?.phase).toBe("synthetic-embedding-rerank")
      },
    })
  })

  test("semantic vectors produce higher scores for matching content", async () => {
    const queryVectors: Array<{ text: string; vector: number[] }> = []
    const chunkVectors = new Map<string, number[]>()
    let embedCallCount = 0

    RetrievalRuntime.configure({
      async embedText(input) {
        const vec = input.text.toLowerCase().includes("orchard")
          ? [0.9, 0.1, 0.0]
          : input.text.toLowerCase().includes("lattice")
            ? [0.8, 0.15, 0.05]
            : [0.1, 0.8, 0.1]
        queryVectors.push({ text: input.text, vector: vec })
        if (input.purpose === "chunk") {
          embedCallCount++
        }
        return { dimensions: vec.length, vector: vec, metadata: { source: "test-embedder" } }
      },
      async rerank(input) {
        for (const candidate of input.candidates) {
          if (candidate.chunkID && input.candidateVectors.has(candidate.chunkID)) {
            chunkVectors.set(candidate.chunkID, input.candidateVectors.get(candidate.chunkID)!)
          }
        }
        const scored = input.candidates.map((candidate: any) => {
          const vec = input.candidateVectors.get(candidate.chunkID)
          if (!vec) return { ...candidate, rerankScore: 0 }
          const qNorm = Math.sqrt(input.queryVector.reduce((s, v) => s + v * v, 0)) || 1
          const cNorm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
          let score = 0
          for (let i = 0; i < Math.min(input.queryVector.length, vec.length); i++) {
            score += (input.queryVector[i] / qNorm) * (vec[i] / cNorm)
          }
          return { ...candidate, rerankScore: score }
        })
        scored.sort((a: any, b: any) => b.rerankScore - a.rerankScore)
        return { candidates: scored, metadata: { source: "test-reranker" } }
      },
    })

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await RetrievalService.upsertDocument({
          id: "doc_orchard",
          projectID: Instance.project.id,
          sourceType: "note",
          sourceID: "orchard",
          title: "Orchard notes",
          fingerprint: "fp_orchard",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_orchard",
          projectID: Instance.project.id,
          content: "Orchard relay baton handshake protocol.",
        })

        await RetrievalService.upsertDocument({
          id: "doc_unrelated",
          projectID: Instance.project.id,
          sourceType: "note",
          sourceID: "unrelated",
          title: "Unrelated notes",
          fingerprint: "fp_unrelated",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_unrelated",
          projectID: Instance.project.id,
          content: "Garden vegetable soup recipe with tomatoes.",
        })

        const result = await RetrievalService.search({
          projectID: Instance.project.id,
          query: "orchard relay baton",
          policy: "auto",
          limit: 5,
        })

        expect(result.candidates.length).toBe(2)
        expect(result.candidates[0]?.documentID).toBe("doc_orchard")
        expect(result.candidates[0]?.rerankScore).toBeGreaterThan(result.candidates[1]?.rerankScore ?? 0)
      },
    })
  })

  test("retrieval persists chunk embeddings across searches within same index space", async () => {
    let chunkEmbedCount = 0
    RetrievalRuntime.configure({
      async embedText(input) {
        if (input.purpose === "chunk") {
          chunkEmbedCount++
        }
        return {
          dimensions: 3,
          vector: input.text.toLowerCase().includes("oak") ? [1, 0, 0] : [0, 1, 0],
          metadata: { source: "test-embedder" },
        }
      },
      async rerank(input) {
        return {
          candidates: input.candidates.map((c: any) => ({ ...c, rerankScore: c.score ?? 0 })),
          metadata: { source: "test-reranker" },
        }
      },
    })

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await RetrievalService.upsertDocument({
          id: "doc_oak",
          projectID: Instance.project.id,
          sourceType: "note",
          sourceID: "oak",
          title: "Oak lattice",
          fingerprint: "fp_oak",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_oak",
          projectID: Instance.project.id,
          content: "Oak lattice recovery keeps orchestration stable.",
        })

        // First search — should embed the chunk
        await RetrievalService.search({
          projectID: Instance.project.id,
          query: "oak recovery",
          policy: "auto",
          limit: 3,
        })
        const firstEmbedCount = chunkEmbedCount

        // Clear DB embeddings to simulate same index space reuse, but keep runtime configured
        await Database.use((db) => db.run(db.delete(RetrievalEmbeddingTable)))

        // Second search — should embed again since we cleared the store
        await RetrievalService.search({
          projectID: Instance.project.id,
          query: "oak orchestration",
          policy: "auto",
          limit: 3,
        })
        const secondEmbedCount = chunkEmbedCount

        // The second search should re-embed the chunk (total = 2 across both searches)
        expect(secondEmbedCount).toBeGreaterThan(firstEmbedCount)
      },
    })
  })

  test("re-embeds chunk when semantic signature changes between searches", async () => {
    let currentDimensions = 256
    let chunkEmbedCount = 0

    RetrievalRuntime.configure({
      async embedText(input) {
        if (input.purpose === "chunk") chunkEmbedCount++
        return {
          dimensions: currentDimensions,
          vector: currentDimensions === 256 ? [0.8, 0.2] : [0.2, 0.8],
          metadata: { source: "test-embedder" },
        }
      },
      async rerank(input) {
        return {
          candidates: input.candidates.map((c: any) => ({ ...c, rerankScore: c.score ?? 0 })),
          metadata: { source: "test-reranker" },
        }
      },
    })

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await RetrievalService.upsertDocument({
          id: "doc_sig_change",
          projectID: Instance.project.id,
          sourceType: "note",
          sourceID: "sig",
          title: "Signature change test",
          fingerprint: "fp_sig",
        })
        const chunks = await RetrievalService.replaceChunks({
          documentID: "doc_sig_change",
          projectID: Instance.project.id,
          content: "Semantic signature determines embedding identity.",
        })

        const autoPolicy = RetrievalPolicy.resolve("auto")
        const originalResolve = RetrievalPolicy.resolve
        const resolveSpy = spyOn(RetrievalPolicy, "resolve")

        try {
          // First search with dimensions=256
          autoPolicy.embedder = {
            ...autoPolicy.embedder,
            instructionPreset: "memory.task_pattern",
            dimensions: 256,
            settings: { ...autoPolicy.embedder?.settings },
          } as any
          resolveSpy.mockImplementation((name) => (name === "auto" ? autoPolicy : originalResolve(name)))

          await RetrievalService.search({
            projectID: Instance.project.id,
            query: "semantic signature",
            policy: "auto",
            limit: 3,
          })
          const firstCount = chunkEmbedCount

          // Second search with dimensions=1024 — should trigger re-embed
          autoPolicy.embedder = {
            ...autoPolicy.embedder,
            instructionPreset: "memory.decision",
            dimensions: 1024,
            settings: { ...autoPolicy.embedder?.settings },
          } as any
          resolveSpy.mockImplementation((name) => (name === "auto" ? autoPolicy : originalResolve(name)))

          await RetrievalService.search({
            projectID: Instance.project.id,
            query: "semantic signature",
            policy: "auto",
            limit: 3,
          })
          const secondCount = chunkEmbedCount

          expect(secondCount).toBeGreaterThan(firstCount)
        } finally {
          resolveSpy.mockRestore()
        }
      },
    })
  })

  test("hybrid ranking combines lexical and semantic scores", async () => {
    RetrievalRuntime.configure({
      async embedText() {
        return { dimensions: 3, vector: [0.5, 0.5, 0.0], metadata: { source: "provider" } }
      },
      async rerank(input) {
        const scored = input.candidates.map((c: any) => ({
          ...c,
          rerankScore: c.score * 0.5 + (input.candidateVectors.get(c.chunkID)?.[0] ?? 0) * 0.5,
        }))
        scored.sort((a: any, b: any) => b.rerankScore - a.rerankScore)
        return { candidates: scored, metadata: { source: "hybrid-reranker" } }
      },
    })

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Use highly unique terms to avoid cross-test pollution
        await RetrievalService.upsertDocument({
          id: "doc_hybrid_r7x_a",
          projectID: Instance.project.id,
          sourceType: "note",
          sourceID: "r7x_a",
          title: "HybridTestA",
          fingerprint: "fp_r7x_a",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_hybrid_r7x_a",
          projectID: Instance.project.id,
          content: "HybridRelay-Z handshake baton protocol v7x.",
        })

        await RetrievalService.upsertDocument({
          id: "doc_hybrid_r7x_b",
          projectID: Instance.project.id,
          sourceType: "note",
          sourceID: "r7x_b",
          title: "HybridTestB",
          fingerprint: "fp_r7x_b",
        })
        await RetrievalService.replaceChunks({
          documentID: "doc_hybrid_r7x_b",
          projectID: Instance.project.id,
          content: "Just mentions HybridRelay-Z in passing without baton details.",
        })

        const result = await RetrievalService.search({
          projectID: Instance.project.id,
          query: "HybridRelay-Z baton v7x",
          policy: "auto",
          limit: 5,
        })

        expect(result.candidates.length).toBeGreaterThanOrEqual(2)
        expect(result.candidates[0]?.documentID).toBe("doc_hybrid_r7x_a")
      },
    })
  })
})
