import { sqliteTable, text, integer, index, real, blob } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { Timestamps } from "@/storage/schema.sql"

export const RetrievalDocumentTable = sqliteTable(
  "retrieval_document",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text(),
    source_type: text().notNull(),
    source_id: text(),
    title: text(),
    language: text(),
    fingerprint: text().notNull(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    outcome_score: real(),
    negative_signal: integer(),
    ...Timestamps,
  },
  (table) => [
    index("retrieval_document_project_idx").on(table.project_id),
    index("retrieval_document_session_idx").on(table.session_id),
    index("retrieval_document_source_idx").on(table.source_type, table.source_id),
    index("retrieval_document_fingerprint_idx").on(table.fingerprint),
  ],
)

export const RetrievalChunkTable = sqliteTable(
  "retrieval_chunk",
  {
    id: text().primaryKey(),
    document_id: text()
      .notNull()
      .references(() => RetrievalDocumentTable.id, { onDelete: "cascade" }),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    chunk_type: text(),
    content: text().notNull(),
    content_hash: text(),
    token_estimate: integer(),
    start_offset: integer(),
    end_offset: integer(),
    provenance: text({ mode: "json" }).$type<Record<string, unknown>>(),
    outcome_score: real(),
    negative_signal: integer(),
    ...Timestamps,
  },
  (table) => [
    index("retrieval_chunk_document_idx").on(table.document_id),
    index("retrieval_chunk_project_idx").on(table.project_id),
    index("retrieval_chunk_content_hash_idx").on(table.content_hash),
  ],
)

export const RetrievalEmbeddingTable = sqliteTable(
  "retrieval_embedding",
  {
    id: text().primaryKey(),
    chunk_id: text()
      .notNull()
      .references(() => RetrievalChunkTable.id, { onDelete: "cascade" }),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    vector: blob().notNull(),
    provider_id: text(),
    model_id: text().notNull(),
    dimensions: integer().notNull(),
    embedding_hash: text(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("retrieval_embedding_chunk_idx").on(table.chunk_id),
    index("retrieval_embedding_project_idx").on(table.project_id),
    index("retrieval_embedding_model_idx").on(table.model_id),
  ],
)

export const RetrievalFeedbackTable = sqliteTable(
  "retrieval_feedback",
  {
    id: text().primaryKey(),
    document_id: text().references(() => RetrievalDocumentTable.id, { onDelete: "cascade" }),
    chunk_id: text().references(() => RetrievalChunkTable.id, { onDelete: "cascade" }),
    run_id: text().notNull(),
    outcome: text().notNull(),
    score: real(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("retrieval_feedback_document_idx").on(table.document_id),
    index("retrieval_feedback_chunk_idx").on(table.chunk_id),
    index("retrieval_feedback_run_idx").on(table.run_id),
  ],
)

export const RetrievalPolicyTable = sqliteTable(
  "retrieval_policy",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    embedder_model_id: text(),
    reranker_model_id: text(),
    instruction_preset: text(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("retrieval_policy_project_idx").on(table.project_id),
    index("retrieval_policy_name_idx").on(table.name),
  ],
)

export const RetrievalRunTable = sqliteTable(
  "retrieval_run",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text(),
    query: text().notNull(),
    policy_name: text().notNull(),
    result_limit: integer(),
    latency_ms: integer(),
    candidate_count: integer(),
    selected_count: integer(),
    embedding_model_id: text(),
    reranker_model_id: text(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("retrieval_run_project_idx").on(table.project_id),
    index("retrieval_run_session_idx").on(table.session_id),
    index("retrieval_run_policy_idx").on(table.policy_name),
  ],
)
