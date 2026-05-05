// Semantic Code Graph — a persistent, queryable representation of the
// codebase's symbol relationships. Built from LSP data and incrementally
// updated on file changes.

import { LSP } from "@/lsp"
import { Ripgrep } from "@/file/ripgrep"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { FileWatcher } from "@/file/watcher"
import { SQLiteKV } from "@/mecha/sqlite-kv"
import { pathToFileURL, fileURLToPath } from "url"
import path from "path"

const log = Log.create({ service: "graph.code-graph" })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SymbolNode = {
  id: string
  name: string
  kind: number
  file: string
  line: number
  detail?: string
}

export type Edge = {
  source: string
  target: string
  kind: "import" | "export" | "extends" | "implements" | "calls" | "references" | "contains"
}

export type SymbolData = {
  name: string
  kind: number
  line: number
}

export type ImpactResult = {
  depth: number
  count: number
  affected: string[]
}

export type FileNode = {
  path: string
  symbols: string[] // symbol IDs
  imports: string[] // file paths imported
  importedBy: string[] // file paths that import this
  at: number
}

// ---------------------------------------------------------------------------
// In-memory graph store
// ---------------------------------------------------------------------------

const state = Instance.state(() => ({
  symbols: new SQLiteKV<SymbolNode>("codegraph.symbols", { maxCacheSize: 10000 }),
  edges: new SQLiteKV<Edge[]>("codegraph.edges", { maxCacheSize: 5000 }),
  files: new SQLiteKV<FileNode>("codegraph.files", { maxCacheSize: 2000 }),
  indexed: false,
  indexing: false,
}))

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

/** Full index: walk all source files and extract symbols + edges. */
async function index(opts?: { signal?: AbortSignal }) {
  const graph = state()
  if (graph.indexing) return
  graph.indexing = true

  log.debug("graph.index.start")
  const start = Date.now()

  try {
    const exts = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]
    const files: string[] = []
    for await (const file of Ripgrep.files({ cwd: Instance.directory, signal: opts?.signal })) {
      opts?.signal?.throwIfAborted()
      const ext = path.extname(file).toLowerCase()
      if (exts.includes(ext)) files.push(file)
    }

    // Index files in batches to avoid overwhelming LSP
    const batch = 10
    for (let i = 0; i < files.length; i += batch) {
      opts?.signal?.throwIfAborted()
      const chunk = files.slice(i, i + batch)
      await Promise.allSettled(chunk.map((f) => indexFile(f)))
    }

    graph.indexed = true
    log.debug("graph.index.done", {
      files: files.length,
      symbols: graph.symbols.size,
      edges: [...graph.edges.values()].reduce((n, e) => n + e.length, 0),
      ms: Date.now() - start,
    })
  } finally {
    graph.indexing = false
  }
}

/** Index a single file: extract symbols and build import edges. */
async function indexFile(rel: string) {
  const graph = state()
  const abs = path.resolve(Instance.directory, rel)
  const uri = pathToFileURL(abs).href

  try {
    await LSP.touchFile(abs, false)
    const symbols = await LSP.documentSymbol(uri)
    if (!symbols || symbols.length === 0) return

    const ids: string[] = []

    for (const sym of symbols) {
      const name = sym.name
      const kind = sym.kind
      const range = "range" in sym ? sym.range : sym.location?.range
      const line = range?.start.line ?? 0
      const detail = "detail" in sym ? sym.detail : undefined

      const id = `${rel}::${name}:${line}`
      ids.push(id)

      graph.symbols.set(id, {
        id,
        name,
        kind,
        file: rel,
        line,
        detail,
      })
    }

    // Build import edges from file content
    const imports = await extractImports(abs)
    const node: FileNode = {
      path: rel,
      symbols: ids,
      imports,
      importedBy: [],
      at: Date.now(),
    }
    graph.files.set(rel, node)

    // Update importedBy for targets
    for (const imp of imports) {
      const target = graph.files.get(imp)
      if (target && !target.importedBy.includes(rel)) {
        target.importedBy.push(rel)
      }
    }
  } catch {
    // File may not have LSP support — skip silently
  }
}

