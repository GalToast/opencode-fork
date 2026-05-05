import { Log } from "../util/log"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import path from "path"

const log = Log.create({ service: "session.jit" })

const SEARCH_GLOBS = [
  "src/**",
  "packages/**",
  "script/**",
  "scripts/**",
  "test/**",
  "!**/node_modules/**",
  "!**/.git/**",
  "!**/.opencode/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/coverage/**",
  "!**/reports/**",
  "!**/output/**",
  "!**/tmp/**",
  "!**/temp/**",
]

const CODE_CONTEXT_REGEX =
  /(?:\b(?:src|package|module|function|class|component|provider|session|prompt|tracker|tool|jit|hydrator|harness|error|stack|trace|bug|regression|typescript|javascript|tsx?|jsx?)\b|[\\/]|\.tsx?\b|\.jsx?\b|[A-Z][a-z]+[A-Z]\w*)/i
const MIN_CONTEXT_LENGTH = 40
const MIN_KEYWORDS = 2

function isCodeIntent(taskContext: string): boolean {
  const text = taskContext.toLowerCase()

  if (/[\\/]/.test(taskContext) || /\b(?:src|lib|pkg|test|spec|scripts?|packages?)[\\/]/i.test(taskContext))
    return true

  if (/\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|hpp|cs|rb|php|sql|json|yaml|yml|md|sh|bash)\b/i.test(taskContext))
    return true

  if (/```[\s\S]*```/.test(taskContext))
    return true

  if (/^#+\s*(?:implementation|architecture|design|refactor|bug|fix|todo|plan|spec|api|interface|module|component)/im.test(taskContext))
    return true

  if (/[A-Z][a-z]+[A-Z]\w*/.test(taskContext) || /\b(?:const|let|var|function|class|interface|type|enum|export|import|async|await)\s+[a-zA-Z_$]/.test(taskContext))
    return true

  const codeVerbs = /\b(?:implement|refactor|debug|fix|add|update|remove|delete|create|generate|parse|serialize|validate|handle|process|invoke|call|return|throw|catch|test|mock|stub|deploy|build|compile|bundle|lint|format|optimize|cache|hydrate|fetch|query|mutate|subscribe|emit|dispatch|navigate|render|mount|unmount)\b/i
  if (codeVerbs.test(text) && /\b(?:file|module|function|class|component|endpoint|route|handler|hook|state|prop|param|arg|response|request|error|type|interface)\b/i.test(text))
    return true

  if (/\b[a-zA-Z_$]\w*\s*\([^)]*\)/.test(taskContext))
    return true

  if (/\b(?:file|path|module|dir)[\s:.-]*[a-zA-Z0-9_$./\\-]{2,}/i.test(taskContext))
    return true

  return false
}
const MAX_KEYWORDS = 8

interface FileMatch {
  path: string
  count: number
  relevance: number
  size: number
  recency: number
}

export namespace JitHydrator {
  const sessionPagedHistory = Instance.state(() => new Map<string, Set<string>>())
  const sessionFileCache = Instance.state(() => new Map<string, Map<string, { content: string; hash: string; timestamp: number }>>())

  export interface HydrationOptions {
    sessionID: string
    taskContext?: string
    turnID?: string
    step?: number
    maxFiles?: number
    maxTokens?: number
    activeFiles?: string[]
  }

