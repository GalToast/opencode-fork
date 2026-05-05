import { Tool } from "./tool"
import z from "zod"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { ulid } from "ulid"

const log = Log.create({ service: "synthesize" })

function ephemeralToolsDir() {
  return path.join(Instance.worktree || Instance.directory, ".opencode", "tools")
}

export const SynthesizeTool = Tool.define("synthesize_tool", {
  description: "Synthesize an ephemeral TypeScript tool on the fly. This tool will be instantly available in your toolset until the session ends. Use this for complex data transformations or custom tasks that your existing tools can't handle. The code must export a default object matching the ToolDefinition interface.",
  parameters: z.object({
    name: z.string().describe("Name of the tool (must be snake_case, e.g. parse_pdf_table)"),
    description: z.string().describe("A clear description of what the tool does, so you know how to use it later"),
    code: z.string().describe(`The full TypeScript source code for the tool. 
Example structure:
import { type ToolDefinition } from "@opencode-ai/plugin";
import z from "zod";

export default {
  description: "...",
  args: {
    input: z.string()
  },
  async execute(args, ctx) {
    return "done: " + args.input;
  }
} satisfies ToolDefinition;`),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "synthesize_tool",
      patterns: ["ephemeral_*.ts"],
      always: ["ephemeral_*.ts"],
      metadata: {},
    })

    const ephemeralDir = ephemeralToolsDir()
    await fs.mkdir(ephemeralDir, { recursive: true })

    const safeName = params.name.toLowerCase().replace(/[^a-z0-9_]/g, "")
    const fileName = `ephemeral_${safeName}_${ulid()}.ts`
    const filePath = path.join(ephemeralDir, fileName)

await fs.writeFile(filePath, params.code, "utf8")

    log.info(`Ephemeral tool created: ${filePath}`)

    return {
      title: `Synthesized Tool: ${safeName}`,
      output: `Successfully synthesized tool '${safeName}'. It is now saved at ${filePath} and will be available in your next turn.`,
      metadata: { filePath, name: safeName },
    }
  },
})

export async function cleanupEphemeralTools() {
  const ephemeralDir = ephemeralToolsDir()
  try {
    const files = await fs.readdir(ephemeralDir)
    const ephemeralFiles = files.filter(f => f.startsWith("ephemeral_") && f.endsWith(".ts"))
    for (const file of ephemeralFiles) {
      await fs.unlink(path.join(ephemeralDir, file))
      log.info(`Cleaned up ephemeral tool: ${file}`)
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      log.warn("Failed to cleanup ephemeral tools", { error })
    }
  }
}

export function sanitizeEphemeralToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "")
}

export async function createEphemeralToolFile(name: string, code: string): Promise<{ safeName: string; filePath: string }> {
  const ephemeralDir = ephemeralToolsDir()
  await fs.mkdir(ephemeralDir, { recursive: true })
  const safeName = sanitizeEphemeralToolName(name)
  const fileName = `ephemeral_${safeName}_${ulid()}.ts`
  const filePath = path.join(ephemeralDir, fileName)
  await fs.writeFile(filePath, code, "utf8")
  log.info(`Ephemeral tool created: ${filePath}`)
  return { safeName, filePath }
}

export async function findEphemeralToolFiles(name: string): Promise<{ safeName: string; filePath: string }[]> {
  const ephemeralDir = ephemeralToolsDir()
  try {
    const files = await fs.readdir(ephemeralDir)
    const safeName = sanitizeEphemeralToolName(name)
    return files
      .filter(f => f.startsWith("ephemeral_") && f.endsWith(".ts") && f.includes(safeName))
      .map(f => ({ safeName, filePath: path.join(ephemeralDir, f) }))
  } catch {
    return []
  }
}

export async function listEphemeralToolFiles(): Promise<{ name: string; filePath: string }[]> {
  const ephemeralDir = ephemeralToolsDir()
  try {
    const files = await fs.readdir(ephemeralDir)
    return files
      .filter(f => f.startsWith("ephemeral_") && f.endsWith(".ts"))
      .map(f => ({
        name: f.replace(/^ephemeral_/, "").replace(/_[a-z0-9]+\.ts$/, ""),
        filePath: path.join(ephemeralDir, f),
      }))
  } catch {
    return []
  }
}

export async function replaceEphemeralToolFile(name: string, code: string): Promise<{ safeName: string; filePath: string } | null> {
  const ephemeralDir = ephemeralToolsDir()
  try {
    const files = await fs.readdir(ephemeralDir)
    const safeName = sanitizeEphemeralToolName(name)
    const matching = files.filter(f => f.startsWith("ephemeral_") && f.endsWith(".ts") && f.includes(safeName))
    if (matching.length === 0) return null
    // Delete old files and create new one
    for (const f of matching) {
      await fs.unlink(path.join(ephemeralDir, f))
    }
    const fileName = `ephemeral_${safeName}_${ulid()}.ts`
    const filePath = path.join(ephemeralDir, fileName)
    await fs.writeFile(filePath, code, "utf8")
    log.info(`Ephemeral tool replaced: ${filePath}`)
    return { safeName, filePath }
  } catch {
    return null
  }
}

export async function deleteEphemeralToolFiles(name: string): Promise<string[]> {
  const ephemeralDir = ephemeralToolsDir()
  try {
    const files = await fs.readdir(ephemeralDir)
    const safeName = sanitizeEphemeralToolName(name)
    const matching = files.filter(f => f.startsWith("ephemeral_") && f.endsWith(".ts") && f.includes(safeName))
    for (const f of matching) {
      await fs.unlink(path.join(ephemeralDir, f))
    }
    return matching
  } catch {
    return []
  }
}
