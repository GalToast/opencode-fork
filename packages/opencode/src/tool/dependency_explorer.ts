import z from "zod"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import * as path from "path"
import { fileURLToPath } from "url"
import { Filesystem } from "../util/filesystem"

type SymbolLocation = {
  uri: string
  range: LSP.Range
}

type WorkspaceSymbolResult = {
  name: string
  kind: number
  location: SymbolLocation
  filePath: string
  relativePath: string
}

type DocumentSymbolResult = {
  name: string
  kind: number
  detail?: string
  range?: LSP.Range
  line: number
}

type ReferenceResult = {
  uri: string
  filePath: string
  relativePath: string
  range: LSP.Range
}

type DefinitionResult = {
  uri?: string
  filePath: string
  relativePath: string
  range?: LSP.Range
  targetUri?: string
  targetRange?: LSP.Range
}

type Action = "workspace_symbol" | "document_symbol" | "references" | "definition"

type DependencyExplorerMetadata = {
  action: Action
  results: WorkspaceSymbolResult[] | DocumentSymbolResult[] | ReferenceResult[] | DefinitionResult[]
  count: number
}

type DefinitionLocation = {
  uri?: string
  range?: LSP.Range
  targetUri?: string
  targetRange?: LSP.Range
}

const parameters = z.object({
  action: z.enum(["references", "definition", "workspace_symbol", "document_symbol"]).describe("The LSP action to perform."),
  filePath: z.string().optional().describe("The absolute path to the file (required for references, definition, and document_symbol)."),
  line: z.number().optional().describe("The 0-indexed line number (required for references and definition)."),
  character: z.number().optional().describe("The 0-indexed character position (required for references and definition)."),
  query: z.string().optional().describe("The string query (required for workspace_symbol)."),
})

function isRange(value: unknown): value is LSP.Range {
  return LSP.Range.safeParse(value).success
}

function isReference(value: unknown): value is { uri: string; range: LSP.Range } {
  if (!value || typeof value !== "object") return false
  if (!("uri" in value) || typeof value.uri !== "string") return false
  if (!("range" in value) || !isRange(value.range)) return false
  return true
}

function isDefinition(value: unknown): value is DefinitionLocation {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  const uri = typeof item.uri === "string" ? item.uri : undefined
  const targetUri = typeof item.targetUri === "string" ? item.targetUri : undefined
  const range = isRange(item.range) ? item.range : undefined
  const targetRange = isRange(item.targetRange) ? item.targetRange : undefined
  return Boolean(uri || targetUri || range || targetRange)
}