  export async function hydrate(options: HydrationOptions): Promise<string | undefined> {
    const start = Date.now()
    const context = {
      sessionID: options.sessionID,
      turnID: options.turnID,
      step: options.step,
    }

    if (!options.taskContext || options.taskContext.length < MIN_CONTEXT_LENGTH) {
      if (process.env.OPENCODE_DEBUG_PROMPT_TIMING === "true" || process.env.OPENCODE_DEBUG_PROMPT_TIMING === "1") {
        log.debug("jit.hydrate", {
          ...context,
          durationMS: Date.now() - start,
          matched: false,
          reason: "taskContextTooShort",
        })
      }
      return undefined
    }

    if (!CODE_CONTEXT_REGEX.test(options.taskContext)) {
      if (process.env.OPENCODE_DEBUG_PROMPT_TIMING === "true" || process.env.OPENCODE_DEBUG_PROMPT_TIMING === "1") {
        log.debug("jit.hydrate", {
          ...context,
          durationMS: Date.now() - start,
          matched: false,
          reason: "regexNoMatch",
        })
      }
      return undefined
    }

    if (!isCodeIntent(options.taskContext)) {
      if (process.env.OPENCODE_DEBUG_PROMPT_TIMING === "true" || process.env.OPENCODE_DEBUG_PROMPT_TIMING === "1") {
        log.debug("jit.hydrate", {
          ...context,
          durationMS: Date.now() - start,
          matched: false,
          reason: "notCodeIntent",
        })
      }
      return undefined
    }

    const keywords = extractKeywords(options.taskContext)
    if (keywords.length < MIN_KEYWORDS) {
      if (process.env.OPENCODE_DEBUG_PROMPT_TIMING === "true" || process.env.OPENCODE_DEBUG_PROMPT_TIMING === "1") {
        log.debug("jit.hydrate", {
          ...context,
          durationMS: Date.now() - start,
          matched: false,
          reason: "insufficientKeywords",
          keywordCount: keywords.length,
        })
      }
      return undefined
    }

    const history = getPagedHistory(options.sessionID)
    const tokenBudget = options.maxTokens ?? 6000

    const scoredFiles = await searchAndScore({
      keywords,
      cwd: Instance.directory,
      activeFiles: options.activeFiles ?? [],
      history,
      tokenBudget,
      maxFiles: options.maxFiles,
    })

    if (scoredFiles.length === 0) {
      if (process.env.OPENCODE_DEBUG_PROMPT_TIMING === "true" || process.env.OPENCODE_DEBUG_PROMPT_TIMING === "1") {
        log.debug("jit.hydrate", {
          ...context,
          durationMS: Date.now() - start,
          matched: false,
          reason: "noRelatedFiles",
          keywordCount: keywords.length,
        })
      }
      return undefined
    }

    const blocks: string[] = ["### Memory MMU: Just-in-Time Context"]
    blocks.push("The following modules were paged into your context to assist with the current logic branch:")

    const readStart = Date.now()
    let addedFiles = 0

    for (const file of scoredFiles) {
      const snippet = await getFileSnippet(file.path, options.sessionID, tokenBudget)
      if (snippet) {
        blocks.push(`\n--- Paged Module: ${file.path} ---\n${snippet}\n`)
        history.add(file.path)
        addedFiles += 1
      }
    }

    if (process.env["OPENCODE_DEBUG_PROMPT_TIMING"] === "true") {
      log.debug("jit.hydrate", {
        ...context,
        durationMS: Date.now() - start,
        matched: true,
        keywordCount: keywords.length,
        relatedFileCount: scoredFiles.length,
        addedFiles,
        readDurationMS: Date.now() - readStart,
      })
    }

    return blocks.join("\n")
  }

