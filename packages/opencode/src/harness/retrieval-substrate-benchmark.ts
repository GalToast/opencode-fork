import { Database, eq } from "@/storage/db"
import { RetrievalEmbeddingTable } from "@/retrieval/retrieval.sql"
import { Instance } from "@/project/instance"
import { RetrievalRuntime } from "@/retrieval/runtime"
import { RetrievalService } from "@/retrieval"

type WorkspacePreparer = (scenarioID: string) => Promise<string> | string

let seq = 0

function makeSession(label: string) {
  seq++
  return { id: `retrieval-benchmark-${label}-${Date.now()}-${seq}` }
}

export type RetrievalSubstrateScenarioResult = {
  id: string
  category: "identity" | "ranking" | "scope" | "observability"
  ok: boolean
  elapsedMS: number
  summary: string
  evidence: Record<string, unknown>
}

export type RetrievalSubstrateBenchmarkResult = {
  suite: "retrieval_substrate"
  scenarioCount: number
  passedCount: number
  failedCount: number
  successRate: number
  averageElapsedMS: number
  categorySummary: Array<{
    category: RetrievalSubstrateScenarioResult["category"]
    total: number
    passed: number
  }>
  results: RetrievalSubstrateScenarioResult[]
}

async function seedDocument(input: {
  id: string
  projectID: string
  sessionID: string
  sourceID: string
  title: string
  content: string
  metadata?: Record<string, unknown>
  outcomeScore?: number
}) {
  await RetrievalService.upsertDocument({
    id: input.id,
    projectID: input.projectID,
    sessionID: input.sessionID,
    sourceType: "note",
    sourceID: input.sourceID,
    title: input.title,
    fingerprint: `${input.id}-fingerprint`,
    metadata: input.metadata,
    outcomeScore: input.outcomeScore ?? 0,
    negativeSignal: false,
  })

  await RetrievalService.replaceChunks({
    documentID: input.id,
    projectID: input.projectID,
    content: input.content,
    chunkType: "benchmark",
  })
}

async function runIdentityScenario(directory: string): Promise<RetrievalSubstrateScenarioResult> {
  const startedAt = performance.now()
  RetrievalRuntime.reset()
  RetrievalRuntime.configure({
    async embedText(input) {
      const byPolicy =
        input.policy.name === "quality"
          ? [0, 1]
          : [1, 0]
      return {
        dimensions: byPolicy.length,
        vector: byPolicy,
        metadata: {
          source: "benchmark-embedder",
          modelID: `${input.policy.name}-embedder`,
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
          source: "benchmark-reranker",
          modelID: `${input.policy.name}-reranker`,
        },
      }
    },
  })

  return Instance.provide({
    directory,
    fn: async () => {
      const session = makeSession("identity")
      const docID = `retrieval-benchmark-identity-doc-${session.id}`
      await seedDocument({
        id: docID,
        projectID: Instance.project.id,
        sessionID: session.id,
        sourceID: "identity-doc",
        title: "Dual lane embedding identity",
        content: "orchard lane identity stays isolated across retrieval lanes",
      })

      const fast = await RetrievalService.search({
        projectID: Instance.project.id,
        sessionID: session.id,
        preferredSessionIDs: [session.id],
        query: "orchard lane identity",
        policy: "fast",
        limit: 3,
      })
      const quality = await RetrievalService.search({
        projectID: Instance.project.id,
        sessionID: session.id,
        preferredSessionIDs: [session.id],
        query: "orchard lane identity",
        policy: "quality",
        limit: 3,
      })

      const embeddings = await Database.use((db) =>
        db
          .select()
          .from(RetrievalEmbeddingTable)
          .where(eq(RetrievalEmbeddingTable.chunk_id, `chunk_${docID}_0`)),
      )

      const semanticSignatures = new Set(
        embeddings
          .map((row) => (row.metadata as any)?.semanticSignature)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      )
      const indexSpaces = new Set(
        embeddings
          .map((row) => (row.metadata as any)?.indexSpace)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      )

      const ok =
        fast.candidates.length > 0 &&
        quality.candidates.length > 0 &&
        embeddings.length === 2 &&
        semanticSignatures.size === 2 &&
        indexSpaces.size === 2

      return {
        id: "embedding_identity_by_lane",
        category: "identity",
        ok,
        elapsedMS: Math.round(performance.now() - startedAt),
        summary: ok
          ? "Fast and quality searches stored distinct chunk embeddings with separate semantic identities."
          : "Embedding identity collapsed across lanes or failed to materialize both cached vectors.",
        evidence: {
          embeddingCount: embeddings.length,
          semanticSignatureCount: semanticSignatures.size,
          indexSpaces: [...indexSpaces],
        },
      } satisfies RetrievalSubstrateScenarioResult
    },
  })
}

