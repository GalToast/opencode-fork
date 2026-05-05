import { sql, and, or, inArray, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { RetrievalRuntime } from "./runtime"
import type { RetrievalPolicyConfig } from "./policy"
import { RetrievalPolicy } from "./policy"
import {
  RetrievalDocumentTable,
  RetrievalChunkTable,
  RetrievalEmbeddingTable,
} from "./retrieval.sql"

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "give",
  "has",
  "have",
  "he",
  "her",
  "here",
  "him",
  "his",
  "how",
  "i",
  "in",
  "is",
  "it",
  "its",
  "just",
  "like",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "out",
  "so",
  "some",
  "such",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "up",
  "us",
  "very",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "current",
  "objective",
  "upload",
  "server",
])

export interface SearchCandidate {
  chunkID: string
  documentID: string
  sourceType: string
  content: string
  score: number
  outcomeScore?: number
  sessionID?: string
}

export interface HybridRankInput {
  candidates: SearchCandidate[]
  queryVector: number[]
  policy: RetrievalPolicyConfig
  skipRerank?: boolean
}

export interface LexicalSearchInput {
  projectID: string
  terms: string[]
  limit: number
  sourceTypes?: string[]
  sessionIDs?: string[]
}

export namespace RetrievalSearch {
  function indexSpace(policy: RetrievalPolicyConfig): string {
    return (
      (typeof policy.metadata?.indexSpace === "string" ? policy.metadata.indexSpace : undefined) ??
      (typeof policy.embedder?.settings?.indexSpace === "string" ? policy.embedder.settings.indexSpace : undefined) ??
      policy.embedder?.modelID ??
      policy.name
    )
  }

  function semanticSignature(policy: RetrievalPolicyConfig): string {
    const embedder = policy.embedder as (RetrievalPolicyConfig["embedder"] & {
      dimensions?: number
      outputType?: string
    }) | undefined

    return JSON.stringify({
      indexSpace: indexSpace(policy),
      modelID: embedder?.modelID,
      instructionPreset: embedder?.instructionPreset,
      instruction: embedder?.instruction,
      dimensions: embedder?.dimensions,
      outputType: embedder?.outputType,
    })
  }

