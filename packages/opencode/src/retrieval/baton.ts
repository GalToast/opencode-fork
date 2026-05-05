import type { RetrievalChunkCandidate } from "./types"

function compactionTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.toLowerCase().replace(/[^a-z0-9]+/g, "").trim())
    .filter((token) => token.length >= 3)
}

export namespace RetrievalBaton {
  export function usefulCandidates(input: {
    query: string
    candidates: RetrievalChunkCandidate[]
    limit?: number
    preferredSessionIDs?: string[]
    mode?: "prompt_recall" | "default"
  }): RetrievalChunkCandidate[] {
    const candidates = input.candidates ?? []
    const mode = input.mode ?? "default"
    
    let ranked: RetrievalChunkCandidate[]
    
    if (mode === "prompt_recall") {
      const queryTokens = new Set(compactionTokens(input.query))
      
      ranked = candidates
        .map((candidate) => {
          const textTokens = new Set(compactionTokens(`${candidate.content} ${candidate.title ?? ""}`))
          const overlap = [...queryTokens].filter((t) => textTokens.has(t)).length
          const overlapRatio = textTokens.size > 0 ? overlap / textTokens.size : 0
          const baseScore = candidate.rerankScore ?? candidate.score ?? 0
          let sourceBoost = 0
          if (candidate.sourceType === "session_message") {
            sourceBoost = 5
          } else if (candidate.sourceType === "code_chunk") {
            sourceBoost = 4
          } else if (candidate.sourceType === "assistant_output") {
            sourceBoost = -10
          }
          const score = baseScore * 0.1 + overlap * 5 + overlapRatio * 5 + sourceBoost
          return { candidate, score }
        })
        .sort((a, b) => b.score - a.score)
        .map((item) => item.candidate)
    } else {
      ranked = [...candidates].sort((a, b) => (b.rerankScore ?? b.score) - (a.rerankScore ?? a.score))
    }
    
    if (input.preferredSessionIDs && input.preferredSessionIDs.length > 0) {
      const preferred = ranked.filter((c) => c.sessionID && input.preferredSessionIDs!.includes(c.sessionID))
      const rest = ranked.filter((c) => !c.sessionID || !input.preferredSessionIDs!.includes(c.sessionID))
      ranked = [...preferred, ...rest]
    }
    
    const limit = input.limit ?? ranked.length
    return ranked.slice(0, limit)
  }

  export function compact(
    candidates: RetrievalChunkCandidate[],
    limit: number,
    preferredSessionIDs?: string[],
  ): RetrievalChunkCandidate[] {
    const selected = usefulCandidates({ candidates, limit, preferredSessionIDs, query: "", mode: "default" })
    return selected
  }
}
