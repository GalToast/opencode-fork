import path from "path"
import { mkdir, readFile, rm, writeFile } from "fs/promises"
import { z } from "zod"
import { Lock } from "@/util/lock"
import { Global } from "@/global"

const RuntimeRegistryEntrySchema = z.object({
  runtimeID: z.string(),
  pid: z.number().int().positive(),
  ppid: z.number().int().nonnegative(),
  role: z.string(),
  startedAt: z.number(),
  lastHeartbeatAt: z.number(),
  directory: z.string().optional(),
})

const RuntimeRegistrySnapshot = z.object({
  version: z.literal(1),
  entries: z.array(RuntimeRegistryEntrySchema),
})

type RuntimeRegistryEntry = z.infer<typeof RuntimeRegistryEntrySchema>

function registryPath() {
  return process.env.OPENCODE_RUNTIME_REGISTRY || path.join(Global.Path.state, "tui-runtime-registry.json")
}

async function readSnapshot() {
  const target = registryPath()
  using _ = await Lock.read(target)
  const raw = await readFile(target, "utf8").catch(() => undefined)
  if (!raw) return { version: 1 as const, entries: [] as RuntimeRegistryEntry[] }
  const parsed = RuntimeRegistrySnapshot.safeParse(JSON.parse(raw))
  if (!parsed.success) return { version: 1 as const, entries: [] as RuntimeRegistryEntry[] }
  return parsed.data
}

async function writeSnapshot(entries: RuntimeRegistryEntry[]) {
  const target = registryPath()
  await mkdir(path.dirname(target), { recursive: true })
  using _ = await Lock.write(target)
  await writeFile(target, JSON.stringify({ version: 1, entries }, null, 2))
}

function runtimeID() {
  return process.env.OPENCODE_RUNTIME_ID || "unknown"
}

function runtimeRole() {
  return process.env.OPENCODE_RUNTIME_ROLE || "unknown"
}

export async function upsertRuntimeRegistryEntry(input: { directory?: string; pid?: number; ppid?: number }) {
  const id = runtimeID()
  const now = Date.now()
  const next: RuntimeRegistryEntry = {
    runtimeID: id,
    pid: input.pid ?? process.pid,
    ppid: input.ppid ?? process.ppid,
    role: runtimeRole(),
    startedAt: now,
    lastHeartbeatAt: now,
    ...(input.directory ? { directory: input.directory } : {}),
  }
  const snapshot = await readSnapshot()
  const existing = snapshot.entries.find((entry) => entry.runtimeID === id)
  const entries = snapshot.entries
    .filter((entry) => entry.runtimeID !== id)
    .concat(existing ? [{ ...existing, ...next, startedAt: existing.startedAt, lastHeartbeatAt: now }] : [next])
  await writeSnapshot(entries)
}

export async function heartbeatRuntimeRegistryEntry() {
  const id = runtimeID()
  const snapshot = await readSnapshot()
  let found = false
  const entries = snapshot.entries.map((entry) => {
    if (entry.runtimeID !== id) return entry
    found = true
    return { ...entry, lastHeartbeatAt: Date.now(), pid: process.pid, ppid: process.ppid, role: runtimeRole() }
  })
  if (!found) {
    entries.push({
      runtimeID: id,
      pid: process.pid,
      ppid: process.ppid,
      role: runtimeRole(),
      startedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
    })
  }
  await writeSnapshot(entries)
}

export async function removeRuntimeRegistryEntry(input?: { runtimeID?: string }) {
  const id = input?.runtimeID ?? runtimeID()
  const snapshot = await readSnapshot()
  const entries = snapshot.entries.filter((entry) => entry.runtimeID !== id)
  if (entries.length === 0) {
    await rm(registryPath(), { force: true }).catch(() => undefined)
    return
  }
  await writeSnapshot(entries)
}

export function startRuntimeRegistryHeartbeat(input: { directory?: string; intervalMS?: number }) {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    await heartbeatRuntimeRegistryEntry().catch(() => undefined)
  }
  void upsertRuntimeRegistryEntry({ directory: input.directory }).catch(() => undefined)
  const timer = setInterval(() => {
    void tick()
  }, input.intervalMS ?? 15_000)
  timer.unref?.()
  return {
    async stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      await removeRuntimeRegistryEntry().catch(() => undefined)
    },
  }
}

