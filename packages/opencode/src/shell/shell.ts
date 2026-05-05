import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { spawn, type ChildProcess } from "child_process"

const SIGKILL_TIMEOUT_MS = 200
const WINDOWS_NATIVE_SHELLS = [
  "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  "C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe",
]

async function killTree(proc: ChildProcess, opts?: { exited?: () => boolean }): Promise<void> {
  const pid = proc.pid
  if (!pid || opts?.exited?.()) return

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" })
      killer.once("exit", () => resolve())
      killer.once("error", () => resolve())
    })
    return
  }

  try {
    process.kill(-pid, "SIGTERM")
    await Bun.sleep(SIGKILL_TIMEOUT_MS)
    if (!opts?.exited?.()) {
      process.kill(-pid, "SIGKILL")
    }
  } catch (_e) {
    proc.kill("SIGTERM")
    await Bun.sleep(SIGKILL_TIMEOUT_MS)
    if (!opts?.exited?.()) {
      proc.kill("SIGKILL")
    }
  }
}

const BLACKLIST = new Set(["fish", "nu"])

function shellPathExists(candidate?: string) {
  return !!candidate && !!Filesystem.stat(candidate)?.size
}

function firstInstalled(candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue
    const resolved = Bun.which(candidate) || candidate
    if (shellPathExists(resolved)) return resolved
  }
}

function name(shell: string) {
  return (process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)).toLowerCase()
}

function resolveShellCandidate(candidate?: string) {
  if (!candidate) return
  return firstInstalled([candidate])
}

function resolveEnvironmentShell() {
  const shell = process.env.SHELL
  if (!shell) return
  const resolved = resolveShellCandidate(shell)
  if (!resolved) return
  return resolved
}

function fallbackForPlatform(platform = process.platform) {
  if (platform === "win32") {
    if (Flag.OPENCODE_GIT_BASH_PATH) return Flag.OPENCODE_GIT_BASH_PATH

    const pwsh = firstInstalled(["pwsh", "pwsh.exe", ...WINDOWS_NATIVE_SHELLS])
    if (pwsh) return pwsh

    const powershell = firstInstalled([
      "powershell",
      "powershell.exe",
      process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : undefined,
    ])
    if (powershell) return powershell

    return process.env.COMSPEC || "cmd.exe"
  }
  if (platform === "darwin") return "/bin/zsh"
  const bash = Bun.which("bash")
  if (bash) return bash
  return "/bin/sh"
}

const preferred = lazy(() => {
  const s = resolveEnvironmentShell()
  if (s) return s
  return fallbackForPlatform()
})

const acceptable = lazy(() => {
  const s = resolveEnvironmentShell()
  if (s && !BLACKLIST.has(name(s))) return s
  return fallbackForPlatform()
})

export const Shell = {
  killTree,
  name,
  fallbackForPlatform,
  preferred,
  acceptable,
}
