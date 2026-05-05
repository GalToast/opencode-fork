#!/usr/bin/env bun

import path from "path"
import { existsSync } from "fs"

const root = path.resolve(import.meta.dir, "..")
const instances = path.join(root, ".opencode", "runtime", "instances")

function arg(name: string, fallback: string) {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return fallback
  const next = process.argv[idx + 1]
  if (!next || next.startsWith("--")) return fallback
  return next
}

function flag(name: string) {
  return process.argv.includes(name)
}

function num(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10)
  if (Number.isFinite(parsed)) return parsed
  return fallback
}

function fmtAge(ms: number) {
  if (ms < 1000) return `${ms}ms`
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const rem = secs % 60
  if (mins < 60) return rem ? `${mins}m${rem}s` : `${mins}m`
  const hours = Math.floor(mins / 60)
  const minRem = mins % 60
  return minRem ? `${hours}h${minRem}m` : `${hours}h`
}

function fmtMb(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "-"
  return `${value.toFixed(1)}MB`
}

function short(value: string, max = 68) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 3)}...`
}

function state(input: { alive: boolean; beat: number; ws?: number }) {
  if (!input.alive) return "dead"
  if (input.beat > 5 * 60 * 1000) return "stale"
  if ((input.ws ?? 0) >= 1024) return "hot"
  return "ok"
}

async function winProcs() {
  const ps = `