/** Re-index a single file (incremental update). */
async function reindex(rel: string) {
  const graph = state()

  // Clear old data for this file
  const old = graph.files.get(rel)
  if (old) {
    for (const id of old.symbols) {
      graph.symbols.delete(id)
      graph.edges.delete(id)
    }
    // Remove from importedBy of old imports
    for (const imp of old.imports) {
      const target = graph.files.get(imp)
      if (target) {
        target.importedBy = target.importedBy.filter((p: string) => p !== rel)
      }
    }
    graph.files.delete(rel)
  }

  await indexFile(rel)
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Get all symbols in a file. */
function symbols(rel: string): SymbolNode[] {
  const node = state().files.get(rel)
  if (!node) return []
  return node.symbols.map((id) => state().symbols.get(id)).filter(Boolean) as SymbolNode[]
}

/** Get files that would be affected by changes to the given file. */
function ancestors(rel: string): string[] {
  const graph = state()
  const visited = new Set<string>()
  const queue = [rel]

  while (queue.length > 0) {
    const current = queue.pop()!
    if (visited.has(current)) continue
    visited.add(current)

    const node = graph.files.get(current)
    if (!node) continue

    for (const parent of node.importedBy) {
      if (!visited.has(parent)) queue.push(parent)
    }
  }

  visited.delete(rel) // don't include self
  return [...visited]
}

/** Get files that this file depends on. */
function descendants(rel: string): string[] {
  const graph = state()
  const visited = new Set<string>()
  const queue = [rel]

  while (queue.length > 0) {
    const current = queue.pop()!
    if (visited.has(current)) continue
    visited.add(current)

    const node = graph.files.get(current)
    if (!node) continue

    for (const imp of node.imports) {
      if (!visited.has(imp)) queue.push(imp)
    }
  }

  visited.delete(rel)
  return [...visited]
}

/** Get the blast radius of changing a file — how many files could break. */
function impact(rel: string): { files: string[]; depth: number; count: number } {
  const affected = ancestors(rel)
  let depth = 0
  const graph = state()
  const queue: { file: string; d: number }[] = [{ file: rel, d: 0 }]
  const seen = new Set<string>()

  while (queue.length > 0) {
    const { file, d } = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    depth = Math.max(depth, d)

    const node = graph.files.get(file)
    if (!node) continue
    for (const parent of node.importedBy) {
      if (!seen.has(parent)) queue.push({ file: parent, d: d + 1 })
    }
  }

  return { files: affected, depth, count: affected.length }
}

/** Find test files associated with a source file. */
function tests(rel: string): string[] {
  const graph = state()
  const base = path.basename(rel, path.extname(rel))
  const dir = path.dirname(rel)

  const patterns = [
    `${base}.test`,
    `${base}.spec`,
    `${base}_test`,
  ]

  const result: string[] = []
  for (const [file] of graph.files) {
    const name = path.basename(file, path.extname(file))
    const fdir = path.dirname(file)

    for (const pattern of patterns) {
      if (name === pattern) {
        result.push(file)
        break
      }
    }

    // Also check test directories
    if (fdir.includes("test") || fdir.includes("__tests__")) {
      if (name === base || name === `${base}.test` || name === `${base}.spec`) {
        if (!result.includes(file)) result.push(file)
      }
    }
  }

  return result
}

/** Get graph stats for debugging. */
function stats() {
  const graph = state()
  return {
    files: graph.files.size,
    symbols: graph.symbols.size,
    edges: [...graph.edges.values()].reduce((n, e) => n + e.length, 0),
    indexed: graph.indexed,
    indexing: graph.indexing,
  }
}

// ---------------------------------------------------------------------------
// File watcher integration
// ---------------------------------------------------------------------------

function init() {
  Bus.subscribe(FileWatcher.Event.Updated, (payload) => {
    const graph = state()
    if (!graph.indexed) return

    const file = payload.properties.file
    const rel = path.relative(Instance.directory, file)
    const ext = path.extname(rel).toLowerCase()

    if ([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"].includes(ext)) {
      void reindex(rel)
    }
  })
}

// ---------------------------------------------------------------------------
// Import extraction (lightweight regex, not full AST)
// ---------------------------------------------------------------------------

async function extractImports(abs: string): Promise<string[]> {
  try {
    const { Filesystem } = await import("@/util/filesystem")
    const content = await Filesystem.readText(abs)
    const imports: string[] = []

    // Match: import ... from "..." or require("...")
    const regex = /(?:import\s+.*?from\s+|require\s*\(\s*)["']([^"']+)["']/g
    let match
    while ((match = regex.exec(content)) !== null) {
      const spec = match[1]
      if (!spec.startsWith(".")) continue // skip node_modules

      const dir = path.dirname(abs)
      const resolved = resolveImport(dir, spec)
      if (resolved) {
        imports.push(path.relative(Instance.directory, resolved))
      }
    }

    return imports
  } catch {
    return []
  }
}

function resolveImport(dir: string, spec: string): string | undefined {
  const fs = require("fs") as typeof import("fs")
  const candidates = [
    path.resolve(dir, spec),
    path.resolve(dir, spec + ".ts"),
    path.resolve(dir, spec + ".tsx"),
    path.resolve(dir, spec + ".js"),
    path.resolve(dir, spec + ".jsx"),
    path.resolve(dir, spec, "index.ts"),
    path.resolve(dir, spec, "index.js"),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

export const CodeGraph = {
  index,
  indexFile,
  reindex,
  symbols,
  ancestors,
  descendants,
  impact,
  tests,
  stats,
  init,
} as const
