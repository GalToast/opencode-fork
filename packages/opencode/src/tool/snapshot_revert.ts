import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { Filesystem } from "../util/filesystem"

// Default: keep snapshots for 7 days
const DEFAULT_SNAPSHOT_TTL_DAYS = 7
const SNAPSHOT_TTL_MS = DEFAULT_SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000

async function cleanupOldSnapshots(snapshotDir: string): Promise<number> {
  let cleaned = 0
  try {
    const entries = await fs.readdir(snapshotDir, { withFileTypes: true })
    const now = Date.now()
    
    for (const entry of entries) {
      if (!entry.name.endsWith('.bak')) continue
      
      const fullPath = path.join(snapshotDir, entry.name)
      try {
        const stat = await fs.stat(fullPath)
        const age = now - stat.mtimeMs
        
        if (age > SNAPSHOT_TTL_MS) {
          await fs.rm(fullPath, { recursive: entry.isDirectory(), force: true })
          cleaned++
        }
      } catch {
        // Ignore errors for individual files
      }
    }
  } catch {
    // Directory doesn't exist or other error
  }
  
  return cleaned
}

export const SnapshotRevertTool = Tool.define("snapshot_revert", {
  description: "Creates a snapshot of a file or directory before making risky edits, and allows reverting to that snapshot if things go wrong. Old snapshots are automatically cleaned up after 7 days.",
  parameters: z.object({
    action: z.enum(["snapshot", "revert", "list", "cleanup"]).describe("Whether to create a snapshot, revert to an existing one, list all snapshots, or force cleanup of old snapshots."),
    filePath: z.string().optional().describe("The absolute path to the file or directory (required for snapshot and revert)."),
    snapshotName: z.string().optional().describe("A unique name for the snapshot (e.g. 'before_auth_refactor'). Required for snapshot and revert."),
    maxAge: z.number().optional().describe("For cleanup action: maximum age in days. Defaults to 7.")
  }),
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, unknown> }> {
    const snapshotDir = path.join(Instance.directory, ".opencode", "runtime", "snapshots")
    await fs.mkdir(snapshotDir, { recursive: true })

    // List action
    if (params.action === "list") {
      const entries = await fs.readdir(snapshotDir, { withFileTypes: true })
      const snapshots: { name: string; created: string; size?: number }[] = []
      
      for (const entry of entries) {
        if (!entry.name.endsWith('.bak')) continue
        const fullPath = path.join(snapshotDir, entry.name)
        const stat = await fs.stat(fullPath)
        snapshots.push({
          name: entry.name.replace('.bak', ''),
          created: new Date(stat.mtimeMs).toISOString(),
          size: stat.size,
        })
      }
      
      const output = snapshots.length === 0
        ? "No snapshots found."
        : snapshots.map(s => `${s.name} (created: ${s.created})`).join("\n")
      
      return {
        title: `Snapshots (${snapshots.length})`,
        output,
        metadata: { action: "list", snapshots, count: snapshots.length }
      }
    }

    // Cleanup action
    if (params.action === "cleanup") {
      const maxAgeDays = params.maxAge ?? DEFAULT_SNAPSHOT_TTL_DAYS
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
      
      const entries = await fs.readdir(snapshotDir, { withFileTypes: true })
      const now = Date.now()
      let cleaned = 0
      
      for (const entry of entries) {
        if (!entry.name.endsWith('.bak')) continue
        const fullPath = path.join(snapshotDir, entry.name)
        const stat = await fs.stat(fullPath)
        
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.rm(fullPath, { recursive: entry.isDirectory(), force: true })
          cleaned++
        }
      }
      
      return {
        title: `Cleaned ${cleaned} old snapshots`,
        output: cleaned > 0
          ? `Removed ${cleaned} snapshot${cleaned !== 1 ? 's' : ''} older than ${maxAgeDays} day${maxAgeDays !== 1 ? 's' : ''}.`
          : `No snapshots older than ${maxAgeDays} day${maxAgeDays !== 1 ? 's' : ''} found.`,
        metadata: { action: "cleanup", cleaned, maxAgeDays }
      }
    }

    // Snapshot and revert require filePath
    if (!params.filePath) throw new Error("filePath is required for snapshot and revert actions")
    if (!params.snapshotName) throw new Error("snapshotName is required for snapshot and revert actions")

    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }

    await assertExternalDirectory(ctx, filepath)

    const snapshotDest = path.join(snapshotDir, `${params.snapshotName}.bak`)

    // Snapshot action
    if (params.action === "snapshot") {
      await ctx.ask({
        permission: "read",
        patterns: [filepath],
        always: ["*"],
        metadata: { action: "snapshot", filepath, name: params.snapshotName },
      })

      const stat = Filesystem.stat(filepath)
      if (!stat) throw new Error(`Cannot snapshot: ${filepath} not found.`)

      if (stat.isDirectory()) {
        await fs.cp(filepath, snapshotDest, { recursive: true, force: true })
      } else {
        await fs.copyFile(filepath, snapshotDest)
      }

      // Auto-cleanup old snapshots after creating a new one
      const cleaned = await cleanupOldSnapshots(snapshotDir)

      return {
        title: `Snapshot Created: ${params.snapshotName}`,
        output: `Successfully saved snapshot of ${path.relative(Instance.worktree, filepath)} to ${params.snapshotName}${cleaned > 0 ? `\n\n(Cleaned ${cleaned} old snapshot${cleaned !== 1 ? 's' : ''} older than ${DEFAULT_SNAPSHOT_TTL_DAYS} days)` : ''}`,
        metadata: { action: "snapshot", name: params.snapshotName, cleanedOld: cleaned }
      }
    }

    // Revert action
    if (params.action === "revert") {
      await ctx.ask({
        permission: "edit",
        patterns: [filepath],
        always: ["*"],
        metadata: { action: "revert", filepath, name: params.snapshotName },
      })

      const snapStat = Filesystem.stat(snapshotDest)
      if (!snapStat) throw new Error(`Cannot revert: Snapshot '${params.snapshotName}' not found.`)

      // Remove current path before reverting to ensure clean state
      await fs.rm(filepath, { recursive: true, force: true })

      if (snapStat.isDirectory()) {
        await fs.cp(snapshotDest, filepath, { recursive: true, force: true })
      } else {
        await fs.copyFile(snapshotDest, filepath)
      }

      return {
        title: `Reverted to Snapshot: ${params.snapshotName}`,
        output: `Successfully reverted ${path.relative(Instance.worktree, filepath)} to state from snapshot '${params.snapshotName}'`,
        metadata: { action: "revert", name: params.snapshotName }
      }
    }

    throw new Error(`Invalid action: ${String(params.action)}`)
  }
})
