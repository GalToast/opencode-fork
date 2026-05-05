import { mkdir } from "node:fs/promises"
import path from "node:path"

type Row = {
  name: string
  kind: "suite" | "smoke" | "stress"
  ok: boolean
  code: number | null
  ms: number
  timeout: boolean
  token?: string
  sawToken?: boolean
  cmd: string[]
  stdout: string
  stderr: string
}

const root = path.resolve(import.meta.dir, "..")
const outDir = path.join(root, "reports", "bakeoff")
const now = new Date().toISOString().replaceAll(":", "-")
const runCount = Number(Bun.env.BAKEOFF_RUNS ?? "2")
const timeoutMs = Number(Bun.env.BAKEOFF_TIMEOUT_MS ?? "180000")

function short(text: string, max: number) {
  if (text.length <= max) return text
  return text.slice(0, max) + "..."
}

async function run(name: string, kind: Row["kind"], cmd: string[], token?: string): Promise<Row> {
  const start = performance.now()
  const proc = Bun.spawn({
    cmd,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })

  const timer = setTimeout(() => {
    proc.kill()
  }, timeoutMs)

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)

  const ms = Math.round(performance.now() - start)
  const hit = token ? stdout.includes(token) || stderr.includes(token) : undefined
  const timedOut = code === null
  const ok = code === 0 && (token ? Boolean(hit) : true)

  return {
    name,
    kind,
    ok,
    code,
    ms,
    timeout: timedOut,
    token,
    sawToken: hit,
    cmd,
    stdout,
    stderr,
  }
}

function median(vals: number[]) {
  if (vals.length === 0) return 0
  const arr = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(arr.length / 2)
  if (arr.length % 2 === 1) return arr[mid]
  return Math.round((arr[mid - 1] + arr[mid]) / 2)
}

function summary(rows: Row[]) {
  const by = (name: string) => rows.filter((x) => x.name === name)
  const stat = (name: string) => {
    const set = by(name)
    return {
      runs: set.length,
      ok: set.filter((x) => x.ok).length,
      fail: set.filter((x) => !x.ok).length,
      medianMs: median(set.map((x) => x.ms)),
      minMs: Math.min(...set.map((x) => x.ms)),
      maxMs: Math.max(...set.map((x) => x.ms)),
    }
  }

  return {
    opencodeSuite: stat("opencode_suite"),
    opencodeSmoke: stat("opencode_smoke"),
    codexSmoke: stat("codex_smoke"),
    codexStress: stat("codex_parallel"),
  }
}

function line(row: Row) {
  const pass = row.ok ? "PASS" : "FAIL"
  const token = row.token ? ` token:${row.sawToken ? "yes" : "no"}` : ""
  const code = row.code === null ? "null" : String(row.code)
  return `${pass} ${row.name} ${row.ms}ms code:${code}${token}`
}

await mkdir(outDir, { recursive: true })

const rows: Row[] = []

rows.push(
  await run("opencode_suite", "suite", [
    "bun",
    "test",
    "test/cli/steering.test.ts",
    "test/tool/task-mailbox-smoke.test.ts",
    "test/scheduler/control-plane.test.ts",
    "test/scheduler/soak.test.ts",
  ]),
)

for (let i = 0; i < runCount; i++) {
  const token = `BENCH_OK_O_${i}`
  rows.push(
    await run("opencode_smoke", "smoke", [
      "opencode",
      "run",
      "--format",
      "default",
      `Return exactly ${token} and nothing else.`,
    ], token),
  )
}

for (let i = 0; i < runCount; i++) {
  const token = `BENCH_OK_C_${i}`
  rows.push(
    await run("codex_smoke", "smoke", ["codex", "exec", `Return exactly ${token} and nothing else.`], token),
  )
}

const pStart = performance.now()
const stress = Array.from({ length: runCount }, (_, i) => {
  const token = `BENCH_OK_P_${i}`
  return run("codex_parallel", "stress", ["codex", "exec", `Return exactly ${token} and nothing else.`], token)
})
const stressRows = await Promise.all(stress)
const pMs = Math.round(performance.now() - pStart)
rows.push(...stressRows)

const data = {
  generatedAt: new Date().toISOString(),
  cwd: root,
  runCount,
  timeoutMs,
  parallelWindowMs: pMs,
  summary: summary(rows),
  rows: rows.map((x) => ({
    ...x,
    stdout: short(x.stdout, 2000),
    stderr: short(x.stderr, 2000),
  })),
}

const jsonPath = path.join(outDir, `cli-bakeoff-${now}.json`)
await Bun.write(jsonPath, JSON.stringify(data, null, 2))

const txt = [
  `CLI bake-off (${new Date().toISOString()})`,
  `root: ${root}`,
  `run_count: ${runCount}`,
  `timeout_ms: ${timeoutMs}`,
  `codex_parallel_window_ms: ${pMs}`,
  "",
  ...rows.map(line),
  "",
  `json: ${jsonPath}`,
].join("\n")

const txtPath = path.join(outDir, `cli-bakeoff-${now}.txt`)
await Bun.write(txtPath, txt)

console.log(txt)
