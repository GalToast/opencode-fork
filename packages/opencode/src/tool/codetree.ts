import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { Filesystem } from "../util/filesystem"
import * as path from "path"
import ts from "typescript"

type CodeTreeMetadata = {
  outline: string[]
}

type NamedNode =
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.FunctionDeclaration
  | ts.MethodDeclaration

function getName(node: NamedNode) {
  const name = node.name
  if (!name) return ""
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
  return name.getText()
}

const parameters = z.object({
  filePath: z.string().describe("The absolute path to the file to analyze (supports .js, .ts, .jsx, .tsx)"),
})

export const CodeTreeTool = Tool.define("codetree", {
  description: "Extracts the structural outline of a source file (classes, methods, functions, and exports) without returning the full implementation details. Excellent for understanding large files.",
  parameters,
  async execute(params: z.infer<typeof parameters>, ctx: Tool.Context<CodeTreeMetadata>) {
    if (!params.filePath) {
      throw new Error("filePath is required")
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
      metadata: {},
    })

    const stat = Filesystem.stat(filepath)
    if (!stat) throw new Error(`File not found: ${filepath}`)

    const content = await Filesystem.readText(filepath)
    const ext = path.extname(filepath).toLowerCase()

    if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
      throw new Error("CodeTree currently only supports JavaScript and TypeScript files.")
    }

    const sourceFile = ts.createSourceFile(
      filepath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ext.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    // Note: CodeTree works best on valid TypeScript. Syntax errors may affect output.
    const outline: string[] = []

    function visit(node: ts.Node, indent = "") {
      let signature = ""
      let typeName = ""

      switch (node.kind) {
        case ts.SyntaxKind.ClassDeclaration:
          outline.push(`${indent}class ${getName(node as ts.ClassDeclaration)}`)
          break
        case ts.SyntaxKind.InterfaceDeclaration:
          outline.push(`${indent}interface ${getName(node as ts.InterfaceDeclaration)}`)
          break
        case ts.SyntaxKind.TypeAliasDeclaration:
          outline.push(`${indent}type ${getName(node as ts.TypeAliasDeclaration)}`)
          break
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.FunctionDeclaration:
          const name = getName(node as ts.MethodDeclaration | ts.FunctionDeclaration)
          signature = (node as ts.FunctionLikeDeclaration).parameters
            .map((param) => param.name.getText())
            .join(", ")
          typeName = (node as ts.FunctionLikeDeclaration).type
            ? ": " + (node as ts.FunctionLikeDeclaration).type!.getText()
            : ""
          const prefix = node.kind === ts.SyntaxKind.MethodDeclaration ? "method" : "function"
          outline.push(`${indent}${prefix} ${name}(${signature})${typeName}`)
          break
        case ts.SyntaxKind.VariableStatement:
          const varStmt = node as ts.VariableStatement
          const hasExport = varStmt.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
          if (hasExport) {
            varStmt.declarationList.declarations.forEach((declaration) => {
              if (ts.isIdentifier(declaration.name)) {
                const varType = declaration.type ? ": " + declaration.type.getText() : ""
                const varValue = declaration.initializer && ts.isArrowFunction(declaration.initializer) ? " => { ... }" : ""
                outline.push(`${indent}export ${declaration.name.text}${varType}${varValue}`)
              }
            })
          }
          break
      }

      const childIndent = [ts.SyntaxKind.ClassDeclaration, ts.SyntaxKind.InterfaceDeclaration, ts.SyntaxKind.ModuleDeclaration].includes(node.kind)
        ? indent + "  "
        : indent

      ts.forEachChild(node, (child) => visit(child, childIndent))
    }

    visit(sourceFile)

    if (outline.length === 0) {
      return {
        title: path.relative(Instance.worktree, filepath),
        output: "No structural symbols (classes, functions, interfaces, exports) found in this file.",
        metadata: { outline: [] },
      }
    }

    const output = [`<path>${filepath}</path>`, "<outline>", ...outline, "</outline>"].join("\n")

    return {
      title: path.relative(Instance.worktree, filepath),
      output,
      metadata: {
        outline,
      },
    }
  }
})