  function extractKeywords(text: string): string[] {
    const stopWords = new Set([
      "this", "that", "with", "from", "your", "task", "code", "file",
      "please", "help", "need", "should", "implementation", "reply",
      "exactly", "nothing", "else", "issue", "problem", "would", "could",
      "using", "have", "been", "will", "there", "their", "what", "about",
      "which", "when", "make", "like", "time", "just", "know", "take",
      "into", "year", "being", "have", "does", "want", "way", "look",
      "first", "also", "after", "use", "back", "than", "same", "well",
      "find", "here", "many", "some", "them", "see", "other", "than",
      "then", "now", "come", "its", "over", "think", "such", "give",
      "most", "even", "really", "thing", "things", "actually", "basically",
      "simply", "obviously", "definitely", "certainly", "perhaps", "probably",
      "create", "update", "delete", "remove", "add", "get", "set", "handle", "process",
      "run", "build", "test", "check", "fix", "change", "modify", "refactor",
      "function", "class", "method", "variable", "const", "let", "var",
      "return", "import", "export", "default", "async", "await",
      "new", "old", "current", "previous", "next", "last",
      "good", "bad", "better", "best", "correct", "wrong",
    ])

    const codePatterns = [
      /(?:^|\s)([a-zA-Z_$][a-zA-Z0-9_$]{2,})/g,
      /(?:function|class|const|let|var|import|export|interface|type)\s+([a-zA-Z_$][a-zA-Z0-9_$]{2,})/g,
      /@(\w+)/g,
      /(?:file|path|module|function|class|method|prop|state|handler|hook|context)\s*[:-]\s*([a-zA-Z_$][a-zA-Z0-9_$/.-]{2,})/gi,
    ]

    const found: Map<string, number> = new Map()

    for (const pattern of codePatterns) {
      let match
      while ((match = pattern.exec(text)) !== null) {
        const term = match[1]?.toLowerCase()
        if (term && term.length > 3 && !stopWords.has(term)) {
          found.set(term, (found.get(term) ?? 0) + 1)
        }
      }
    }

    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !stopWords.has(w))

    for (const w of words) {
      if (/^[a-z]/.test(w) && !/\d{4,}/.test(w)) {
        found.set(w, (found.get(w) ?? 0) + 1)
      }
    }

    const sorted = [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_KEYWORDS).map(e => e[0])

    if (sorted.length < MIN_KEYWORDS) {
      const pathPattern = /(?:\/|\\)([a-zA-Z_$][a-zA-Z0-9_$-]+(?:\/|\\)?)/g
      let match
      while ((match = pathPattern.exec(text)) !== null) {
        const term = match[1]?.toLowerCase()
        if (term && term.length > 2 && !sorted.includes(term)) {
          sorted.push(term)
          if (sorted.length >= MIN_KEYWORDS) break
        }
      }
    }

