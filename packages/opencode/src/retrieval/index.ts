import { sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { RetrievalRunTable, RetrievalDocumentTable, RetrievalChunkTable, RetrievalEmbeddingTable, RetrievalFeedbackTable } from "./retrieval.sql"
import { RetrievalSearch, type SearchCandidate } from "./search"
import { RetrievalPolicy, type RetrievalPolicyConfig } from "./policy"
import { RetrievalRuntime } from "./runtime"
import { RetrievalBaton } from "./baton"
import { configureRetrievalRuntime } from "./adapter"
import { routeRetrievalPolicyByIntent } from "./prompt"

import type { RetrievalSourceType, RetrievalChunkCandidate, RetrievalPolicyName, RetrievalTraceCandidate, RetrievalTraceReplayIntent } from "./types"

export type { RetrievalSourceType, RetrievalChunkCandidate, RetrievalPolicyName, RetrievalTraceCandidate, RetrievalTraceReplayIntent } from "./types"

const QUERY_MAX_LEN = 512

function retrievalIndexSpace(policy: RetrievalPolicyConfig): string {
  return (
    (typeof policy.metadata?.indexSpace === "string" ? policy.metadata.indexSpace : undefined) ??
    (typeof policy.embedder?.settings?.indexSpace === "string" ? policy.embedder.settings.indexSpace : undefined) ??
    policy.embedder?.modelID ??
    policy.name
  )
}

async function ensureRuntimeConfigured(): Promise<void> {
  if (!RetrievalRuntime.isConfigured()) {
    await configureRetrievalRuntime()
  }
}

function hashContent(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `hash_${Math.abs(hash).toString(16)}`
}

export namespace RetrievalService {
  export async function search(input: {
    projectID: string
    sessionID?: string
    query: string
    policy: RetrievalPolicyName
    limit: number
    sourceTypes?: RetrievalSourceType[]
    metadata?: Record<string, unknown>
    preferredSessionIDs?: string[]
    skipRuntimeConfigure?: boolean
  }): Promise<{
    candidates: RetrievalChunkCandidate[]
    runID: string
    runMetadata: Record<string, unknown>
    metadata: Record<string, unknown>
    policy: RetrievalPolicyConfig
  }> {
    if (!input.skipRuntimeConfigure) await ensureRuntimeConfigured()
    const startTime = Date.now()
    const runID = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    
    const policy = routeRetrievalPolicyByIntent({
      policy: RetrievalPolicy.resolve(input.policy),
      query: input.query,
      detail: typeof input.metadata?.detail === "string" ? input.metadata.detail : undefined,
    })
    
    const terms = RetrievalSearch.extractTerms(input.query)
    
    const compactedQuery = RetrievalSearch.compactQuery(input.query, QUERY_MAX_LEN)
    
    const lexicalCandidates = RetrievalSearch.lexicalSearch({
      projectID: input.projectID,
      terms,
      limit: input.limit * 3,
      sourceTypes: input.sourceTypes,
      sessionIDs: input.preferredSessionIDs ?? (input.sessionID ? [input.sessionID] : undefined),
    })
    
    if (lexicalCandidates.length === 0) {
      const elapsed = Date.now() - startTime
      const runMetadata: Record<string, unknown> = {
        phase: "empty",
        queryTerms: terms,
        semanticQueryTruncated: compactedQuery.truncated,
        semanticQuery: compactedQuery.query,
        semanticQueryOriginalLength: compactedQuery.originalLength,
        effectiveLane: input.policy,
        pairStrategy: policy.metadata?.strategy,
        indexSpace: retrievalIndexSpace(policy),
        embedderInstruction: policy.embedder?.instruction,
        rerankerInstruction: policy.reranker?.instruction,
        ...policy.metadata,
      }
      
      await Database.use((db) =>
        db.insert(RetrievalRunTable).values({
          id: runID,
          project_id: input.projectID,
          session_id: input.sessionID,
          query: input.query,
          policy_name: input.policy,
          result_limit: input.limit,
          latency_ms: elapsed,
          candidate_count: 0,
          selected_count: 0,
          metadata: runMetadata,
        }).run()
      )
      
      return {
        candidates: [],
        runID,
        runMetadata,
        metadata: input.metadata ?? {},
        policy,
      }
    }
    
    const searchCandidates: SearchCandidate[] = lexicalCandidates.map((c) => ({
      chunkID: c.chunkID,
      documentID: c.documentID,
      sourceType: c.sourceType,
      content: c.content,
      score: c.score,
      outcomeScore: c.outcomeScore,
      sessionID: c.sessionID,
    }))
    
    const skipRerank = input.metadata?.skipRerank === true
    
    let queryVector: number[] = []
    let embedMetadata: Record<string, unknown> = {}
    
    const embedQuery = compactedQuery.truncated ? compactedQuery.query : input.query
    const embedStart = Date.now()
    const embedResult = await RetrievalRuntime.embedText({
      text: embedQuery,
      policy,
      purpose: "search_query",
    })
    queryVector = embedResult.vector
    embedMetadata = {
      queryEmbeddingSource: embedResult.metadata?.source ?? "provider",
      queryEmbeddingRequestedModelID: policy.embedder?.modelID,
      queryEmbeddingModelID: embedResult.metadata?.modelID,
      queryEmbeddingFallbackReason: embedResult.metadata?.fallbackReason,
      queryEmbeddingOriginalError: embedResult.metadata?.originalError,
      queryEmbeddingLatencyMs: Date.now() - embedStart,
    }
    
    const hybridResult = await RetrievalSearch.hybridRank({
      candidates: searchCandidates,
      queryVector,
      policy,
      skipRerank,
    })
    
    const raw = hybridResult.metadata ?? {}
    const rerankMetadata = {
      ...raw,
      rerankSource: raw.rerankSource ?? raw.source,
      rerankFallbackReason: raw.rerankFallbackReason ?? raw.fallbackReason,
      rerankOriginalError: raw.rerankOriginalError ?? raw.originalError,
      rerankRequestedModelID: raw.rerankRequestedModelID ?? policy.reranker?.modelID,
      rerankModelID: raw.rerankModelID ?? raw.modelID,
    }
    
    const finalCandidates = hybridResult.candidates
      .map((c) => {
        const boost = Number((c as any).outcomeScore ?? 0)
        const score = Number(c.score ?? 0) + boost
        const rerankScore = Number((c as any).rerankScore ?? c.score ?? 0) + boost
        return {
          chunkID: c.chunkID,
          documentID: c.documentID,
          sourceID: c.documentID,
          sourceType: c.sourceType as RetrievalSourceType,
          content: c.content,
          score,
          rerankScore,
          sessionID: c.sessionID,
          outcomeScore: boost,
          feedbackScore: boost,
        }
      })
      .sort((a, b) => (b.rerankScore ?? b.score) - (a.rerankScore ?? a.score))
    
    const selectedCandidates = RetrievalBaton.compact(finalCandidates, input.limit, input.preferredSessionIDs)
    
    const queryEmbeddingSource = String(embedMetadata.queryEmbeddingSource ?? "unknown")
    const rerankSource = String(rerankMetadata.rerankSource ?? "unknown")
    const retrievalPhase =
      queryEmbeddingSource === "provider" && rerankSource === "provider"
        ? "provider-embedding-rerank"
        : queryEmbeddingSource === "synthetic_fallback" && rerankSource === "synthetic_fallback"
          ? "synthetic-embedding-rerank"
          : "hybrid-embedding-rerank"

    const sessionSelectedCount = input.sessionID
      ? selectedCandidates.filter((item) => item.sessionID === input.sessionID).length
      : 0
    const projectSelectedCount = selectedCandidates.filter((item) => !item.sessionID).length

    const runMetadata: Record<string, unknown> = {
      phase: retrievalPhase,
      queryTerms: terms,
      semanticQueryTruncated: compactedQuery.truncated,
      semanticQuery: compactedQuery.query,
      semanticQueryOriginalLength: compactedQuery.originalLength,
      effectiveLane: input.policy,
      pairStrategy: policy.metadata?.strategy,
      indexSpace: retrievalIndexSpace(policy),
      embedderInstruction: policy.embedder?.instruction,
      rerankerInstruction: policy.reranker?.instruction,
      runtime: policy.embedder?.settings?.runtime,
      embedderModelID: policy.embedder?.modelID,
      rerankerModelID: policy.reranker?.modelID,
      searchScope: input.sessionID ? "session_only" : "project",
      sessionSelectedCount,
      familySelectedCount: 0,
      projectSelectedCount,
      ...policy.metadata,
      ...embedMetadata,
      ...rerankMetadata,
    }

    if (input.sessionID) {
      runMetadata.feedbackBiasScope = "session_only"
      runMetadata.feedbackBias = {
        orchestrationRecall: finalCandidates.reduce((sum, item) => sum + (item.outcomeScore ?? 0), 0),
      }
    }
    
    if (skipRerank) {
      runMetadata.rerankSource = "skipped_fast_path"
      runMetadata.rerankFallbackReason = "rerank_disabled_for_search"
    }

    const elapsed = Date.now() - startTime
    
    await Database.use((db) =>
      db.insert(RetrievalRunTable).values({
        id: runID,
        project_id: input.projectID,
        session_id: input.sessionID,
        query: input.query,
        policy_name: input.policy,
        result_limit: input.limit,
        latency_ms: elapsed,
        candidate_count: lexicalCandidates.length,
        selected_count: selectedCandidates.length,
        embedding_model_id: String(policy.embedder?.modelID ?? ""),
        reranker_model_id: String(policy.reranker?.modelID ?? ""),
        metadata: runMetadata,
      }).run()
    )
    
    return {
      candidates: selectedCandidates,
      runID,
      runMetadata,
      metadata: input.metadata ?? {},
      policy,
    }
  }

  export async function upsertDocument(input: {
    id: string
    projectID: string
    sessionID?: string
    sourceType: string
    sourceID?: string
    title?: string
    fingerprint: string
    metadata?: Record<string, unknown>
    outcomeScore?: number
    negativeSignal?: boolean
  }): Promise<void> {
    await Database.use((db) =>
      db.insert(RetrievalDocumentTable)
        .values({
          id: input.id,
          project_id: input.projectID,
          session_id: input.sessionID,
          source_type: input.sourceType,
          source_id: input.sourceID,
          title: input.title,
          fingerprint: input.fingerprint,
          metadata: input.metadata,
          outcome_score: input.outcomeScore,
          negative_signal: input.negativeSignal ? 1 : 0,
        })
        .onConflictDoUpdate({
          target: RetrievalDocumentTable.id,
          set: {
            session_id: input.sessionID,
            source_type: input.sourceType,
            source_id: input.sourceID,
            title: input.title,
            fingerprint: input.fingerprint,
            metadata: input.metadata,
            outcome_score: input.outcomeScore,
            negative_signal: input.negativeSignal ? 1 : 0,
            time_updated: Date.now(),
          },
        })
        .run()
    )
  }

  export async function replaceChunks(input: {
    documentID: string
    projectID: string
    content: string
    chunkType?: string
  }): Promise<Array<{ id: string; documentID: string; content: string; position: number }>> {
    const chunkID = `chunk_${input.documentID}_0`
    await Database.transaction((db) => {
      db.delete(RetrievalChunkTable)
        .where(sql`${RetrievalChunkTable.document_id} = ${input.documentID}`)
        .run()

      const contentHash = hashContent(input.content)

      db.insert(RetrievalChunkTable)
        .values({
          id: chunkID,
          document_id: input.documentID,
          project_id: input.projectID,
          content: input.content,
          position: 0,
          chunk_type: input.chunkType ?? "text",
          content_hash: contentHash,
          token_estimate: Math.ceil(input.content.length / 4),
          negative_signal: 0,
        })
        .run()
    })
    return [
      {
        id: chunkID,
        documentID: input.documentID,
        content: input.content,
        position: 0,
      },
    ]
  }

  export async function indexSession(input: {
    projectID: string
    sessionID: string
  }): Promise<void> {
    const db = Database.Client()
    
    const session = db
      .select({
        id: sql<string>`s.id`,
        title: sql<string>`s.title`,
      })
      .from(sql`session as s`)
      .where(sql`s.id = ${input.sessionID}`)
      .get()
    
    if (!session) return
    
    const messages = db
      .select({
        id: sql<string>`m.id`,
        data: sql<any>`m.data`,
      })
      .from(sql`message as m`)
      .where(sql`m.session_id = ${input.sessionID}`)
      .all()
    
    for (const message of messages) {
      const docID = `doc_session_${input.sessionID}_msg_${message.id}`
      const parts = db
        .select({
          data: sql<any>`p.data`,
        })
        .from(sql`part as p`)
        .where(sql`p.message_id = ${message.id}`)
        .all()

      const content = [
        typeof message.data === "string" ? message.data : JSON.stringify(message.data),
        ...parts.map((part) => (typeof part.data === "string" ? part.data : JSON.stringify(part.data))),
      ].join("\n")
      
      await Database.use((trx) => {
        trx.insert(RetrievalDocumentTable)
          .values({
            id: docID,
            project_id: input.projectID,
            session_id: input.sessionID,
            source_type: "session_message",
            source_id: message.id,
            title: session.title,
            fingerprint: `fp_session_${input.sessionID}_${message.id}`,
            negative_signal: 0,
          })
          .onConflictDoUpdate({
            target: RetrievalDocumentTable.id,
            set: {
              time_updated: Date.now(),
            },
          })
          .run()
        
        const contentHash = hashContent(content)
        
        trx.delete(RetrievalChunkTable)
          .where(sql`${RetrievalChunkTable.document_id} = ${docID}`)
          .run()
        
        trx.insert(RetrievalChunkTable)
          .values({
            id: `chunk_${docID}_0`,
            document_id: docID,
            project_id: input.projectID,
            content,
            position: 0,
            chunk_type: "text",
            content_hash: contentHash,
            token_estimate: Math.ceil(content.length / 4),
            negative_signal: 0,
          })
          .run()
      })
    }
    
    const plans = db
      .select({
        id: sql<string>`CAST(t.position AS TEXT)`,
        content: sql<string>`t.content`,
      })
      .from(sql`todo as t`)
      .where(sql`t.session_id = ${input.sessionID}`)
      .all()
    
    for (const plan of plans) {
      const docID = `doc_session_${input.sessionID}_plan_${plan.id}`
      
      await Database.use((trx) => {
        trx.insert(RetrievalDocumentTable)
          .values({
            id: docID,
            project_id: input.projectID,
            session_id: input.sessionID,
            source_type: "session_plan",
            source_id: plan.id,
            title: `${session.title} - Plan`,
            fingerprint: `fp_session_plan_${input.sessionID}_${plan.id}`,
            negative_signal: 0,
          })
          .onConflictDoUpdate({
            target: RetrievalDocumentTable.id,
            set: {
              time_updated: Date.now(),
            },
          })
          .run()
        
        const contentHash = hashContent(plan.content)
        
        trx.delete(RetrievalChunkTable)
          .where(sql`${RetrievalChunkTable.document_id} = ${docID}`)
          .run()
        
        trx.insert(RetrievalChunkTable)
          .values({
            id: `chunk_${docID}_0`,
            document_id: docID,
            project_id: input.projectID,
            content: plan.content,
            position: 0,
            chunk_type: "text",
            content_hash: contentHash,
            token_estimate: Math.ceil(plan.content.length / 4),
            negative_signal: 0,
          })
          .run()
      })
    }
  }

  export async function indexTaskArtifacts(input: {
    projectID: string
    rootSessionID?: string
    workgraph?: {
      rootSessionID?: string
      artifacts?: Array<{
        id?: string
        sessionID?: string
        taskID?: string
        messageID?: string
        type?: string
        summary?: string
        outcome?: string
        createdAt?: number
      }>
    }
  }): Promise<void> {
    const db = Database.Client()

    const workgraphArtifacts = input.workgraph?.artifacts ?? []
    if (workgraphArtifacts.length > 0) {
      for (const artifact of workgraphArtifacts) {
        const artifactID = artifact.id ?? artifact.messageID ?? artifact.taskID ?? hashContent(artifact.summary ?? "")
        const sessionID = artifact.sessionID ?? input.rootSessionID ?? input.workgraph?.rootSessionID ?? "unknown"
        const docID = `doc_task_${sessionID}_${artifactID}`
        const content = [
          artifact.type ? `type: ${artifact.type}` : undefined,
          artifact.outcome ? `outcome: ${artifact.outcome}` : undefined,
          artifact.taskID ? `task_id: ${artifact.taskID}` : undefined,
          artifact.messageID ? `message_id: ${artifact.messageID}` : undefined,
          artifact.summary,
        ]
          .filter(Boolean)
          .join("\n")

        if (!content.trim()) continue

        await Database.use((trx) => {
          trx.insert(RetrievalDocumentTable)
            .values({
              id: docID,
              project_id: input.projectID,
              session_id: sessionID,
              source_type: "task_artifact",
              source_id: artifactID,
              title: `${artifact.type ?? "Task Artifact"} - ${sessionID}`,
              fingerprint: `fp_task_artifact_${hashContent(`${sessionID}:${artifactID}:${content}`)}`,
              metadata: {
                rootSessionID: input.rootSessionID ?? input.workgraph?.rootSessionID,
                taskID: artifact.taskID,
                messageID: artifact.messageID,
                artifactType: artifact.type,
                outcome: artifact.outcome,
              },
              outcome_score: artifact.outcome === "success" ? 1 : artifact.outcome === "failure" ? -1 : 0,
              negative_signal: artifact.outcome === "failure" ? 1 : 0,
            })
            .onConflictDoUpdate({
              target: RetrievalDocumentTable.id,
              set: {
                time_updated: Date.now(),
                metadata: {
                  rootSessionID: input.rootSessionID ?? input.workgraph?.rootSessionID,
                  taskID: artifact.taskID,
                  messageID: artifact.messageID,
                  artifactType: artifact.type,
                  outcome: artifact.outcome,
                },
              },
            })
            .run()

          const contentHash = hashContent(content)

          trx.delete(RetrievalChunkTable)
            .where(sql`${RetrievalChunkTable.document_id} = ${docID}`)
            .run()

          trx.insert(RetrievalChunkTable)
            .values({
              id: `chunk_${docID}_0`,
              document_id: docID,
              project_id: input.projectID,
              content,
              position: 0,
              chunk_type: "task_artifact",
              content_hash: contentHash,
              token_estimate: Math.ceil(content.length / 4),
              outcome_score: artifact.outcome === "success" ? 1 : artifact.outcome === "failure" ? -1 : 0,
              negative_signal: artifact.outcome === "failure" ? 1 : 0,
            })
            .run()
        })
      }
      return
    }
    
    let sessionCondition = sql`1=1`
    if (input.rootSessionID) {
      sessionCondition = sql`s.id = ${input.rootSessionID} OR s.parent_id = ${input.rootSessionID}`
    }
    
    const sessions = db
      .select({
        id: sql<string>`s.id`,
        title: sql<string>`s.title`,
      })
      .from(sql`session as s`)
      .where(sessionCondition)
      .all()
    
    for (const session of sessions) {
      const artifacts = db
        .select({
          content: sql<string>`s.summary_diffs`,
        })
        .from(sql`session as s`)
        .where(sql`s.id = ${session.id}`)
        .get()
      
      if (artifacts?.content) {
        const docID = `doc_task_${session.id}_artifact`
        const content = typeof artifacts.content === "string" ? artifacts.content : JSON.stringify(artifacts.content)
        
        await Database.use((trx) => {
          trx.insert(RetrievalDocumentTable)
            .values({
              id: docID,
              project_id: input.projectID,
              session_id: session.id,
              source_type: "task_artifact",
              source_id: session.id,
              title: `${session.title} - Task Artifact`,
              fingerprint: `fp_task_artifact_${session.id}`,
              negative_signal: 0,
            })
            .onConflictDoUpdate({
              target: RetrievalDocumentTable.id,
              set: {
                time_updated: Date.now(),
              },
            })
            .run()
          
          const contentHash = hashContent(content)
          
          trx.delete(RetrievalChunkTable)
            .where(sql`${RetrievalChunkTable.document_id} = ${docID}`)
            .run()
          
          trx.insert(RetrievalChunkTable)
            .values({
              id: `chunk_${docID}_0`,
              document_id: docID,
              project_id: input.projectID,
              content,
              position: 0,
              chunk_type: "text",
              content_hash: contentHash,
              token_estimate: Math.ceil(content.length / 4),
              negative_signal: 0,
            })
            .run()
        })
      }
    }
  }

  export async function feedback(input: {
    documentID?: string
    chunkID?: string
    runID?: string
    outcome?: string
    verdict?: string
    score?: number
    note?: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    const outcome = input.outcome ?? input.verdict ?? "unknown"
    const metadata = { ...input.metadata, ...(input.note ? { note: input.note } : {}) }
    
    await Database.use((db) =>
      db.insert(RetrievalFeedbackTable)
        .values({
          id: `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          document_id: input.documentID,
          chunk_id: input.chunkID,
          run_id: input.runID ?? "unknown",
          outcome,
          score: input.score,
          metadata,
        })
        .run()
    )

    if (input.runID && !input.documentID && !input.chunkID && outcome === "orchestration_recall_success") {
      const run = await Database.use((db) =>
        db.select().from(RetrievalRunTable).where(sql`${RetrievalRunTable.id} = ${input.runID}`).get(),
      )

      if (run?.project_id && run?.session_id) {
        const candidates = await Database.use((db) =>
          db
            .select()
            .from(RetrievalDocumentTable)
            .where(sql`
              ${RetrievalDocumentTable.project_id} = ${run.project_id}
              AND ${RetrievalDocumentTable.session_id} = ${run.session_id}
            `)
            .all(),
        )

        const targetIDs = candidates
          .filter((document: any) => document.metadata?.hasOrchestrationRecall === true)
          .map((document: any) => document.id)

        for (const documentID of targetIDs) {
          const score = Math.max(input.score ?? 0, 0)
          await Database.use((db) =>
            db
              .update(RetrievalDocumentTable)
              .set({
                outcome_score: score,
                time_updated: Date.now(),
              })
              .where(sql`${RetrievalDocumentTable.id} = ${documentID}`)
              .run(),
          )

          await Database.use((db) =>
            db
              .update(RetrievalChunkTable)
              .set({
                outcome_score: score,
                time_updated: Date.now(),
              })
              .where(sql`${RetrievalChunkTable.document_id} = ${documentID}`)
              .run(),
          )
        }
      }
    }
    
    if (input.documentID) {
      await Database.use((db) =>
        db.update(RetrievalDocumentTable)
          .set({
            outcome_score: input.score,
            time_updated: Date.now(),
          })
          .where(sql`${RetrievalDocumentTable.id} = ${input.documentID}`)
          .run()
      )
    }
    
    if (input.chunkID) {
      await Database.use((db) =>
        db.update(RetrievalChunkTable)
          .set({
            outcome_score: input.score,
            time_updated: Date.now(),
          })
          .where(sql`${RetrievalChunkTable.id} = ${input.chunkID}`)
          .run()
      )
    }
  }

  export async function stats(projectID: string): Promise<{
    documentCount: number
    chunkCount: number
    embeddingCount: number
    runCount: number
    benchmarkSummary: Array<{
      effectiveLane: string
      pairStrategy: string
      indexSpace: string
      runCount: number
    }>
  }> {
    return Database.use((db) => {
      const docResult = db
        .select({ count: sql<number>`count(*)` })
        .from(RetrievalDocumentTable)
        .where(sql`${RetrievalDocumentTable.project_id} = ${projectID}`)
        .get()

      const chunkResult = db
        .select({ count: sql<number>`count(*)` })
        .from(RetrievalChunkTable)
        .where(sql`${RetrievalChunkTable.project_id} = ${projectID}`)
        .get()

      const embedResult = db
        .select({ count: sql<number>`count(*)` })
        .from(RetrievalEmbeddingTable)
        .innerJoin(RetrievalChunkTable, sql`${RetrievalEmbeddingTable.chunk_id} = ${RetrievalChunkTable.id}`)
        .where(sql`${RetrievalChunkTable.project_id} = ${projectID}`)
        .get()

      const runResult = db
        .select({ count: sql<number>`count(*)` })
        .from(RetrievalRunTable)
        .where(sql`${RetrievalRunTable.project_id} = ${projectID}`)
        .get()

      const benchmarkRows = db
        .select()
        .from(RetrievalRunTable)
        .where(sql`${RetrievalRunTable.project_id} = ${projectID}`)
        .all()

      const benchmarkSummary = Array.from(
        benchmarkRows.reduce((groups, run: any) => {
          const effectiveLane = String(run.metadata?.effectiveLane ?? run.policy_name ?? "unknown")
          const pairStrategy = String(run.metadata?.pairStrategy ?? run.metadata?.strategy ?? "unknown")
          const indexSpace = String(run.metadata?.indexSpace ?? "unknown")
          const key = `${effectiveLane}|${pairStrategy}|${indexSpace}`
          const current = groups.get(key) ?? { effectiveLane, pairStrategy, indexSpace, runCount: 0 }
          current.runCount += 1
          groups.set(key, current)
          return groups
        }, new Map<string, { effectiveLane: string; pairStrategy: string; indexSpace: string; runCount: number }>()),
      ).map(([, value]) => value)

      return {
        documentCount: docResult?.count ?? 0,
        chunkCount: chunkResult?.count ?? 0,
        embeddingCount: embedResult?.count ?? 0,
        runCount: runResult?.count ?? 0,
        benchmarkSummary,
      }
    })
  }
}

export { RetrievalPolicy, type RetrievalPolicyConfig } from "./policy"
export { RetrievalRuntime } from "./runtime"
export { RetrievalRerank } from "./rerank"
export { RetrievalSearch, type SearchCandidate } from "./search"
export { RetrievalBaton } from "./baton"
export { RetrievalModelSupervisor } from "./model-supervisor"

export function resetRetrievalRuntimeConfiguration(): void {
  RetrievalRuntime.reset()
}

export { configureRetrievalRuntime } from "./adapter"

export {
  classifyRetrievalIntent,
  routeRetrievalPolicyByIntent,
  getRetrievalPromptPreset,
  resolveRetrievalInstruction,
  type RetrievalIntent,
  type PromptPresetName,
} from "./prompt"
