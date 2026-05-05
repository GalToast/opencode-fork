import z from "zod"
import { desc, eq, sql } from "@/storage/db"
import { Tool } from "./tool"
import { Instance } from "@/project/instance"
import { RetrievalService } from "@/retrieval"
import { RetrievalRunTable } from "@/retrieval/retrieval.sql"
import { Database } from "@/storage/db"
import DESCRIPTION from "./retrieval_status.txt"

function formatFallbackPair(prefix: string, metadata?: Record<string, unknown> | null) {
  if (!metadata) return undefined
  const querySource = String(metadata.queryEmbeddingSource ?? "unknown")
  const rerankSource = String(metadata.rerankSource ?? "unknown")
  const queryReason = metadata.queryEmbeddingFallbackReason ? `(${String(metadata.queryEmbeddingFallbackReason)})` : ""
  const rerankReason = metadata.rerankFallbackReason ? `(${String(metadata.rerankFallbackReason)})` : ""
  if (querySource === "provider" && rerankSource === "provider") return undefined
  return `${prefix} query_embedding=${querySource}${queryReason} rerank=${rerankSource}${rerankReason}`
}

function formatRouting(metadata?: Record<string, unknown> | null) {
  if (!metadata || metadata.routingMode !== "intent_router") return undefined
  const intent = typeof metadata.routedIntent === "string" ? metadata.routedIntent : "unknown"
  const secondary = typeof metadata.routedIntentSecondary === "string" ? metadata.routedIntentSecondary : undefined
  const confidence = typeof metadata.routingConfidence === "string" ? metadata.routingConfidence : undefined
  const strategy = typeof metadata.routingStrategy === "string" ? metadata.routingStrategy : undefined
  return [
    `routing=intent_router`,
    `intent=${intent}`,
    secondary ? `secondary=${secondary}` : undefined,
    confidence ? `confidence=${confidence}` : undefined,
    strategy ? `strategy=${strategy}` : undefined,
  ]
    .filter(Boolean)
    .join(" ")
}

function formatObservedPath(label: string, value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined
  return `${label}=${value}`
}

function formatModelResolution(metadata?: Record<string, unknown> | null) {
  if (!metadata) return undefined
  const queryRequested = String(metadata.queryEmbeddingRequestedModelID ?? metadata.queryEmbeddingModelID ?? "unknown")
  const queryObserved = String(metadata.queryEmbeddingModelID ?? metadata.queryEmbeddingRequestedModelID ?? "unknown")
  const rerankRequested = String(metadata.rerankRequestedModelID ?? metadata.rerankModelID ?? "unknown")
  const rerankObserved = String(metadata.rerankModelID ?? metadata.rerankRequestedModelID ?? "unknown")
  const changed = queryRequested !== queryObserved || rerankRequested !== rerankObserved
  if (!changed) return undefined
  return `model_resolution: query_embedding=${queryRequested}->${queryObserved} rerank=${rerankRequested}->${rerankObserved}`
}