async function runRankingParityScenario(directory: string): Promise<RetrievalSubstrateScenarioResult> {
  const startedAt = performance.now()
  RetrievalRuntime.reset()

  return Instance.provide({
    directory,
    fn: async () => {
      const session = makeSession("ranking")
      const targetDocID = `retrieval-benchmark-ranking-target-${session.id}`
      const competitorDocID = `retrieval-benchmark-ranking-competitor-${session.id}`
      await seedDocument({
        id: targetDocID,
        projectID: Instance.project.id,
        sessionID: session.id,
        sourceID: "ranking-target",
        title: "Target route",
        content: "cedar route continuity target pattern",
      })
      await seedDocument({
        id: competitorDocID,
        projectID: Instance.project.id,
        sessionID: session.id,
        sourceID: "ranking-competitor",
        title: "Competitor route",
        content: "cedar route continuity competitor pattern",
      })

      RetrievalRuntime.configure({
        async embedText(input) {
          if (input.purpose === "search_query") {
            return {
              dimensions: 2,
              vector: [1, 0],
              metadata: { source: "provider", modelID: "provider-embedder" as any },
            }
          }
          const vector = /target/.test(input.text) ? [1, 0] : [0.2, 1]
          return {
            dimensions: vector.length,
            vector,
            metadata: { source: "provider", modelID: "provider-embedder" as any },
          }
        },
        async rerank(input) {
          return {
            candidates: input.candidates.map((candidate) => ({
              ...candidate,
              rerankScore: (candidate.documentID ?? "") === targetDocID ? 0.95 : 0.15,
            })),
            metadata: {
              source: "provider",
              modelID: "provider-reranker" as any,
            },
          }
        },
      })

      const providerResult = await RetrievalService.search({
        projectID: Instance.project.id,
        sessionID: session.id,
        preferredSessionIDs: [session.id],
        query: "cedar route continuity",
        policy: "auto",
        limit: 2,
      })

      RetrievalRuntime.configure({
        async embedText(input) {
          if (input.purpose === "search_query") {
            return {
              dimensions: 2,
              vector: [1, 0],
              metadata: {
                source: "synthetic_fallback",
                fallbackReason: "provider_error",
                modelID: "fallback-embedder" as any,
              },
            }
          }
          const vector = /target/.test(input.text) ? [1, 0] : [0.2, 1]
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
      })

      const fallbackResult = await RetrievalService.search({
        projectID: Instance.project.id,
        sessionID: session.id,
        preferredSessionIDs: [session.id],
        query: "cedar route continuity",
        policy: "auto",
        limit: 2,
      })

      const providerTop = providerResult.candidates[0]?.documentID
      const fallbackTop = fallbackResult.candidates[0]?.documentID
      const ok = providerTop === targetDocID && fallbackTop === providerTop

      return {
        id: "provider_fallback_ranking_parity",
        category: "ranking",
        ok,
        elapsedMS: Math.round(performance.now() - startedAt),
        summary: ok
          ? "Provider rerank and fallback rerank preserved the same winning document."
          : "Provider and fallback ranking diverged on the seeded retrieval pair.",
        evidence: {
          providerTop,
          fallbackTop,
          providerSource: providerResult.runMetadata?.rerankSource,
          fallbackSource: fallbackResult.runMetadata?.rerankSource,
        },
      } satisfies RetrievalSubstrateScenarioResult
    },
  })
}

async function runFeedbackScopeScenario(directory: string): Promise<RetrievalSubstrateScenarioResult> {
  const startedAt = performance.now()
  RetrievalRuntime.reset()
  RetrievalRuntime.configure({
    async embedText(input) {
      const vector =
        /route success/.test(input.text) || /orchard recall route/.test(input.text)
          ? [1, 0]
          : [0, 1]
      return {
        dimensions: vector.length,
        vector,
        metadata: { source: "benchmark-embedder", modelID: "scope-embedder" as any },
      }
    },
    async rerank(input) {
      return {
        candidates: input.candidates.map((candidate) => ({
          ...candidate,
          rerankScore: candidate.documentID?.includes("feedback-route") ? 1 : 2,
        })),
        metadata: { source: "benchmark-reranker", modelID: "scope-reranker" as any },
      }
    },
  })

  return Instance.provide({
    directory,
    fn: async () => {
      const seededSession = makeSession("seeded")
      const isolatedSession = makeSession("isolated")
      const seededRouteID = `retrieval-benchmark-feedback-route-${seededSession.id}`
      const seededCompetitorID = `retrieval-benchmark-feedback-competitor-${seededSession.id}`
      const isolatedRouteID = `retrieval-benchmark-feedback-route-${isolatedSession.id}`
      const isolatedCompetitorID = `retrieval-benchmark-feedback-competitor-${isolatedSession.id}`

      for (const [session, suffix] of [
        [seededSession, "seeded"],
        [isolatedSession, "isolated"],
      ] as const) {
        const routeID = suffix === "seeded" ? seededRouteID : isolatedRouteID
        const competitorID = suffix === "seeded" ? seededCompetitorID : isolatedCompetitorID
        await seedDocument({
          id: routeID,
          projectID: Instance.project.id,
          sessionID: session.id,
          sourceID: `feedback-route-${suffix}`,
          title: "Task interaction outcome: general -> success",
          content: "orchard recall route success pattern",
          metadata: {
            kind: "task_interaction_outcome",
            hasOrchestrationRecall: true,
          },
        })
        await seedDocument({
          id: competitorID,
          projectID: Instance.project.id,
          sessionID: session.id,
          sourceID: `feedback-competitor-${suffix}`,
          title: "Competitor note",
          content: "orchard recall route competitor pattern",
          metadata: {
            kind: "task_interaction_outcome",
          },
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

      for (const note of [
        "recalled orchard route was useful",
        "recalled orchard route stayed useful",
        "recalled orchard route resolved the next turn",
        "recalled orchard route stayed durable across retries",
      ]) {
        await RetrievalService.feedback({
          runID: seededBaseline.runID,
          documentID: seededRouteID,
          chunkID: `chunk_${seededRouteID}_0`,
          verdict: "orchestration_recall_success",
          score: 5,
          note,
        })
      }

      const localBiased = await RetrievalService.search({
        projectID: Instance.project.id,
        sessionID: seededSession.id,
        preferredSessionIDs: [seededSession.id],
        query: "orchard recall route",
        policy: "auto",
        limit: 5,
      })

      const isolatedSearch = await RetrievalService.search({
        projectID: Instance.project.id,
        sessionID: isolatedSession.id,
        preferredSessionIDs: [isolatedSession.id],
        query: "orchard recall route",
        policy: "auto",
        limit: 5,
      })

      const ok =
        localBiased.candidates[0]?.documentID === seededRouteID &&
        isolatedSearch.candidates[0]?.documentID === isolatedCompetitorID &&
        localBiased.runMetadata?.feedbackBiasScope === "session_only" &&
        isolatedSearch.runMetadata?.feedbackBiasScope === "session_only" &&
        Number((isolatedSearch.runMetadata?.feedbackBias as any)?.orchestrationRecall ?? 0) === 0

      return {
        id: "feedback_scope_isolation",
        category: "scope",
        ok,
        elapsedMS: Math.round(performance.now() - startedAt),
        summary: ok
          ? "Session-local feedback improved the seeded session without leaking into a sibling session."
          : "Feedback bias either failed to help locally or leaked across sessions in the same project.",
        evidence: {
          localTop: localBiased.candidates[0]?.documentID,
          isolatedTop: isolatedSearch.candidates[0]?.documentID,
          localBiasScope: localBiased.runMetadata?.feedbackBiasScope,
          isolatedBiasScope: isolatedSearch.runMetadata?.feedbackBiasScope,
          isolatedOrchestrationRecall: (isolatedSearch.runMetadata?.feedbackBias as any)?.orchestrationRecall ?? 0,
        },
      } satisfies RetrievalSubstrateScenarioResult
    },
  })
}

async function runFallbackObservabilityScenario(directory: string): Promise<RetrievalSubstrateScenarioResult> {
  const startedAt = performance.now()
  RetrievalRuntime.reset()
  RetrievalRuntime.configure({
    async embedText(input) {
      return {
        dimensions: 2,
        vector: input.purpose === "search_query" ? [1, 0] : [0, 1],
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

  return Instance.provide({
    directory,
    fn: async () => {
      const session = makeSession("fallback")
      const docID = `retrieval-benchmark-fallback-doc-${session.id}`
      await seedDocument({
        id: docID,
        projectID: Instance.project.id,
        sessionID: session.id,
        sourceID: "fallback-doc",
        title: "Fallback diagnostics note",
        content: "orchard relay fallback diagnostic anchor",
      })

      const result = await RetrievalService.search({
        projectID: Instance.project.id,
        sessionID: session.id,
        preferredSessionIDs: [session.id],
        query: "orchard relay",
        policy: "auto",
        limit: 5,
      })

      const ok =
        result.runMetadata?.queryEmbeddingSource === "synthetic_fallback" &&
        result.runMetadata?.rerankSource === "synthetic_fallback" &&
        result.runMetadata?.queryEmbeddingFallbackReason === "provider_error" &&
        result.runMetadata?.rerankFallbackReason === "provider_not_configured"

      return {
        id: "fallback_diagnostics_truthful",
        category: "observability",
        ok,
        elapsedMS: Math.round(performance.now() - startedAt),
        summary: ok
          ? "Fallback execution surfaced explicit runtime diagnostics in retrieval metadata."
          : "Fallback execution hid or dropped runtime diagnostics that operators need to see.",
        evidence: {
          queryEmbeddingSource: result.runMetadata?.queryEmbeddingSource,
          rerankSource: result.runMetadata?.rerankSource,
          queryEmbeddingFallbackReason: result.runMetadata?.queryEmbeddingFallbackReason,
          rerankFallbackReason: result.runMetadata?.rerankFallbackReason,
        },
      } satisfies RetrievalSubstrateScenarioResult
    },
  })
}

export async function runRetrievalSubstrateBenchmark(input: {
  prepareWorkspace: WorkspacePreparer
}): Promise<RetrievalSubstrateBenchmarkResult> {
  const scenarios = [
    {
      id: "embedding_identity_by_lane",
      category: "identity" as const,
      run: runIdentityScenario,
    },
    {
      id: "provider_fallback_ranking_parity",
      category: "ranking" as const,
      run: runRankingParityScenario,
    },
    {
      id: "feedback_scope_isolation",
      category: "scope" as const,
      run: runFeedbackScopeScenario,
    },
    {
      id: "fallback_diagnostics_truthful",
      category: "observability" as const,
      run: runFallbackObservabilityScenario,
    },
  ]

  const results: RetrievalSubstrateScenarioResult[] = []
  for (const scenario of scenarios) {
    const directory = await input.prepareWorkspace(scenario.id)
    const result = await scenario.run(directory)
    results.push(result)
    RetrievalRuntime.reset()
  }

  const passedCount = results.filter((item) => item.ok).length
  const failedCount = results.length - passedCount
  const categorySummary = [...new Set(results.map((item) => item.category))].map((category) => {
    const matches = results.filter((item) => item.category === category)
    return {
      category,
      total: matches.length,
      passed: matches.filter((item) => item.ok).length,
    }
  })

  return {
    suite: "retrieval_substrate",
    scenarioCount: results.length,
    passedCount,
    failedCount,
    successRate: results.length === 0 ? 0 : passedCount / results.length,
    averageElapsedMS:
      results.length === 0 ? 0 : Math.round(results.reduce((sum, item) => sum + item.elapsedMS, 0) / results.length),
    categorySummary,
    results,
  }
}
