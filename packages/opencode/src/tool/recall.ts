import z from "zod"
import { Tool } from "./tool"
import { Instance } from "@/project/instance"
import { RetrievalService } from "@/retrieval"
import type { RetrievalSourceType } from "@/retrieval"
import { SessionWorkGraph } from "@/session/workgraph"
import DESCRIPTION from "./recall.txt"

const retrievalSourceType = z.enum([
  "session_message",
  "assistant_output",
  "tool_failure",
  "diff",
  "patch",
  "task_artifact",
  "skill",
  "doc",
  "note",
  "provenance",
  "code_chunk",
])

function fallbackDiagnostics(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined
  const querySource = String(metadata.queryEmbeddingSource ?? "unknown")
  const rerankSource = String(metadata.rerankSource ?? "unknown")
  const queryReason = metadata.queryEmbeddingFallbackReason ? `(${String(metadata.queryEmbeddingFallbackReason)})` : ""
  const rerankReason = metadata.rerankFallbackReason ? `(${String(metadata.rerankFallbackReason)})` : ""
  if (querySource === "provider" && rerankSource === "provider") return undefined
  return `diagnostics: query_embedding=${querySource}${queryReason} rerank=${rerankSource}${rerankReason}`
}

function routingSummary(metadata?: Record<string, unknown>) {
  if (!metadata || metadata.routingMode !== "intent_router") return undefined
  const intent = typeof metadata.routedIntent === "string" ? metadata.routedIntent : "unknown"
  const secondary = typeof metadata.routedIntentSecondary === "string" ? metadata.routedIntentSecondary : undefined
  const confidence = typeof metadata.routingConfidence === "string" ? metadata.routingConfidence : undefined
  const strategy = typeof metadata.routingStrategy === "string" ? metadata.routingStrategy : undefined
  const detail = [
    String(metadata.routingMode),
    confidence,
    strategy === "dual_intent_blend" && secondary ? `secondary=${secondary}` : undefined,
  ]
    .filter(Boolean)
    .join(", ")
  return `intent: ${intent} (${detail})`
}

export const RecallTool = Tool.define("recall", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().min(1).describe("Semantic recall query"),
    policy: z.enum(["fast", "quality", "auto", "local", "isolated"]).optional(),
    limit: z.number().int().min(1).max(20).optional(),
    source_types: z.array(retrievalSourceType).min(1).optional(),
  }),
  async execute(params, ctx) {
    const projectID = Instance.active()?.project.id ?? Instance.project.id
    const beforeIndex = await RetrievalService.stats(projectID)
    await RetrievalService.indexSession({
      projectID,
      sessionID: ctx.sessionID,
    })

    const rootSessionID = ((ctx as any).rootSessionID ?? ctx.sessionID) as typeof ctx.sessionID
    await RetrievalService.indexTaskArtifacts({
      projectID,
      rootSessionID,
      workgraph: await SessionWorkGraph.get(rootSessionID),
    })
    const afterIndex = await RetrievalService.stats(projectID)
    const indexedDocuments = Math.max(afterIndex.documentCount - beforeIndex.documentCount, 0)
    const indexedChunks = Math.max(afterIndex.chunkCount - beforeIndex.chunkCount, 0)

    const result = await RetrievalService.search({
      projectID,
      sessionID: ctx.sessionID,
      preferredSessionIDs: [ctx.sessionID],
      query: params.query,
      policy: params.policy ?? "auto",
      limit: params.limit ?? 5,
      sourceTypes: params.source_types as RetrievalSourceType[] | undefined,
    })

    const output = [
      `run_id: ${result.runID}`,
      `policy: ${params.policy ?? "auto"}`,
      ...(params.source_types?.length ? [`source_types: ${params.source_types.join(", ")}`] : []),
      `indexed_documents: ${indexedDocuments}`,
      `indexed_chunks: ${indexedChunks}`,
      `candidate_count: ${result.candidates.length}`,
      ...((() => {
        const routing = routingSummary(result.runMetadata)
        return routing ? [routing] : []
      })()),
      ...((() => {
        const diagnostics = fallbackDiagnostics(result.runMetadata)
        return diagnostics ? [diagnostics] : []
      })()),
      "",
      ...result.candidates.map((candidate, index) =>
        [
          `${index + 1}. ${candidate.sourceType ?? "unknown"} ${candidate.documentID}`,
          `   chunk_id: ${candidate.chunkID}`,
          `   score: ${candidate.rerankScore ?? candidate.score ?? 0}`,
          `   text: ${candidate.content.replace(/\s+/g, " ").trim()}`,
        ].join("\n"),
      ),
    ].join("\n")

    return {
      title: `Recall: ${params.query}`,
      metadata: {
        runID: result.runID,
        policy: params.policy ?? "auto",
        sourceTypes: params.source_types,
        candidateCount: result.candidates.length,
        routingMode: result.runMetadata?.routingMode,
        routedIntent: result.runMetadata?.routedIntent,
        routedIntentSecondary: result.runMetadata?.routedIntentSecondary,
        routingConfidence: result.runMetadata?.routingConfidence,
        routingStrategy: result.runMetadata?.routingStrategy,
        queryEmbeddingSource: result.runMetadata?.queryEmbeddingSource,
        rerankSource: result.runMetadata?.rerankSource,
        queryEmbeddingFallbackReason: result.runMetadata?.queryEmbeddingFallbackReason,
        rerankFallbackReason: result.runMetadata?.rerankFallbackReason,
        indexedDocuments,
        indexedChunks,
      },
      output,
    }
  },
})
