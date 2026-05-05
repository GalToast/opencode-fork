import path from "path"
import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./terminal.txt"
import { Pty } from "@/pty"
import { PtyID } from "@/pty/schema"
import { Instance } from "@/project/instance"
import { BashArity } from "@/permission/arity"
import { Shell } from "@/shell/shell"

const actionEnum = z.enum(["start", "list", "status", "write", "resize", "stop"])

const parameters = z.object({
  action: actionEnum.describe("Managed terminal lifecycle action to perform."),
  terminal_id: z.string().optional().describe("Managed terminal session id. Required for all actions except start and list."),
  command: z.string().optional().describe("Executable or shell path to launch. Required for action=start."),
  args: z.array(z.string()).optional().describe("Arguments for the launched command."),
  cwd: z.string().optional().describe("Working directory for the managed terminal. Defaults to the current workspace directory."),
  title: z.string().optional().describe("Optional short label to make the terminal easier to recognize later."),
  env: z.record(z.string(), z.string()).optional().describe("Optional environment variables to merge into the managed terminal."),
  input: z.string().optional().describe("Text to write into a running terminal session."),
  rows: z.number().int().positive().optional().describe("Terminal row count for action=resize."),
  cols: z.number().int().positive().optional().describe("Terminal column count for action=resize."),
})

type TerminalParams = z.infer<typeof parameters>

function requireTerminalID(params: TerminalParams) {
  if (!params.terminal_id) {
    throw new Error(`terminal action="${params.action}" requires terminal_id.`)
  }
  return params.terminal_id
}

function formatCommand(command: string, args?: string[]) {
  return [command, ...(args ?? [])].filter(Boolean).join(" ").trim()
}

function formatTerminalInfo(info: Awaited<ReturnType<typeof Pty.get>>) {
  if (!info) return "Terminal not found."
  return [
    `terminal_id: ${info.id}`,
    `title: ${info.title}`,
    `status: ${info.status}`,
    `command: ${formatCommand(info.command, info.args)}`,
    `cwd: ${info.cwd}`,
    `pid: ${info.pid}`,
  ]
    .filter(Boolean)
    .join("\n")
}

async function askStartPermissions(params: TerminalParams, ctx: Tool.Context) {
  const command = params.command ?? Shell.preferred()
  const tokens = [command, ...(params.args ?? [])]
  const commandLine = formatCommand(command, params.args)
  if (!commandLine) return
  await ctx.ask({
    permission: "terminal",
    patterns: [commandLine],
    always: [`${BashArity.prefix(tokens).join(" ")} *`],
    metadata: {},
  })
}

export const TerminalTool = Tool.define("terminal", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx): Promise<{ title: string; metadata: Record<string, unknown>; output: string }> {
    if (params.action === "start") {
      await askStartPermissions(params, ctx)
      const info = await Pty.create({
        command: params.command,
        args: params.args,
        cwd: params.cwd,
        title: params.title,
        env: params.env,
      })
      return {
        title: info.title,
        metadata: {
          action: params.action,
          terminal_id: info.id,
          status: info.status,
        },
        output: [
          "Managed terminal started.",
          formatTerminalInfo(info),
          "",
          "Use action=\"write\" to send input, action=\"status\" to check status, and action=\"stop\" when you are done.",
        ].join("\n"),
      }
    }

    if (params.action === "list") {
      const sessions = await Pty.list()
      return {
        title: "Managed terminals",
        metadata: {
          action: params.action,
          count: sessions.length,
        },
        output:
          sessions.length === 0
            ? "No managed terminals are active."
            : sessions.map((info) => formatTerminalInfo(info)).join("\n\n"),
      }
    }

    const terminalID = requireTerminalID(params)

    if (params.action === "status") {
      const info = await Pty.get(terminalID as PtyID)
      if (!info) throw new Error(`Managed terminal not found: ${terminalID}`)
      return {
        title: info.title,
        metadata: {
          action: params.action,
          terminal_id: terminalID,
          status: info.status,
        },
        output: formatTerminalInfo(info),
      }
    }

    if (params.action === "write") {
      if (params.input === undefined) {
        throw new Error('terminal action="write" requires input.')
      }
      const info = await Pty.get(terminalID as PtyID)
      if (!info) throw new Error(`Managed terminal not found: ${terminalID}`)
      if (info.status !== "running") {
        throw new Error(`Managed terminal is not running: ${terminalID}`)
      }
      await Pty.write(terminalID as PtyID, params.input)
      return {
        title: info.title,
        metadata: {
          action: params.action,
          terminal_id: terminalID,
          status: info.status,
        },
        output: `Sent input to managed terminal ${terminalID}.`,
      }
    }

    if (params.action === "resize") {
      if (params.rows === undefined || params.cols === undefined) {
        throw new Error('terminal action="resize" requires rows and cols.')
      }
      const info = await Pty.get(terminalID as PtyID)
      if (!info) throw new Error(`Managed terminal not found: ${terminalID}`)
      await Pty.resize(terminalID as PtyID, params.cols, params.rows)
      return {
        title: info.title,
        metadata: {
          action: params.action,
          terminal_id: terminalID,
          status: info.status,
        },
        output: `Resized managed terminal ${terminalID} to ${params.cols}x${params.rows}.`,
      }
    }

    if (params.action === "stop") {
      const info = await Pty.get(terminalID as PtyID)
      if (!info) throw new Error(`Managed terminal not found: ${terminalID}`)
      await Pty.remove(terminalID as PtyID)
      return {
        title: info.title,
        metadata: {
          action: params.action,
          terminal_id: terminalID,
          status: "removed",
        },
        output: `Stopped managed terminal ${terminalID}.`,
      }
    }

    throw new Error(`Unsupported terminal action: ${String(params.action)}`)
  },
})