  export function extractTerms(query: string): string[] {
    const terms = query
      .toLowerCase()
      .split(/[\s]+/)
      .map((term) => term.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
      .filter((term) => term.length > 0)
      .filter((term) => !STOPWORDS.has(term))
    return terms
  }

  export function compactQuery(query: string, maxLen: number): { query: string; truncated: boolean; originalLength: number } {
    const originalLength = query.length
    if (originalLength <= maxLen) {
      return { query, truncated: false, originalLength }
    }
    const truncated = query.slice(0, maxLen)
    const lastSpace = truncated.lastIndexOf(" ")
    if (lastSpace > maxLen * 0.8) {
      return { query: truncated.slice(0, lastSpace), truncated: true, originalLength }
    }
    return { query: truncated, truncated: true, originalLength }
  }

  export function lexicalSearch(input: LexicalSearchInput): SearchCandidate[] {
    const { projectID, terms, limit, sourceTypes, sessionIDs } = input

    if (terms.length === 0) {
      return []
    }

    const db = Database.Client()

    const termConditions = terms.map((term) => sql`instr(lower(${RetrievalChunkTable.content}), lower(${term})) > 0`)

    let whereClause = and(
      sql`${RetrievalChunkTable.project_id} = ${projectID}`,
      or(...termConditions)
    )

    if (sourceTypes && sourceTypes.length > 0) {
      const sourceConditions = sourceTypes.map((st) => sql`${RetrievalDocumentTable.source_type} = ${st}`)
      whereClause = and(whereClause, or(...sourceConditions))
    }

    if (sessionIDs && sessionIDs.length > 0) {
      const sessionConditions = sessionIDs.map((sid) => sql`${RetrievalDocumentTable.session_id} = ${sid}`)
      whereClause = and(whereClause, or(...sessionConditions))
    }

    const chunks = db
      .select({
        chunkID: RetrievalChunkTable.id,
        documentID: RetrievalChunkTable.document_id,
        sourceType: RetrievalDocumentTable.source_type,
        content: RetrievalChunkTable.content,
        sessionID: RetrievalDocumentTable.session_id,
        chunkOutcomeScore: RetrievalChunkTable.outcome_score,
        documentOutcomeScore: RetrievalDocumentTable.outcome_score,
      })
      .from(RetrievalChunkTable)
      .innerJoin(RetrievalDocumentTable, sql`${RetrievalChunkTable.document_id} = ${RetrievalDocumentTable.id}`)
      .where(whereClause)
      .limit(limit)
      .all()

    const threshold = terms.length >= 3 ? 2 : 1
    return chunks
      .map((chunk: { chunkID: string; documentID: string; sourceType: string; content: string; sessionID?: string | null; chunkOutcomeScore?: number | null; documentOutcomeScore?: number | null }) => {
        const text = chunk.content.toLowerCase()
        const outcome = Math.max(chunk.chunkOutcomeScore ?? 0, chunk.documentOutcomeScore ?? 0)
        return {
          chunkID: chunk.chunkID,
          documentID: chunk.documentID,
          sourceType: chunk.sourceType,
          content: chunk.content,
          score: terms.reduce((sum, term) => sum + (text.includes(term.toLowerCase()) ? 1 : 0), 0),
          outcomeScore: outcome,
          sessionID: chunk.sessionID ?? undefined,
        }
      })
      .filter((chunk) => chunk.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  export async function hybridRank(input: HybridRankInput): Promise<{
    candidates: SearchCandidate[]
    metadata?: Record<string, unknown>
  }> {
    const { candidates, queryVector, policy, skipRerank } = input

    if (skipRerank || candidates.length === 0) {
      const sorted = [...candidates].sort((a, b) => b.score - a.score)
      return {
        candidates: sorted,
        metadata: skipRerank ? { rerankSource: "skipped_fast_path", rerankFallbackReason: "rerank_disabled_for_search" } : undefined,
      }
    }

    const chunkIDs = candidates.map((c) => c.chunkID)
    const candidateVectors = await getChunkVectors(chunkIDs, policy)

    const rerankResult = await RetrievalRuntime.rerank({
      policy,
      queryText: "",
      queryVector,
      candidates: candidates.map((c) => ({
        chunkID: c.chunkID,
        documentID: c.documentID,
        sourceType: c.sourceType,
        content: c.content,
        score: c.score,
        outcomeScore: c.outcomeScore,
        sessionID: c.sessionID,
      })),
      candidateVectors,
    })

    const rerankedCandidates = rerankResult.candidates as unknown as SearchCandidate[]

    return {
      candidates: rerankedCandidates,
      metadata: rerankResult.metadata,
    }
  }

  export async function getChunkVectors(
    chunkIDs: string[],
    policy: RetrievalPolicyConfig
  ): Promise<Map<string, number[]>> {
    const vectorMap = new Map<string, number[]>()

    const indexSpaceID = indexSpace(policy)
    const model = semanticSignature(policy)
    const existing = await Database.use((db) =>
      db
        .select({
          chunk_id: RetrievalEmbeddingTable.chunk_id,
          vector: RetrievalEmbeddingTable.vector,
        })
        .from(RetrievalEmbeddingTable)
        .where(and(inArray(RetrievalEmbeddingTable.chunk_id, chunkIDs), eq(RetrievalEmbeddingTable.model_id, model)))
        .all()
    )

    for (const row of existing) {
      if (row.vector) {
        const vector = row.vector instanceof Buffer ? JSON.parse(row.vector.toString()) : row.vector
        vectorMap.set(row.chunk_id, vector)
      }
    }

    const missingChunkIDs = chunkIDs.filter((id) => !vectorMap.has(id))

    if (missingChunkIDs.length > 0) {
      const chunks = await Database.use((db) =>
        db
          .select({
            id: RetrievalChunkTable.id,
            content: RetrievalChunkTable.content,
            project_id: RetrievalChunkTable.project_id,
          })
          .from(RetrievalChunkTable)
          .where(inArray(RetrievalChunkTable.id, missingChunkIDs))
          .all()
      )

      for (const chunk of chunks) {
        try {
          const embedResult = await RetrievalRuntime.embedText({
            text: chunk.content,
            policy,
            purpose: "chunk",
          })

          const vectorBlob = Buffer.from(JSON.stringify(embedResult.vector))

          await Database.use((db) =>
            db
              .insert(RetrievalEmbeddingTable)
              .values({
                id: `embed_${chunk.id}_${Date.now()}`,
                chunk_id: chunk.id,
                project_id: chunk.project_id,
                vector: vectorBlob,
                provider_id: policy.embedder?.providerID ?? "local",
                model_id: model,
                dimensions: embedResult.dimensions,
                metadata: {
                  ...(embedResult.metadata ?? {}),
                  indexSpace: indexSpaceID,
                  semanticSignature: model,
                },
              })
              .run()
          )

          vectorMap.set(chunk.id, embedResult.vector)
        } catch {
          continue
        }
      }
    }

    return vectorMap
  }
}
