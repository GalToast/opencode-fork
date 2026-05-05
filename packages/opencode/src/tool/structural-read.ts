// Structural Read — higher-level file reading modes that provide
// structured views instead of raw text. Plugs into the existing read
// tool by offering alternate output modes.

import { LSP } from "@/lsp"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import path from "path"
import { pathToFileURL } from "url"

const log = Log.create({ service: "tool.structural-read" })

export type ReadMode = "raw" | "outline" | "symbols" | "imports" | "structure"

export type SymbolOutline = {
  name: string
  kind: string
  line: number
  detail?: string
  children?: SymbolOutline[]
}

export type FileStructure = {
  file: string
  lines: number
  symbols: SymbolOutline[]
  imports: string[]
  exports: string[]
}

// Map LSP SymbolKind numbers to human-readable names
const kinds: Record<number, string> = {
  1: "file", 2: "module", 3: "namespace", 4: "package",
  5: "class", 6: "method", 7: "property", 8: "field",
  9: "constructor", 10: "enum", 11: "interface", 12: "function",
  13: "variable", 14: "constant", 15: "string", 16: "number",
  17: "boolean", 18: "array", 19: "object", 20: "key",
  21: "null", 22: "enum_member", 23: "struct", 24: "event",
  25: "operator", 26: "type_parameter",
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/** Get a symbol outline of a file (no source code, just structure). */
async function outline(rel: string): Promise<SymbolOutline[]> {
  const abs = path.resolve(Instance.directory, rel)
  const uri = pathToFileURL(abs).href

  try {
    if (typeof LSP.touchFile === "function") await LSP.touchFile(abs, false)
    const symbols = await LSP.documentSymbol(uri)
    if (!symbols || symbols.length === 0) return []

    return symbols.map((sym) => {
      const range = "range" in sym ? sym.range : sym.location?.range
      return {
        name: sym.name,
        kind: kinds[sym.kind] ?? `kind_${sym.kind}`,
        line: (range?.start.line ?? 0) + 1,
        detail: "detail" in sym ? sym.detail : undefined,
      }
    })
  } catch {
    return []
  }
}

/** Get the full structural view of a file. */
async function structure(rel: string): Promise<FileStructure> {
  const abs = path.resolve(Instance.directory, rel)
  const { Filesystem } = await import("@/util/filesystem")

  const content = await Filesystem.readText(abs).catch(() => "")
  const lines = content.split("\n").length
  const symbols = await outline(rel)
  const imports = extractImports(content)
  const exports = extractExports(content)

  return { file: rel, lines, symbols, imports, exports }
}

/** Format an outline as a compact text representation. */
function format(outline: SymbolOutline[], indent = 0): string {
  const lines: string[] = []
  const pad = "  ".repeat(indent)

  for (const sym of outline) {
    const detail = sym.detail ? ` (${sym.detail})` : ""
    lines.push(`${pad}L${sym.line} ${sym.kind} ${sym.name}${detail}`)
    if (sym.children) {
      lines.push(format(sym.children, indent + 1))
    }
  }

  return lines.join("\n")
}

/** Format a full file structure as compact text. */
function formatStructure(struct: FileStructure): string {
  const sections: string[] = []

  sections.push(`## ${struct.file} (${struct.lines} lines)`)

  if (struct.imports.length > 0) {
    sections.push(`### Imports\n${struct.imports.map((i) => `  ${i}`).join("\n")}`)
  }

  if (struct.exports.length > 0) {
    sections.push(`### Exports\n${struct.exports.map((e) => `  ${e}`).join("\n")}`)
  }

  if (struct.symbols.length > 0) {
    sections.push(`### Symbols\n${format(struct.symbols)}`)
  }

  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// Lightweight extraction (regex-based, no AST)
// ---------------------------------------------------------------------------

function extractImports(content: string): string[] {
  const result: string[] = []
  const regex = /(?:import\s+.*?from\s+|require\s*\(\s*)["']([^"']+)["']/g
  let match
  while ((match = regex.exec(content)) !== null) {
    result.push(match[1])
  }
  return result
}

function extractExports(content: string): string[] {
  const result: string[] = []
  const patterns = [
    /export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g,
    /export\s*\{([^}]+)\}/g,
  ]

  for (const regex of patterns) {
    let match
    while ((match = regex.exec(content)) !== null) {
      if (match[1].includes(",")) {
        // Destructured exports: export { a, b, c }
        for (const name of match[1].split(",")) {
          const trimmed = name.trim().split(/\s+as\s+/).pop()?.trim()
          if (trimmed) result.push(trimmed)
        }
      } else {
        result.push(match[1].trim())
      }
    }
  }
  return result
}

export const StructuralRead = {
  outline,
  structure,
  format,
  formatStructure,
} as const
