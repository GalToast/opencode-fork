import { describe, expect, test } from "bun:test"
import { RetrievalBaton } from "../../src/retrieval/baton"
import type { RetrievalChunkCandidate } from "../../src/retrieval/types"

function candidate(input: Partial<RetrievalChunkCandidate> & Pick<RetrievalChunkCandidate, "chunkID" | "documentID" | "sourceType" | "content">): RetrievalChunkCandidate {
  // @ts-ignore
  return {
    score: 1,
    rerankScore: 1,
    ...input,
  }
}

describe("retrieval baton", () => {
  test("prompt recall prefers factual memory over self-referential assistant handoff text", () => {
    const query = "Recover the GitHub Workspaces harness work around embeddings reranking and compaction memory behavior."
    const candidates: RetrievalChunkCandidate[] = [
      candidate({
        chunkID: "chunk_assistant",
        documentID: "doc_assistant",
        sourceID: "msg_assistant",
        sourceType: "assistant_output",
        rerankScore: 30,
        title: "assistant:msg_assistant",
        content:
          "The compaction lost that information and I've been working on the wrong thing. Let me create an honest handoff. The next agent needs to recover the actual GitHub Workspaces context.",
      }),
      candidate({
        chunkID: "chunk_user",
        documentID: "doc_user",
        sourceID: "msg_user",
        sourceType: "session_message",
        rerankScore: 18,
        title: "user:msg_user",
        content:
          "Stop following the old local audit script. The real work is the GitHub Workspaces harness thread about embeddings reranking and compaction recall.",
      }),
      candidate({
        chunkID: "chunk_code",
        documentID: "doc_code",
        sourceID: "src_config",
        sourceType: "code_chunk",
        rerankScore: 16,
        title: "retrieval config",
        content:
          "Auto lane uses qwen3-embedding-0.6b for embeddings and qwen3-reranker-0.6b for reranking, with compaction baton and prompt baton both enabled.",
      }),
    ]

    const useful = RetrievalBaton.usefulCandidates({
      query,
      candidates,
      limit: 3,
      mode: "prompt_recall",
    })

    expect(useful.map((item) => item.chunkID)).toEqual(["chunk_user", "chunk_code", "chunk_assistant"])
  })

  test("default mode preserves rerank order without prompt-recall source boosts", () => {
    const candidates: RetrievalChunkCandidate[] = [
      candidate({
        chunkID: "chunk_user",
        documentID: "doc_user",
        sourceType: "session_message",
        rerankScore: 3,
        content: "User memory with a low rerank score.",
      }),
      candidate({
        chunkID: "chunk_assistant",
        documentID: "doc_assistant",
        sourceType: "assistant_output",
        rerankScore: 9,
        content: "Assistant output with a high rerank score.",
      }),
      candidate({
        chunkID: "chunk_code",
        documentID: "doc_code",
        sourceType: "code_chunk",
        rerankScore: 6,
        content: "Code chunk in the middle.",
      }),
    ]

    const useful = RetrievalBaton.usefulCandidates({
      query: "baton memory",
      candidates,
      mode: "default",
    })

    expect(useful.map((item) => item.chunkID)).toEqual(["chunk_assistant", "chunk_code", "chunk_user"])
  })

  test("preferred session ids stay ahead of otherwise higher ranked candidates", () => {
    const candidates: RetrievalChunkCandidate[] = [
      candidate({
        chunkID: "chunk_other",
        documentID: "doc_other",
        sourceType: "session_message",
        sessionID: "session_other",
        rerankScore: 10,
        content: "Higher ranked but not from the preferred session.",
      }),
      candidate({
        chunkID: "chunk_preferred",
        documentID: "doc_preferred",
        sourceType: "session_message",
        sessionID: "session_preferred",
        rerankScore: 2,
        content: "Lower ranked but from the preferred continuity family.",
      }),
    ]

    const useful = RetrievalBaton.usefulCandidates({
      query: "continuity family",
      candidates,
      preferredSessionIDs: ["session_preferred"],
      mode: "default",
    })

    expect(useful.map((item) => item.chunkID)).toEqual(["chunk_preferred", "chunk_other"])
  })

  test("compact applies the default ranking and limit", () => {
    const candidates: RetrievalChunkCandidate[] = [
      candidate({
        chunkID: "chunk_low",
        documentID: "doc_low",
        sourceType: "assistant_output",
        rerankScore: 1,
        content: "Low rank.",
      }),
      candidate({
        chunkID: "chunk_high",
        documentID: "doc_high",
        sourceType: "session_message",
        rerankScore: 8,
        content: "High rank.",
      }),
      candidate({
        chunkID: "chunk_mid",
        documentID: "doc_mid",
        sourceType: "code_chunk",
        rerankScore: 4,
        content: "Middle rank.",
      }),
    ]

    const compacted = RetrievalBaton.compact(candidates, 2)

    expect(compacted.map((item) => item.chunkID)).toEqual(["chunk_high", "chunk_mid"])
  })
})
