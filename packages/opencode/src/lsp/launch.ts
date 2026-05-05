import type { ChildProcessWithoutNullStreams } from "child_process"
import { Process } from "../util/process"
import type { Options as ProcessOptions, Child as ProcessChild } from "../util/process"

type Child = ProcessChild & ChildProcessWithoutNullStreams

export function spawn(cmd: string, args: string[], opts?: ProcessOptions): Child
export function spawn(cmd: string, opts?: ProcessOptions): Child
export function spawn(cmd: string, argsOrOpts?: string[] | ProcessOptions, opts?: ProcessOptions) {
  const args = Array.isArray(argsOrOpts) ? [...argsOrOpts] : []
  const cfg = Array.isArray(argsOrOpts) ? opts : argsOrOpts
  const proc = Process.spawn([cmd, ...args], {
    ...(cfg ?? {}),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  }) as Child

  if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")

  return proc
}
