import { existsSync } from "fs"
import path from "path"

export type LaunchTarget = {
  sourceRoot: string
  entryPath: string
  delegated: boolean
}

function nextRuntimeId() {
  const random = Math.floor(Math.random() * 0x100000000)
  return `${Date.now().toString(36)}-${random.toString(36)}`
}

function inferRuntimeRole(input: string[] = process.argv.slice(2)) {
  const positional = input.filter((arg) => arg && !arg.startsWith("-"))
  const command = positional[0]
  if (!command) return "tui_supervisor"
  if (command === "tui") return "tui_supervisor"
  return `cli_${command}`
}

function describeRuntimeRole(role: string) {
  return role.trim() || inferRuntimeRole()
}

export function localSourceRoot() {
  return path.resolve(import.meta.dir, "..", "..", "..")
}

export function workerEntry(root: string) {
  return path.join(root, "packages", "opencode", "src", "index.ts")
}

export function resolveLaunchTarget(input: {
  localRoot?: string
  requestedRoot?: string
  active?: boolean
} = {}): Promise<LaunchTarget> {
  const localRoot = input.localRoot || localSourceRoot()
  return Promise.resolve({
    sourceRoot: localRoot,
    entryPath: workerEntry(localRoot),
    delegated: false,
  })
}

export function prepareLaunchContext(input: {
  callerCwd?: string
  cliArgs?: string[]
  localRoot?: string
} = {}) {
  const callerCwd = input.callerCwd ?? process.env.OPENCODE_CALLER_CWD
  if (callerCwd && existsSync(callerCwd)) {
    process.chdir(callerCwd)
  }

  const localRoot = input.localRoot ?? localSourceRoot()
  process.env.OPENCODE_SUPERVISOR_ROOT = process.env.OPENCODE_SUPERVISOR_ROOT || localRoot
  process.env.OPENCODE_RUNTIME_ID = process.env.OPENCODE_RUNTIME_ID || nextRuntimeId()
  process.env.OPENCODE_RUNTIME_ROLE = describeRuntimeRole(process.env.OPENCODE_RUNTIME_ROLE || inferRuntimeRole(input.cliArgs))
  process.env.OPENCODE_RUNTIME_PID = String(process.pid)
  process.env.OPENCODE_RUNTIME_PPID = process.env.OPENCODE_RUNTIME_PPID || String(process.ppid)
  process.env.OPENCODE_RUNTIME_PARENT_ROLE = process.env.OPENCODE_RUNTIME_PARENT_ROLE || "launcher_supervisor"

  return {
    localRoot,
  }
}

async function launch() {
  prepareLaunchContext()
  process.env.OPENCODE_RUNTIME_ROLE = process.env.OPENCODE_RUNTIME_ROLE || "supervisor_stable"
  process.env.OPENCODE_DEBUG_PROMPT_TIMING = process.env.OPENCODE_DEBUG_PROMPT_TIMING || "1"
  process.env.OPENCODE_DEBUG_PROMPT_PROFILE = process.env.OPENCODE_DEBUG_PROMPT_PROFILE || "1"
  process.env.OPENCODE_DEBUG_SESSION_RETENTION = process.env.OPENCODE_DEBUG_SESSION_RETENTION || "1"
  await import("./index.ts")
}

if (import.meta.main) {
  await launch()
}
