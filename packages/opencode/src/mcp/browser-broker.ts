import path from "path"
import { Lock } from "@/util/lock"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { Installation } from "@/installation"
import { BrowserBrokerClient } from "./browser-broker-client"
import { BrokerMeta } from "./browser-broker-protocol"

type EnsureOptions = {
  directory: string
  timeout?: number
  spawn?: () => Promise<void> | void
}

function file(dir: string) {
  return path.join(dir, ".opencode", "runtime", "browser-broker.json")
}

function cmd(dir: string) {
  if (Installation.isLocal()) {
    return [process.execPath, path.join(import.meta.dir, "..", "index.ts"), "mcp", "broker", "serve", "--directory", dir]
  }
  return [process.execPath, "mcp", "broker", "serve", "--directory", dir]
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException | undefined)?.code === "EPERM"
  }
}

async function read(dir: string) {
  const raw = await Filesystem.readJson<unknown>(file(dir)).catch(() => undefined)
  const parsed = BrokerMeta.safeParse(raw)
  if (!parsed.success) return
  return parsed.data
}

async function probe(meta: BrokerMeta) {
  const client = new BrowserBrokerClient(meta)
  await client.ping()
  return client
}

async function spawn(dir: string) {
  Process.spawn(cmd(dir), {
    cwd: dir,
    env: {
      ...process.env,
      BUN_BE_BUN: "1",
      OPENCODE_RUNTIME_ROLE: "browser-broker",
      OPENCODE_BROWSER_BROKER_INTERNAL: "1",
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
}

async function wait(dir: string, timeout = 5_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const meta = await read(dir)
    if (meta && alive(meta.pid)) {
      try {
        const client = await probe(meta)
        return { meta, client, spawned: true }
      } catch {}
    }
    await Bun.sleep(75)
  }
  throw new Error(`Timed out waiting for browser broker for ${dir}`)
}

async function ensure(input: EnsureOptions) {
  using _ = await Lock.write(file(input.directory))
  const current = await read(input.directory)
  if (current && alive(current.pid)) {
    try {
      const client = await probe(current)
      return { meta: current, client, spawned: false }
    } catch {}
  }
  await (input.spawn ?? (() => spawn(input.directory)))()
  return wait(input.directory, input.timeout)
}

export const BrowserBroker = {
  file,
  read,
  ensure,
}

