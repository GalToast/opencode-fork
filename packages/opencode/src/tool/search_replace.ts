import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { Glob } from "../util/glob"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"
import { FileTime } from "../file/time"
import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"

export const SearchReplaceTool = Tool.define("search_replace", {
  description: "Applies a regular expression search and replace across multiple files matching a glob pattern. Useful for broad refactoring, renaming variables, or updating API calls. Use dryRun=true to preview changes without applying them.",
  parameters: z.object({
    pattern: z.string().describe("The regular expression pattern to search for (e.g. 'function foo\\\\(')."),
    replacement: z.string().describe("The replacement string. You can use capture groups like $1, $2, etc."),
    glob: z.string().describe("The glob pattern to filter files (e.g. 'src/**/*.ts')."),
    flags: z.string().optional().describe("Regex flags to use. Defaults to 'gm' (global, multiline)."),
    dryRun: z.boolean().optional().describe("If true, preview changes without applying them. Defaults to false.")
  }),
  async execute(params, ctx) {
    if (!params.pattern) throw new Error("pattern is required")
    if (params.replacement === undefined) throw new Error("replacement is required")
    if (!params.glob) throw new Error("glob is required")

    const dryRun = params.dryRun ?? false
    const flags = params.flags ?? "gm"
    let regex: RegExp
    try {
      regex = new RegExp(params.pattern, flags)
	    } catch (e) {
	      throw new Error(`Invalid regular expression: ${String(e)}`)
    }

    const matches = await Glob.scan(params.glob, {
      cwd: Instance.directory,
      absolute: true,
    })

    if (matches.length === 0) {
      return {
        title: "Search & Replace",
        output: "No files matched the provided glob pattern.",
        metadata: { filesChanged: 0, changedFiles: [], dryRun, matchCount: 0 }
      }
    }

    if (!dryRun) {
      await ctx.ask({
        permission: "edit",
        patterns: [params.glob],
        always: ["*"],
        metadata: {
          pattern: params.pattern,
          replacement: params.replacement,
          glob: params.glob,
        },
      })
    }

    let filesChangedCount = 0
    let matchCount = 0
    const changedFiles: string[] = []
    const preview: string[] = []

    for (const filepath of matches) {
      await assertExternalDirectory(ctx, filepath, { kind: "file" })
      const stat = Filesystem.stat(filepath)
      if (!stat || stat.isDirectory()) continue

      const content = await Filesystem.readText(filepath)
      regex.lastIndex = 0 // Reset before quick check
      if (!regex.test(content)) continue

      regex.lastIndex = 0 // Reset for match counting
	      const fileMatches = content.match(regex)
	      const fileMatchCount = fileMatches ? fileMatches.length : 0
	      matchCount += fileMatchCount

      regex.lastIndex = 0
      const newContent = content.replace(regex, params.replacement)

      if (content !== newContent) {
        const relativePath = path.relative(Instance.worktree, filepath)
        
        if (dryRun) {
          preview.push(`--- ${relativePath} (${fileMatchCount} match${fileMatchCount !== 1 ? 'es' : ''}) ---`)
          // Show a sample of the changes (first 3 matches per file)
          regex.lastIndex = 0
          let sampleCount = 0
          const sampleOutput: string[] = []
          content.split('\n').forEach((line, lineNum) => {
            regex.lastIndex = 0
            if (regex.test(line) && sampleCount < 3) {
              const newLine = line.replace(regex, params.replacement)
              sampleOutput.push(`  L${lineNum + 1}: - ${line.trim().substring(0, 80)}`)
              sampleOutput.push(`         + ${newLine.trim().substring(0, 80)}`)
              sampleCount++
            }
          })
          preview.push(...sampleOutput)
          if (fileMatchCount > 3) {
            preview.push(`  ... and ${fileMatchCount - 3} more match${fileMatchCount - 3 !== 1 ? 'es' : ''}`)
          }
        }
        
        filesChangedCount++
        changedFiles.push(relativePath)

        if (!dryRun) {
          await FileTime.withLock(filepath, async () => {
            await Filesystem.write(filepath, newContent)
            void Bus.publish(File.Event.Edited, { file: filepath })
            void Bus.publish(FileWatcher.Event.Updated, { file: filepath, event: "change" })
            FileTime.read(ctx.sessionID, filepath)
          })
        }
      }
    }

    let output: string
    if (dryRun) {
      output = preview.length > 0
        ? [`[DRY RUN] Would update ${filesChangedCount} file${filesChangedCount !== 1 ? 's' : ''} with ${matchCount} total match${matchCount !== 1 ? 'es' : ''}:`, '', ...preview].join("\n")
        : "No matches found in the scanned files."
    } else {
      output = filesChangedCount > 0
        ? `Successfully updated ${filesChangedCount} file${filesChangedCount !== 1 ? 's' : ''}:\n${changedFiles.join("\n")}`
        : "No matches found in the scanned files."
    }

    return {
      title: dryRun ? `Preview: ${filesChangedCount} files would change` : `Replaced in ${filesChangedCount} files`,
      output,
      metadata: { filesChanged: filesChangedCount, changedFiles, dryRun, matchCount }
    }
  }
})
