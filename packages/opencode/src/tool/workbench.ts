import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { NodeReplTool } from "./node_repl"
import {
  createEphemeralToolFile,
  deleteEphemeralToolFiles,
  findEphemeralToolFiles,
  listEphemeralToolFiles,
  replaceEphemeralToolFile,
  sanitizeEphemeralToolName,
} from "./synthesize"

type WorkbenchMetadata = {
  action: string
  name?: string
  filePath?: string
  fileCount?: number
  deletedCount?: number
  runtime?: boolean
}

export const WorkbenchTool = Tool.define("workbench", {
  description: [
    "Session workbench for experimentation and reusable helper creation.",
    "Use it to execute JavaScript in the persistent runtime, create or replace ephemeral tools for this session, and inspect or delete helpers you previously created.",
    "Prefer `action=exec` for experimentation, then `action=create` or `action=replace` when you want to promote useful code into a reusable session tool.",
  ].join(" "),
  parameters: z.object({
    action: z
      .enum(["exec", "reset_runtime", "list", "inspect", "create", "replace", "delete"])
      .describe("How to use the session workbench."),
    name: z.string().optional().describe("Helper name for create, replace, inspect, or delete."),
    code: z.string().optional().describe("JavaScript for exec, or full TypeScript tool source for create/replace."),
    timeout_ms: z.number().int().min(1).max(120_000).optional().describe("Execution timeout for exec."),
  }),
  async execute(args, ctx): Promise<{ title: string; metadata: WorkbenchMetadata; output: string }> {
    if (args.action === "exec") {
      if (!args.code?.trim()) throw new Error('workbench action="exec" requires code')
      const repl = await NodeReplTool.init()
      const result = await repl.execute({ code: args.code, timeout_ms: args.timeout_ms }, ctx)
      return {
        title: "Workbench Runtime",
        metadata: {
          action: "exec",
          runtime: true,
        },
        output: result.output,
      }
    }

    if (args.action === "reset_runtime") {
      const repl = await NodeReplTool.init()
      const result = await repl.execute({ reset: true }, ctx)
      return {
        title: "Workbench Runtime Reset",
        metadata: {
          action: "reset_runtime",
          runtime: true,
        },
        output: result.output,
      }
    }

    await ctx.ask({
      permission: "synthesize_tool",
      patterns: ["ephemeral_*.ts"],
      always: ["ephemeral_*.ts"],
      metadata: {},
    })

    if (args.action === "list") {
      const files = await listEphemeralToolFiles()
      const grouped = new Map<string, number>()
      for (const item of files) {
        grouped.set(item.name, (grouped.get(item.name) ?? 0) + 1)
      }
      const lines = [
        "Session helpers:",
        ...(files.length === 0
          ? ["- none"]
          : [...grouped.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, count]) => `- ${name}${count > 1 ? ` (${count} versions)` : ""}`)),
      ]
      return {
        title: "Workbench Helpers",
        metadata: {
          action: "list",
          fileCount: files.length,
        },
        output: lines.join("\n"),
      }
    }

    if (!args.name?.trim()) {
      throw new Error(`workbench action="${args.action}" requires name`)
    }

    if (args.action === "inspect") {
      const matches = await findEphemeralToolFiles(args.name)
      const target = matches[0]
      if (!target) throw new Error(`No synthesized tool found with name "${sanitizeEphemeralToolName(args.name)}"`)
      const content = await fs.readFile(target.filePath, "utf8")
      return {
        title: `Workbench Helper: ${target.safeName}`,
        metadata: {
          action: "inspect",
          name: target.safeName,
          filePath: target.filePath,
          fileCount: matches.length,
        },
        output: [`name: ${target.safeName}`, `path: ${target.filePath}`, "", content].join("\n"),
      }
    }

    if (args.action === "create") {
      if (!args.code?.trim()) throw new Error('workbench action="create" requires code')
      const created = await createEphemeralToolFile(args.name, args.code)
      return {
        title: `Workbench Helper Created: ${created.safeName}`,
        metadata: {
          action: "create",
          name: created.safeName,
          filePath: created.filePath,
          fileCount: 1,
        },
        output: `Created helper '${created.safeName}' at ${created.filePath}. It will be available on your next turn.`,
      }
    }

    if (args.action === "replace") {
      if (!args.code?.trim()) throw new Error('workbench action="replace" requires code')
      const replaced = await replaceEphemeralToolFile(args.name, args.code)
      if (!replaced) throw new Error(`No synthesized tool found with name "${sanitizeEphemeralToolName(args.name)}"`)
      return {
        title: `Workbench Helper Replaced: ${replaced.safeName}`,
        metadata: {
          action: "replace",
          name: replaced.safeName,
          filePath: replaced.filePath,
          fileCount: 1,
        },
        output: `Replaced helper '${replaced.safeName}' at ${replaced.filePath}.`,
      }
    }

    const deleted = await deleteEphemeralToolFiles(args.name)
    return {
      title: `Workbench Helper Deleted: ${sanitizeEphemeralToolName(args.name)}`,
      metadata: {
        action: "delete",
        name: sanitizeEphemeralToolName(args.name),
        deletedCount: deleted.length,
      },
      output:
        deleted.length === 0
          ? `No synthesized helper named '${sanitizeEphemeralToolName(args.name)}' was found.`
          : `Deleted ${deleted.length} helper file(s) for '${sanitizeEphemeralToolName(args.name)}'.`,
    }
  },
})