$ErrorActionPreference = 'Stop'
$list = Get-CimInstance Win32_Process | ForEach-Object {
  $procId = [int]$_.ProcessId
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  [pscustomobject]@{
    pid = $procId
    ppid = [int]$_.ParentProcessId
    name = $_.Name
    cmd = if ($_.CommandLine) { [string]$_.CommandLine } else { '' }
    ws = if ($proc) { [math]::Round($proc.WorkingSet64 / 1MB, 1) } else { $null }
    cpu = if ($proc -and $null -ne $proc.CPU) { [math]::Round($proc.CPU, 3) } else { $null }
  }
}
$list | ConvertTo-Json -Depth 3 -Compress
`
  const out = Bun.spawnSync(["powershell", "-NoProfile", "-Command", ps], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: root,
  })
  if (out.exitCode !== 0) throw new Error(Buffer.from(out.stderr).toString() || "powershell failed")
  const text = Buffer.from(out.stdout).toString().trim()
  if (!text) return []
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function unixProcs() {
  const out = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,rss=,pcpu=,comm=,args="], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: root,
  })
  if (out.exitCode !== 0) throw new Error(Buffer.from(out.stderr).toString() || "ps failed")
  return Buffer.from(out.stdout)
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/)
      if (!parts) return undefined
      return {
        pid: Number.parseInt(parts[1], 10),
        ppid: Number.parseInt(parts[2], 10),
        ws: Math.round((Number.parseInt(parts[3], 10) / 1024) * 10) / 10,
        cpu: Number.parseFloat(parts[4]),
        name: parts[5],
        cmd: parts[6],
      }
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
}

async function procs() {
  if (process.platform === "win32") return winProcs()
  return unixProcs()
}

async function snap() {
  const list = await procs()
  return new Map(list.map((item) => [item.pid, item]))
}

function children(map: Map<number, Awaited<ReturnType<typeof procs>>[number]>) {
  const out = new Map<number, number[]>()
  for (const item of map.values()) {
    const arr = out.get(item.ppid) ?? []
    arr.push(item.pid)
    out.set(item.ppid, arr)
  }
  return out
}

function tree(pid: number, kids: Map<number, number[]>) {
  const out: number[] = []
  const seen = new Set<number>()
  const walk = (curr: number) => {
    for (const next of kids.get(curr) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      out.push(next)
      walk(next)
    }
  }
  walk(pid)
  return out
}

async function entries() {
  if (!existsSync(instances)) return []
  const dirs = [...new Bun.Glob("term-*/source-runtime-registry.json").scanSync({ cwd: instances })]
  const now = Date.now()
  return dirs.flatMap((rel) => {
    const file = path.join(instances, rel)
    const term = rel.split(path.sep)[0]
    const diag = file.replace(/\.json$/i, "-diagnostics.json")
    const json = Bun.file(file).json() as Promise<{
      entries?: Array<{
        runtimeID: string
        pid: number
        ppid: number
        role: string
        startedAt: number
        lastHeartbeatAt: number
        directory: string
      }>
    }>
    const metrics = existsSync(diag)
      ? (Bun.file(diag).json() as Promise<{
          entries?: Array<{
            runtimeID: string
            rssMB?: number
            heapTotalMB?: number
            heapUsedMB?: number
            externalMB?: number
            arrayBuffersMB?: number
            uptimeSec?: number
            execPath?: string
            argv?: string[]
            updatedAt?: number
          }>
        }>)
      : Promise.resolve({ entries: [] })
    return [{ file, term, json, metrics, now }]
  })
}

async function collect() {
  const regs = await entries()
  const map = await snap()
  const kids = children(map)
  return Promise.all(
    regs.map(async (item) => {
      const data = await item.json.catch(() => ({ entries: [] }))
      const metrics = await item.metrics.catch(() => ({ entries: [] }))
      return (data.entries ?? []).map((entry) => {
        const proc = map.get(entry.pid)
        const desc = tree(entry.pid, kids)
        const child = desc.map((pid) => map.get(pid)).filter((value): value is NonNullable<typeof value> => !!value)
        const metric = (metrics.entries ?? []).find((value) => value.runtimeID === entry.runtimeID)
        const beat = Math.max(0, item.now - entry.lastHeartbeatAt)
        const own = proc?.ws ?? 0
        const total = own + child.reduce((sum, curr) => sum + (curr.ws ?? 0), 0)
        const row = {
          term: item.term,
          runtimeID: entry.runtimeID,
          pid: entry.pid,
          ppid: entry.ppid,
          role: entry.role,
          directory: entry.directory,
          file: item.file,
          alive: !!proc,
          beat,
          ws: proc?.ws,
          cpu: proc?.cpu,
          total,
          childCount: child.length,
          childNames: [...new Set(child.map((curr) => curr.name))].sort(),
          cmd: proc?.cmd ?? "",
          rss: metric?.rssMB,
          heap: metric?.heapUsedMB,
          heapTotal: metric?.heapTotalMB,
          ext: metric?.externalMB,
          buffers: metric?.arrayBuffersMB,
          uptime: metric?.uptimeSec,
          execPath: metric?.execPath,
          argv: metric?.argv ?? [],
          metricsAge: metric?.updatedAt ? Math.max(0, item.now - metric.updatedAt) : undefined,
        }
        return row
      })
    }),
  ).then((list) => list.flat())
}

function report(rows: Awaited<ReturnType<typeof collect>>) {
  const recent = flag("--all") ? rows : rows.filter((row) => row.alive || row.beat < 30 * 60 * 1000)
  const lines = recent
    .sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1
      return (b.total || 0) - (a.total || 0)
    })
    .map((row) => {
      const mark = state({ alive: row.alive, beat: row.beat, ws: row.total })
      const child = row.childNames.length ? row.childNames.join(",") : "-"
      return [
        mark.padEnd(5),
        row.term.padEnd(12),
        String(row.pid).padEnd(7),
        fmtMb(row.ws).padEnd(11),
        fmtMb(row.total).padEnd(11),
        fmtMb(row.heap).padEnd(11),
        fmtMb(row.ext).padEnd(11),
        fmtAge(row.beat).padEnd(8),
        String(row.childCount).padEnd(5),
        short(child, 26).padEnd(26),
        short(row.cmd || row.role, 72),
      ].join(" ")
    })

  console.log("state term         pid     own_ws      total_ws    heap       external   beat     kids  child_names                command")
  for (const line of lines) console.log(line)
  console.log("")
  const hot = recent.filter((row) => (row.total || 0) >= 1024)
  const stale = recent.filter((row) => row.alive && row.beat > 5 * 60 * 1000)
  const dead = recent.filter((row) => !row.alive)
  if (hot.length) {
    console.log("alerts:")
    for (const row of hot) {
      console.log(`- hot: ${row.term} pid ${row.pid} using ${fmtMb(row.total)} total (${fmtMb(row.ws)} own)`)
    }
  }
  if (stale.length) {
    if (!hot.length) console.log("alerts:")
    for (const row of stale) {
      console.log(`- stale heartbeat: ${row.term} pid ${row.pid} last beat ${fmtAge(row.beat)} ago`)
    }
  }
  if (dead.length) {
    if (!hot.length && !stale.length) console.log("alerts:")
    for (const row of dead) {
      console.log(`- dead registry entry: ${row.term} pid ${row.pid} role ${row.role}`)
    }
  }
  if (!hot.length && !stale.length && !dead.length) {
    console.log("alerts:\n- none")
  }
}

async function trend(rows: Awaited<ReturnType<typeof collect>>, secs: number) {
  if (secs <= 0) return
  const before = new Map(rows.map((row) => [row.pid, row]))
  await new Promise((resolve) => setTimeout(resolve, secs * 1000))
  const after = merge(await collect()).filter((row) => flag("--all") || row.alive || row.beat < 30 * 60 * 1000)
  console.log("")
  console.log(`trend after ${secs}s:`)
  for (const row of after.sort((a, b) => (b.total || 0) - (a.total || 0))) {
    const prev = before.get(row.pid)
    const totalDelta = prev ? (row.total || 0) - (prev.total || 0) : 0
    const cpuDelta = prev ? (row.cpu ?? 0) - (prev.cpu ?? 0) : 0
    console.log(
      `- ${row.term} pid ${row.pid}: total ${fmtMb(row.total)} (${totalDelta >= 0 ? "+" : ""}${totalDelta.toFixed(1)}MB), cpu ${cpuDelta >= 0 ? "+" : ""}${cpuDelta.toFixed(3)}`,
    )
  }
}

function merge(rows: Awaited<ReturnType<typeof collect>>) {
  const map = new Map<string, (typeof rows)[number] & { roles: string[]; runtimeIDs: string[] }>()
  for (const row of rows) {
    const key = `${row.term}:${row.pid}`
    const curr = map.get(key)
    if (!curr) {
      map.set(key, {
        ...row,
        roles: [row.role],
        runtimeIDs: [row.runtimeID],
      })
      continue
    }
    curr.roles = [...new Set([...curr.roles, row.role])].sort()
    curr.runtimeIDs = [...new Set([...curr.runtimeIDs, row.runtimeID])].sort()
    curr.alive = curr.alive || row.alive
    curr.beat = Math.min(curr.beat, row.beat)
    curr.ws = Math.max(curr.ws ?? 0, row.ws ?? 0)
    curr.cpu = Math.max(curr.cpu ?? 0, row.cpu ?? 0)
    curr.total = Math.max(curr.total || 0, row.total || 0)
    curr.rss = Math.max(curr.rss ?? 0, row.rss ?? 0)
    curr.heap = Math.max(curr.heap ?? 0, row.heap ?? 0)
    curr.heapTotal = Math.max(curr.heapTotal ?? 0, row.heapTotal ?? 0)
    curr.ext = Math.max(curr.ext ?? 0, row.ext ?? 0)
    curr.buffers = Math.max(curr.buffers ?? 0, row.buffers ?? 0)
    curr.uptime = Math.max(curr.uptime ?? 0, row.uptime ?? 0)
    curr.childCount = Math.max(curr.childCount, row.childCount)
    curr.childNames = [...new Set([...curr.childNames, ...row.childNames])].sort()
    if (!curr.cmd && row.cmd) curr.cmd = row.cmd
    if (!curr.execPath && row.execPath) curr.execPath = row.execPath
    if (!curr.argv.length && row.argv.length) curr.argv = row.argv
    if (curr.metricsAge === undefined || (row.metricsAge ?? Number.POSITIVE_INFINITY) < curr.metricsAge) {
      curr.metricsAge = row.metricsAge
    }
  }
  return [...map.values()].map((row) => ({
    ...row,
    role: row.roles.join(","),
    runtimeID: row.runtimeIDs.join(","),
  }))
}

const json = flag("--json")
const secs = num(arg("--sample-secs", "0"), 0)
const rows = merge(await collect())

if (json) {
  console.log(JSON.stringify(rows, null, 2))
  process.exit(0)
}

report(rows)
await trend(rows, secs)
