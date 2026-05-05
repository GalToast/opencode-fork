import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./shell.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { $ } from "bun"
import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"

import { BashArity } from "../permission/arity"
import { Truncate } from "./truncation"
import { Plugin } from "@/plugin"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000
const FILE_READ_TRUNCATION_MAX_LINES = 4000
const FILE_READ_TRUNCATION_MAX_BYTES = 200 * 1024

type ShellMetadata = {
  output: string
  description: string
  exit?: number | null
  truncated?: boolean
  outputPath?: string
}

export const log = Log.create({ service: "shell-tool" })

function isLikelyFileReadCommand(command: string) {
  return /\b(Get-Content|cat|type|sed|head|tail|more)\b/i.test(command)
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const treeModule = (await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })) as { default: string }
  const treePath = resolveWasm(treeModule.default)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const bashModule = (await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })) as { default: string }
  const bashPath = resolveWasm(bashModule.default)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

export const ShellTool = Tool.define("shell", async () => {
  const shell = Shell.acceptable()
  log.info("shell tool using shell", { shell })
  const parameters = z.object({
    command: z.string().describe("The command to execute"),
    timeout: z.number().describe("Optional timeout in milliseconds").optional(),
    workdir: z
      .string()
      .describe(
        `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
      )
      .optional(),
    description: z
      .string()
      .describe(
        "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
      ),
  })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx: Tool.Context<ShellMetadata>) {
      const cwd = params.workdir || Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      // Detect whether we're running PowerShell.
      // tree-sitter-bash only parses POSIX shell syntax — on PowerShell the AST
      // nodes (command, pipeline, command_substitution, etc.) will not match, so
      // all AST-based security analysis silently returns empty results.
      // When PowerShell is the active shell we skip tree-sitter entirely and
      // fall back to regex-based detection.
      const isPowershell = /pwsh|powershell/i.test(shell)

      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()
      const risks: Array<{ level: "low" | "medium" | "high"; message: string }> = []

      const sensitiveFiles = [".env", ".ssh", ".git/config", "id_rsa", "id_ed25519", "shadow", "passwd"]
      const shells = ["sh", "bash", "zsh", "fish", "pwsh", "powershell"]

      // ── PowerShell path: regex-only analysis ──────────────────────────
      if (isPowershell) {
        // Pipe-to-shell: "| pwsh", "| powershell", "| iex", "| Invoke-Expression"
        if (/\|\s*(pwsh|powershell|iex|Invoke-Expression|Invoke-Command)\b/i.test(params.command)) {
          risks.push({ level: "high", message: "Command contains a pipe to a shell or Invoke-Expression (e.g., curl | iex)." })
        }

        // Dangerous PowerShell patterns
        const psDangerousPatterns = [
          { pattern: /\b(Invoke-Expression|iex)\b/i, message: "Command uses Invoke-Expression (iex) which can execute arbitrary code." },
          { pattern: /\bInvoke-Command\b/i, message: "Command uses Invoke-Command which can execute arbitrary code remotely." },
          { pattern: /\bInvoke-RestMethod\b/i, message: "Command uses Invoke-RestMethod — if output is executed, could run arbitrary code." },
          { pattern: /\bInvoke-WebRequest\b.*\|\s*(iex|Invoke-Expression|pwsh|powershell)/i, message: "Command downloads content and pipes to a shell." },
          { pattern: /\bSet-ExecutionPolicy\b/i, message: "Command changes PowerShell execution policy, reducing script security." },
          { pattern: /\b&\s*\S+\.ps1\b/i, message: "Command invokes a .ps1 script via the call operator (&)." },
          { pattern: /^\s*\.\s*\S+\.ps1\b/i, message: "Command dot-sources a .ps1 script, which executes it in the current scope." },
          { pattern: /\bStart-Process\b/i, message: "Command uses Start-Process to launch an external process." },
          { pattern: /\bAdd-Type\b/i, message: "Command uses Add-Type which can compile and load arbitrary .NET code." },
          { pattern: /\bRegister-ScheduledTask\b/i, message: "Command registers a scheduled task for persistent execution." },
          { pattern: /\b(New-Object|Add-Type).*\b(Net\.WebClient|Net\.HttpWebRequest|System\.Net\.Http)\b/i, message: "Command uses .NET networking classes — potential download-and-execute pattern." },
        ]

        for (const { pattern, message } of psDangerousPatterns) {
          if (pattern.test(params.command)) {
            risks.push({ level: "high", message })
          }
        }

        // Extract command patterns for permission checks (regex fallback)
        patterns.add(params.command)
        always.add(params.command.split(/\s+/)[0] + " *")
      } else {
        // ── POSIX shell path: tree-sitter AST analysis ──────────────────
        const tree = await parser().then((p) => p.parse(params.command))
        if (!tree) {
          throw new Error("Failed to parse command")
        }

        // Detect pipe to shell or command substitution to shell
        for (const node of tree.rootNode.descendantsOfType(["pipeline", "subshell", "command_substitution"])) {
          if (!node) continue
          if (node.type === "pipeline") {
            const lastChild = node.lastChild
            if (lastChild?.type === "command") {
              const cmdName = lastChild.child(0)?.text
              if (cmdName && shells.includes(cmdName)) {
                risks.push({ level: "high", message: "Command contains a pipe to a shell (e.g., curl | sh)." })
              }
            }
          }
          if (node.type === "command_substitution") {
            risks.push({ level: "medium", message: "Command uses command substitution $(...). Verify the substituted command is safe." })
          }
        }

        // Detect dangerous command patterns that could enable code injection
        const dangerousPatterns = [
          { pattern: /\beval\b/, message: "Command uses 'eval' which can execute arbitrary code." },
          { pattern: /\bbase64\s+(-d|--decode)/, message: "Command decodes base64. If piped to shell, could execute arbitrary code." },
          { pattern: /\bxargs\s+(-I|-i)\s*\S*\s*(bash|sh|zsh|fish)/, message: "Command uses xargs with shell execution." },
          { pattern: /\bfind\s+.*-exec\s+(bash|sh|zsh)/, message: "Command uses find with shell exec." },
          { pattern: /\bexec\s+(bash|sh|zsh)/, message: "Command uses exec to run a shell." },
          { pattern: /\bsource\s+/, message: "Command sources a file which could execute arbitrary code." },
          { pattern: /\.\s+\S/, message: "Command sources a file (dot notation) which could execute arbitrary code." },
        ]

        for (const { pattern, message } of dangerousPatterns) {
          if (pattern.test(params.command)) {
            risks.push({ level: "high", message })
          }
        }

        for (const node of tree.rootNode.descendantsOfType("command")) {
          if (!node) continue

          // Get full command text including redirects if present
          const commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text

          const command = []
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)
            if (!child) continue
            if (
              child.type !== "command_name" &&
              child.type !== "word" &&
              child.type !== "string" &&
              child.type !== "raw_string" &&
              child.type !== "concatenation"
            ) {
              continue
            }
            command.push(child.text)
          }

          const cmdName = command[0]
          if (cmdName === "sudo") {
            risks.push({ level: "high", message: "Command uses 'sudo' for elevated privileges." })
          }

          // Check for recursive delete on sensitive files
          if (cmdName === "rm") {
            const isRecursive = command.some((arg) => arg === "-r" || arg === "-R" || arg === "-rf" || arg === "-rfv")
            if (isRecursive) {
              for (const arg of command.slice(1)) {
                if (arg.startsWith("-")) continue
                if (sensitiveFiles.some((f) => arg.includes(f))) {
                  risks.push({
                    level: "high",
                    message: `Potential recursive delete on a sensitive file or directory: ${arg}`,
                  })
                }
              }
            }
          }

          // Check for sensitive file access in any command
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-")) continue
            if (sensitiveFiles.some((f) => arg.includes(f))) {
              if (cmdName !== "rm") {
                // already handled above for rm
                risks.push({ level: "high", message: `Accessing a potentially sensitive file or directory: ${arg}` })
              }
            }
          }

          // not an exhaustive list, but covers most common cases
          if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(cmdName)) {
            for (const arg of command.slice(1)) {
              if (arg.startsWith("-") || (cmdName === "chmod" && arg.startsWith("+"))) continue
              const resolved = path.resolve(cwd, arg)
              log.info("resolved path", { arg, resolved })
              if (!Instance.containsPath(resolved)) {
                const dir = (await Filesystem.isDir(resolved)) ? resolved : path.dirname(resolved)
                directories.add(dir)
              }
            }
          }

          // cd covered by above check
          if (command.length && cmdName !== "cd") {
            patterns.add(commandText)
            always.add(BashArity.prefix(command).join(" ") + " *")
          }
        }
      }

      if (directories.size > 0) {
        const globs = Array.from(directories).map((dir) => {
          // Preserve POSIX-looking paths with /s, even on Windows
          if (dir.startsWith("/")) return `${dir.replace(/[\\/]+$/, "")}/*`
          return path.join(dir, "*")
        })
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: { risks },
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "shell",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: { risks },
        })
      }

      const shellEnv = await Plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...process.env,
          ...shellEnv.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      let output = ""

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      let lastMetadataUpdate = 0
      const METADATA_UPDATE_INTERVAL_MS = 100

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        const now = Date.now()
        if (now - lastMetadataUpdate >= METADATA_UPDATE_INTERVAL_MS) {
          lastMetadataUpdate = now
          ctx.metadata({
            metadata: {
              // truncate the metadata to avoid GIANT blobs of data (has nothing to do w/ what agent can access)
              output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
              description: params.description,
            },
          })
        }
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`shell tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      const fileReadLike = isLikelyFileReadCommand(params.command)
      const truncate = await Truncate.output(
        output,
        fileReadLike
          ? {
              maxLines: FILE_READ_TRUNCATION_MAX_LINES,
              maxBytes: FILE_READ_TRUNCATION_MAX_BYTES,
            }
          : {},
        undefined,
      )

      if (resultMetadata.length > 0) {
        truncate.content += "\n\n<shell_metadata>\n" + resultMetadata.join("\n") + "\n</shell_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output: truncate.content.length > MAX_METADATA_LENGTH ? truncate.content.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : truncate.content,
          exit: proc.exitCode ?? (timedOut ? -1 : aborted ? -2 : undefined),
          description: params.description,
          truncated: truncate.truncated,
          ...(truncate.truncated ? { outputPath: truncate.outputPath } : {}),
        },
        output: truncate.content,
      }
    },
  }
})
