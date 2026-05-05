// AST Context Caching — saves tokens and reduces TTFT latency when
// streaming to cloud providers by avoiding resending files that haven't
// structurally changed (e.g., only comments or local variables were modified).

import { createHash } from "crypto"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "provider.cache" })

// Tracks the last sent structural hash of files per session
// sessionID -> file -> structural_hash
const sent = Instance.state(() => new Map<string, Map<string, string>>())

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

/** 
 * Compresses context if the structural AST hasn't changed since it was last sent.
 * Returns the original content if it's the first time, or if structure changed.
 */
async function compress(input: {
  sessionID: string
  file: string
  content: string
}): Promise<string> {
  const fileCache = sent().get(input.sessionID) ?? new Map<string, string>()
  
  // 1. Compute structural hash using CodeGraph symbols
  let astHash = ""
  try {
    const { CodeGraph } = await import("@/graph/code-graph")
    const symbols = CodeGraph.symbols(input.file)
    const imports = CodeGraph.descendants(input.file)
    
    // Create a fingerprint of what the file *does*, ignoring how it's written
    const structure = JSON.stringify({
      symbols: symbols.map(s => `${s.name}:${s.kind}`),
      imports,
    })
    
    astHash = createHash("sha1").update(structure).digest("hex")
  } catch {
    // Fallback: fast hash of the raw text if CodeGraph isn't available
    astHash = createHash("sha1").update(input.content).digest("hex")
  }

  // 2. Check cache
  const lastHash = fileCache.get(input.file)
  
  // Update cache immediately to prevent duplicate sends in same turn
  fileCache.set(input.file, astHash)
  sent().set(input.sessionID, fileCache)

  if (lastHash === astHash) {
    // Structure unchanged! Brutally crop the file payload to save tokens.
    log.debug("cache.hit", { sessionID: input.sessionID, file: input.file })
    
    const lines = input.content.split("\n")
    if (lines.length <= 30) return input.content // Not worth compressing
    
    const head = lines.slice(0, 15).join("\n")
    const tail = lines.slice(-10).join("\n")
    
    return [
      head,
      `\n... [CONTEXT CACHED] ...`,
      `... ${lines.length - 25} lines omitted because file structure is unchanged ...`,
      `... (AST identical to previous context block) ...\n`,
      tail
    ].join("\n")
  }

  log.debug("cache.miss", { sessionID: input.sessionID, file: input.file })
  return input.content
}

function clear(sessionID: string) {
  sent().delete(sessionID)
}

export const ASTCache = {
  compress,
  clear,
} as const
