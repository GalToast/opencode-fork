export type RetrievalSourceType = "session_message" | "session_plan" | "tool_output" | "task_artifact" | "file" | "assistant_output" | "code_chunk" | "note" | "skill" | "doc" | "tool_failure" | "jit_outcome" | "provenance" | "episode" | "recipe" | (string & {})

export interface RetrievalChunkCandidate {
  chunkID: string
  documentID: string
  sourceID: string
  sourceType: RetrievalSourceType
  content: string
  text?: string
  title?: string
  score: number
  rerankScore?: number
  outcomeScore?: number
  feedbackScore?: number
  sessionID?: string
  scope?: string
  metadata?: Record<string, unknown>
}

export type RetrievalPolicyName = "auto" | "fast" | "quality" | "local" | "isolated"

export interface RetrievalTraceCandidate {
  sessionID: string
  title: string
  objective?: string
  outcome?: string
  timestamp: number
  // Benchmark-specific fields
  snippet?: string
  documentID?: string
  score?: number
  rerankScore?: number
  rank?: number
  primaryIntent?: string
}

export type RetrievalTraceReplayIntent = "search" | "rerank" | "embed"