export const RetrievalStatusTool = Tool.define("retrieval_status", {
  description: DESCRIPTION,
  parameters: z.object({
    limit: z.number().int().min(1).max(20).optional().describe("Number of recent runs to include"),
  }),
  async execute(params, ctx) {
    const projectID = Instance.active()?.project.id ?? Instance.project.id
    const stats = await RetrievalService.stats(projectID)
    const recentRuns = await Database.use((db) =>
      db
        .select()
        .from(RetrievalRunTable)
        .where(eq(RetrievalRunTable.project_id, projectID))
        .orderBy(desc(RetrievalRunTable.time_created))
        .limit(params.limit ?? 5),
    )

    const runCount = await Database.use((db) =>
      db
        .select({ count: sql<number>`count(*)` })
        .from(RetrievalRunTable)
        .where(eq(RetrievalRunTable.project_id, projectID))
        .then((r) => r[0]?.count ?? 0),
    )

    const benchmarkRows = await Database.use((db) =>
      db
        .select()
        .from(RetrievalRunTable)
        .where(eq(RetrievalRunTable.project_id, projectID)),
    )
    const benchmarkSummary = Array.from(
      benchmarkRows.reduce((groups, run: any) => {
        const lane = String(run.metadata?.effectiveLane ?? run.policy ?? run.policy_name ?? "unknown")
        const strategy = String(run.metadata?.pairStrategy ?? "unknown")
        const indexSpace = String(run.metadata?.indexSpace ?? "unknown")
        const key = `${lane}|${strategy}|${indexSpace}`
        const current = groups.get(key) ?? { lane, strategy, indexSpace, runCount: 0 }
        current.runCount += 1
        groups.set(key, current)
        return groups
      }, new Map<string, { lane: string; strategy: string; indexSpace: string; runCount: number }>()),
    ).map(([, value]) => value)

    const output = [
      `document_count: ${stats.documentCount}`,
      `chunk_count: ${stats.chunkCount}`,
      `run_count: ${runCount}`,
      "",
      "benchmark_summary:",
      ...(benchmarkSummary.length
        ? benchmarkSummary.map(
            (item) =>
              `- lane=${item.lane} strategy=${item.strategy} index_space=${item.indexSpace} runs=${item.runCount}`,
          )
        : ["- no retrieval benchmark runs yet"]),
      "",
      "recent_runs:",
      ...(recentRuns.length
        ? recentRuns.map((run: any, index) =>
            [
              `${index + 1}. ${run.id}`,
              `   policy=${run.policy ?? run.policy_name ?? "unknown"} requested_embedding_model=${run.embedding_model_id ?? "unknown"} requested_reranker_model=${run.reranker_model_id ?? "unknown"}`,
              `   observed_embedding_model=${String(run.metadata?.queryEmbeddingModelID ?? run.embedding_model_id ?? "unknown")} observed_reranker_model=${String(run.metadata?.rerankModelID ?? run.reranker_model_id ?? "unknown")}`,
              `   lane=${String(run.metadata?.effectiveLane ?? run.policy ?? run.policy_name ?? "unknown")} strategy=${String(run.metadata?.pairStrategy ?? "unknown")} index_space=${String(run.metadata?.indexSpace ?? "unknown")}`,
              `   policy_mode=${String(run.metadata?.policyMode ?? "baseline")}`,
              ...(formatRouting(run.metadata) ? [`   ${formatRouting(run.metadata)!}`] : []),
              `   query_source=${String(run.metadata?.queryEmbeddingSource ?? "unknown")} rerank_source=${String(run.metadata?.rerankSource ?? "unknown")}`,
              ...(formatModelResolution(run.metadata) ? [`   ${formatModelResolution(run.metadata)!}`] : []),
              ...(formatObservedPath("observed_embedding_path", run.metadata?.queryEmbeddingObservedModelPath)
                ? [`   ${formatObservedPath("observed_embedding_path", run.metadata?.queryEmbeddingObservedModelPath)!}`]
                : []),
              ...(formatObservedPath("observed_reranker_path", run.metadata?.rerankObservedModelPath)
                ? [`   ${formatObservedPath("observed_reranker_path", run.metadata?.rerankObservedModelPath)!}`]
                : []),
              ...(formatFallbackPair("   diagnostics:", run.metadata) ? [formatFallbackPair("   diagnostics:", run.metadata)!] : []),
              `   scope=${String(run.metadata?.searchScope ?? "unknown")} selected=session:${String(run.metadata?.sessionSelectedCount ?? 0)} family:${String(run.metadata?.familySelectedCount ?? 0)} project:${String(run.metadata?.projectSelectedCount ?? 0)}`,
            ].join("\n"),
          )
        : ["1. no retrieval runs recorded yet"]),
    ].join("\n")

    return {
      title: "Retrieval Status",
      metadata: {
        runCount,
        recentRunCount: recentRuns.length,
        sessionID: ctx.sessionID,
        benchmarkSummary,
      },
      output,
    }
  },
})
