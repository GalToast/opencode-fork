import { spawn as launch, type ChildProcess } from "child_process"
import { buffer } from "node:stream/consumers"

export type Stdio = "inherit" | "pipe" | "ignore"

export interface Options {
  cwd?: string
  env?: NodeJS.ProcessEnv | null
  stdin?: Stdio
  stdout?: Stdio
  stderr?: Stdio
  shell?: boolean
  abort?: AbortSignal
  kill?: NodeJS.Signals | number
  timeout?: number
}

export interface RunOptions extends Omit<Options, "stdout" | "stderr"> {
  nothrow?: boolean
}

export interface Result {
  code: number
  stdout: Buffer
  stderr: Buffer
}

export class RunFailedError extends Error {
  readonly cmd: string[]
  readonly code: number
  readonly stdout: Buffer
  readonly stderr: Buffer

  constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer) {
    const text = stderr.toString().trim()
    super(
      text
        ? `Command failed with code ${code}: ${cmd.join(" ")}\n${text}`
        : `Command failed with code ${code}: ${cmd.join(" ")}`,
    )
    this.name = "ProcessRunFailedError"
    this.cmd = [...cmd]
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
  }
}

export type Child = ChildProcess & { exited: Promise<number> }
export type { ChildProcess }
type StoppableProcess = ChildProcess & { exited?: Promise<number> }

function spawn(cmd: string[], opts: Options = {}): Child {
  if (cmd.length === 0) throw new Error("Command is required")
  opts.abort?.throwIfAborted()

  const proc = launch(cmd[0], cmd.slice(1), {
    cwd: opts.cwd,
    env: opts.env === null ? {} : opts.env ? { ...process.env, ...opts.env } : undefined,
    shell: opts.shell,
    stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
  })

  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const abort = () => {
    if (closed) return
    if (proc.exitCode !== null || proc.signalCode !== null) return
    closed = true

    proc.kill(opts.kill ?? "SIGTERM")

    const ms = opts.timeout ?? 5_000
    if (ms <= 0) return
    timer = setTimeout(() => proc.kill("SIGKILL"), ms)
  }

  const exited = new Promise<number>((resolve, reject) => {
    const done = () => {
      opts.abort?.removeEventListener("abort", abort)
      if (timer) clearTimeout(timer)
    }

    proc.once("exit", (code, signal) => {
      done()
      resolve(code ?? (signal ? 1 : 0))
    })

    proc.once("error", (error) => {
      done()
      reject(error)
    })
  })

  if (opts.abort) {
    opts.abort.addEventListener("abort", abort, { once: true })
    if (opts.abort.aborted) abort()
  }

  const child = proc as Child
  child.exited = exited
  return child
}

async function run(cmd: string[], opts: RunOptions = {}): Promise<Result> {
  const proc = spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin,
    abort: opts.abort,
    kill: opts.kill,
    timeout: opts.timeout,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")

  const [code, stdout, stderr] = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
  const out = {
    code,
    stdout,
    stderr,
  }
  if (out.code === 0 || opts.nothrow) return out
  throw new RunFailedError(cmd, out.code, out.stdout, out.stderr)
}

async function stop(
  proc: StoppableProcess,
  opts: { kill?: NodeJS.Signals | number; timeout?: number } = {},
): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return

  const sendSignal = (sig: NodeJS.Signals | number) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return
    proc.kill(sig)
  }

  let exited: Promise<number>
  if (typeof proc.exited?.then === "function") {
    exited = proc.exited
  } else {
    exited = new Promise<number>((resolve, reject) => {
      proc.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
      proc.once("error", reject)
    })
  }

  sendSignal(opts.kill ?? "SIGTERM")

  const ms = opts.timeout ?? 5_000
  if (ms > 0) {
    const timer = setTimeout(() => sendSignal("SIGKILL"), ms)
    try {
      await exited
    } finally {
      clearTimeout(timer)
    }
    return
  }

  await exited
}

async function text(cmd: string[], opts: RunOptions = {}): Promise<Result & { text: string }> {
  const result = await run(cmd, opts)
  return {
    ...result,
    text: result.stdout.toString("utf-8"),
  }
}

export const Process = {
  spawn,
  run,
  text,
  stop,
  RunFailedError,
}
