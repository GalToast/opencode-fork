import path from "path"
import { Global } from "../global"

export interface RetrievalTraceEntry {
  query: string
  detail?: string
  routedIntent?: string
  routedIntentSecondary?: string
  routingStrategy?: string
  effectivePolicy?: string
  routingConfidence?: string
  topCandidates: Array<{ snippet?: string; sourceType?: string }>
  selectedCandidateCount: number
  timestamp: string
  ambiguityFlags?: string[]
  routingScoreSpread?: number
  topCandidateScoreGap?: number
  topCandidateRerankGap?: number
}

export function retrievalTracePath(): string {
  return path.join(Global.Path.data, "retrieval-trace.jsonl")
}

export function retrievalTraceAmbiguityFlags(entry: RetrievalTraceEntry): string[] {
  const flags: string[] = []
  if (!entry.routedIntent) flags.push("no_intent")
  if (!entry.topCandidates || entry.topCandidates.length === 0) flags.push("no_candidates")
  if (entry.selectedCandidateCount === 0) flags.push("no_selection")
  
  if (entry.routingConfidence === "low") flags.push("low_routing_confidence")
  if (entry.routingStrategy === "dual_intent_blend") flags.push("dual_intent_blend")
  
  if (entry.routedIntentSecondary && (entry.routingScoreSpread ?? 0) < 1.0) {
    flags.push("tight_intent_race")
    flags.push("competing_secondary_intent")
  }
  
  if ((entry.topCandidateScoreGap ?? 0) < 0.2) flags.push("tight_top_candidate_gap")
  if ((entry.topCandidateRerankGap ?? 0) < 0.15) flags.push("tight_top_rerank_gap")
  
  return flags
}