    return sorted.slice(0, MAX_KEYWORDS)
  }

  async function searchAndScore(opts: {
    keywords: string[]
    cwd: string
    activeFiles: string[]
    history: Set<string>
    tokenBudget: number
    maxFiles?: number
  }): Promise<FileMatch[]> {
    const { keywords, cwd, activeFiles, history, tokenBudget, maxFiles } = opts

    let matches: any[] = []
    try {
      matches = await Ripgrep.search({
        pattern: keywords.join("|"),
        cwd,
        limit: 50,
        glob: SEARCH_GLOBS,
      })
    } catch (e) {
      log.debug("JIT Ripgrep search failed", { error: e })
    }

    const fileStats = new Map<string, { count: number; matches: any[] }>()

    for (const m of matches) {
      const filePath = m.path?.text
      if (!filePath) continue
      if (activeFiles.includes(filePath)) continue
      if (history.has(filePath)) continue

      const existing = fileStats.get(filePath) ?? { count: 0, matches: [] }
      existing.count += 1
      existing.matches.push(m)
      fileStats.set(filePath, existing)
    }

    const candidates: FileMatch[] = []

    for (const [filePath, stats] of fileStats) {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath)

      let size = 0
      let recency = 0
      try {
        const file = Bun.file(fullPath)
        const stat = await file.stat()
        size = stat.size
        recency = Date.now() - stat.mtimeMs
      } catch {
        size = 1000
        recency = 30 * 24 * 60 * 60 * 1000
      }

      const relevance = computeRelevance({
        matchCount: stats.count,
        keywords,
        filePath,
        recency,
      })

      candidates.push({
        path: filePath,
        count: stats.count,
        relevance,
        size,
        recency,
      })
    }

    const scored = candidates
      .filter(f => f.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)

    const selected: FileMatch[] = []
    let usedTokens = 0

    for (const file of scored) {
      const estimatedTokens = Math.ceil(file.size / 4)
      if (usedTokens + estimatedTokens > tokenBudget) {
        const remaining = tokenBudget - usedTokens
        if (remaining > 200) {
          selected.push({ ...file, size: remaining * 4 })
        }
        break
      }
      selected.push(file)
      usedTokens += estimatedTokens

      if (maxFiles && selected.length >= maxFiles) break
      if (selected.length >= (opts.keywords.length >= 5 ? 4 : 3)) break
    }

    return selected
  }

  function computeRelevance(opts: {
    matchCount: number
    keywords: string[]
    filePath: string
    recency: number
  }): number {
    const { matchCount, keywords, filePath, recency } = opts

    const pathScore = keywords.reduce((acc, kw) => {
      if (filePath.toLowerCase().includes(kw)) return acc + 3
      return acc
    }, 0)

    const extScore = (() => {
      const ext = path.extname(filePath).toLowerCase()
      if (ext === ".ts" || ext === ".tsx") return 2
      if (ext === ".js" || ext === ".jsx") return 1
      return 0
    })()

    const recencyScore = Math.max(0, 1 - (recency / (180 * 24 * 60 * 60 * 1000)))

    const matchWeight = Math.log2(matchCount + 1)

    return (matchWeight * 1.0) + (pathScore * 2.0) + (extScore * 1.5) + (recencyScore * 0.5)
  }

  async function getFileSnippet(filePath: string, sessionID: string, maxTokens: number): Promise<string | undefined> {
    const cache = sessionFileCache()
    const sessionCache = cache.get(sessionID) ?? new Map()
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(Instance.directory, filePath)

    try {
      const content = await Promise.race([
        Bun.file(fullPath).text(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
      ])
      const hash = Bun.hash(content).toString(36)

      const cached = sessionCache.get(filePath)
      if (cached?.hash === hash) {
        return cached.content
      }

      const maxChars = maxTokens * 4
      const lines = content.split("\n")

      const priorityPatterns = [
        /^(?:export|import|const|let|var|function|class|interface|type)\s/m,
        /^export\s/m,
        /^(?:async\s)?(?:function|const|class)/m,
      ]

      const importantLines: number[] = []
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of priorityPatterns) {
          if (pattern.test(lines[i])) {
            importantLines.push(i)
            break
          }
        }
      }

      let snippet: string
      if (content.length <= maxChars) {
        snippet = content
      } else if (importantLines.length > 0) {
        const keptLines = new Set<number>()
        for (const lineIdx of importantLines.slice(0, 15)) {
          for (let i = Math.max(0, lineIdx - 3); i <= Math.min(lines.length - 1, lineIdx + 5); i++) {
            keptLines.add(i)
          }
        }
        const sorted = [...keptLines].sort((a, b) => a - b)
        let chars = 0
        const selected: number[] = []
        for (const idx of sorted) {
          if (chars + lines[idx].length > maxChars) break
          selected.push(idx)
          chars += lines[idx].length + 1
        }
        snippet = selected.map(i => lines[i]).join("\n")
        if (selected.length < lines.length) {
          snippet += "\n// ... truncated"
        }
      } else {
        snippet = lines.slice(0, Math.floor(maxChars / 50)).join("\n")
        if (lines.length > maxChars / 50) {
          snippet += "\n// ... truncated"
        }
      }

      sessionCache.set(filePath, { content: snippet, hash, timestamp: Date.now() })
      cache.set(sessionID, sessionCache)

      return snippet
    } catch (e) {
      return undefined
    }
  }

  function getPagedHistory(sessionID: string): Set<string> {
    const map = sessionPagedHistory()
    if (!map.has(sessionID)) {
      map.set(sessionID, new Set())
    }
    const history = map.get(sessionID)!
    if (history.size > 20) {
      const entries = [...history]
      const keep = entries.slice(entries.length >> 1)
      history.clear()
      for (const entry of keep) history.add(entry)
    }
    return history
  }

  export function clearSessionCache(sessionID: string): void {
    sessionPagedHistory().delete(sessionID)
    sessionFileCache().delete(sessionID)
  }
}