import { afterEach, describe, expect, test } from "bun:test"
import { RetrievalRuntime } from "../../src/retrieval/runtime"
import { RetrievalRerank } from "../../src/retrieval/rerank"

describe("retrieval.runtime", () => {
  afterEach(() => {
    RetrievalRuntime.reset()
  })

  test("falls back to synthetic embedding metadata when no hook is configured", async () => {
    const result = await RetrievalRuntime.embedText({
      text: "orchard handshake",
      policy: { name: "auto" },
      purpose: "query",
    })

    expect(result.dimensions).toBeGreaterThan(0)
    expect(result.vector.length).toBe(result.dimensions)
    expect(result.metadata?.source).toBe("synthetic_fallback")
    expect(result.metadata?.purpose).toBe("query")
  })

  test("uses configured hooks when present", async () => {
    RetrievalRuntime.configure({
      async embedText() {
        return {
          dimensions: 3,
          vector: [0.5, 0.25, 0.25],
          metadata: { source: "hooked_embedder" },
        }
      },
      async rerank(input) {
        return {
          candidates: [...input.candidates].reverse().map((candidate, index) => ({
            ...candidate,
            rerankScore: 10 - index,
          })),
          metadata: { source: "hooked_reranker" },
        }
      },
    })

    const embedding = await RetrievalRuntime.embedText({
      text: "artifact recall",
      policy: { name: "quality" },
      purpose: "chunk",
    })

    // @ts-ignore
    const reranked = await RetrievalRuntime.rerank({
      policy: { name: "quality" },
      queryVector: [1, 0, 0],
      candidates: [
        { chunkID: "a", documentID: "doc-a", sourceType: "note", content: "first" },
        { chunkID: "b", documentID: "doc-b", sourceType: "note", content: "second" },
      ],
      candidateVectors: new Map([
        ["a", [1, 0, 0]],
        ["b", [0, 1, 0]],
      ]),
    })

    expect(embedding.metadata?.source).toBe("hooked_embedder")
    expect(reranked.metadata?.source).toBe("hooked_reranker")
    expect(reranked.candidates[0]?.chunkID).toBe("b")
  })

  test("synthetic rerank normalizes vectors before cosine scoring", () => {
    const reranked = RetrievalRerank.apply({
      queryVector: [1, 0],
      candidates: [
        { chunkID: "a", documentID: "doc-a", sourceType: "note", content: "first" },
        { chunkID: "b", documentID: "doc-b", sourceType: "note", content: "second" },
      ],
      candidateVectors: new Map([
        ["a", [9, 4]],
        ["b", [16, 12]],
      ]),
    })

    // @ts-ignore
    expect(reranked[0]?.chunkID).toBe("a")
    // @ts-ignore
    // @ts-ignore
    expect((reranked[0]?.rerankScore ?? 0)).toBeGreaterThan(reranked[1]?.rerankScore ?? 0)
  })
})