export const DependencyExplorerTool = Tool.define("dependency_explorer", {
  description: "Queries the Language Server Protocol (LSP) for cross-file dependencies. Useful for finding all references to a function, or finding the definition of a symbol.",
  parameters,
  async execute(
    params: z.infer<typeof parameters>,
    ctx: Tool.Context<DependencyExplorerMetadata>,
  ): Promise<{ title: string; output: string; metadata: DependencyExplorerMetadata }> {
    if (params.action === "workspace_symbol") {
      if (!params.query) throw new Error("query is required for workspace_symbol")

      await ctx.ask({
        permission: "read",
        patterns: ["*"],
        always: ["*"],
        metadata: { action: params.action, query: params.query },
      })

      const symbols = await LSP.workspaceSymbol(params.query)
      if (!symbols || symbols.length === 0) {
        return {
          title: `Workspace Symbol: ${params.query}`,
          output: "No symbols found.",
          metadata: { action: "workspace_symbol", results: [], count: 0 },
        }
      }

      const results: WorkspaceSymbolResult[] = []
      for (const symbol of symbols) {
        try {
          const filePath = fileURLToPath(symbol.location.uri)
          results.push({
            name: symbol.name,
            kind: symbol.kind,
            location: symbol.location,
            filePath,
            relativePath: path.relative(Instance.worktree, filePath),
          })
        } catch {
          // Skip symbols with invalid URIs.
        }
      }

      const formatted = results.map((result) => `[${result.name}] in ${result.relativePath} (Line: ${result.location.range.start.line})`)

      return {
        title: `Workspace Symbol: ${params.query}`,
        output: formatted.join("\n"),
        metadata: { action: "workspace_symbol", results, count: results.length },
      }
    }

    if (!params.filePath) {
      throw new Error("filePath is required for the requested action.")
    }

    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }

    await assertExternalDirectory(ctx, filepath, { kind: "file" })

    await ctx.ask({
      permission: "read",
      patterns: [filepath],
      always: ["*"],
      metadata: { action: params.action, filepath },
    })

    if (!Filesystem.stat(filepath)) {
      throw new Error(`File not found: ${filepath}`)
    }

    if (params.action === "document_symbol") {
      await LSP.touchFile(filepath, false)
      const symbols = await LSP.documentSymbol("file://" + filepath.replace(/\\/g, "/"))
      if (!symbols || symbols.length === 0) {
        return {
          title: `Document Symbols: ${path.relative(Instance.worktree, filepath)}`,
          output: "No symbols found in this document.",
          metadata: { action: "document_symbol", results: [], count: 0 },
        }
      }

      const results: DocumentSymbolResult[] = symbols.map((symbol) => {
        const range = "range" in symbol ? symbol.range : symbol.location?.range
        const detail = "detail" in symbol ? symbol.detail : undefined
        return {
          name: symbol.name,
          kind: symbol.kind,
          detail,
          range,
          line: range?.start.line ?? 0,
        }
      })

      const formatted = results.map((result) => `[${result.name}] (Line: ${result.line})`)
      return {
        title: `Document Symbols: ${path.relative(Instance.worktree, filepath)}`,
        output: formatted.join("\n"),
        metadata: { action: "document_symbol", results, count: results.length },
      }
    }

    if (params.line === undefined || params.character === undefined) {
      throw new Error("line and character are required for references and definition.")
    }

    await LSP.touchFile(filepath, false)

    if (params.action === "references") {
      const refs = await LSP.references({ file: filepath, line: params.line, character: params.character })
      if (!refs || refs.length === 0) {
        return {
          title: `References at ${path.relative(Instance.worktree, filepath)}:${params.line}:${params.character}`,
          output: "No references found.",
          metadata: { action: "references", results: [], count: 0 },
        }
      }

      const results: ReferenceResult[] = []
      for (const ref of refs) {
        if (!isReference(ref)) continue
        try {
          const refPath = fileURLToPath(ref.uri)
          results.push({
            uri: ref.uri,
            filePath: refPath,
            relativePath: path.relative(Instance.worktree, refPath),
            range: ref.range,
          })
        } catch {
          // Skip references with invalid URIs.
        }
      }

      const formatted = results.map(
        (result) => `${result.relativePath} (Line: ${result.range.start.line}, Char: ${result.range.start.character})`,
      )

      return {
        title: `References (${results.length})`,
        output: formatted.join("\n"),
        metadata: { action: "references", results, count: results.length },
      }
    }

    if (params.action === "definition") {
      const defs = await LSP.definition({ file: filepath, line: params.line, character: params.character })
      if (!defs || defs.length === 0) {
        return {
          title: `Definition at ${path.relative(Instance.worktree, filepath)}:${params.line}:${params.character}`,
          output: "No definitions found.",
          metadata: { action: "definition", results: [], count: 0 },
        }
      }

      const results: DefinitionResult[] = []
      for (const def of defs) {
        if (!isDefinition(def)) continue
        try {
          const uri = def.uri ?? def.targetUri
          if (!uri) continue
          const defPath = fileURLToPath(uri)
          results.push({
            uri: def.uri,
            filePath: defPath,
            relativePath: path.relative(Instance.worktree, defPath),
            range: def.range,
            targetUri: def.targetUri,
            targetRange: def.targetRange,
          })
        } catch {
          // Skip definitions with invalid URIs.
        }
      }

      const formatted = results.map((result) => {
        const range = result.range || result.targetRange
        const line = range?.start.line ?? "?"
        const character = range?.start.character ?? "?"
        return `${result.relativePath} (Line: ${line}, Char: ${character})`
      })

      return {
        title: `Definition (${results.length})`,
        output: formatted.join("\n"),
        metadata: { action: "definition", results, count: results.length },
      }
    }

    throw new Error("Unsupported action")
  },
})
