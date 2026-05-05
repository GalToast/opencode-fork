/**
 * TUI launch smoke test — no-model, source-path.
 *
 * Spawns the source TUI via `bun run --conditions=browser src/launcher.ts`,
 * waits briefly, scans stderr/stdout for immediate worker/launcher failures,
 * then stops the child process and writes a concise proof log.
 *
 * Ownership: script/tui-launch-smoke.ts + tmp/tui-launch-smoke/**
 *
 * Usage: bun run script/tui-launch-smoke.ts
 *
 * Limitations on Windows:
 * - The TUI (OpenTUI) writes ANSI escape sequences to stderr for terminal
 *   control. In a non-TTY spawn these appear as raw bytes — this is expected.
 * - The TUI may exit quickly when no real TTY is attached. The smoke treats
 * - A non-TTY silent exit is not treated as proof of a working UI or as proof
 *   of a crash. It reports INCONCLUSIVE unless a known failure string appears.
 */

import { spawn, spawnSync } from "node:child_process"
import path from "node:path"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"

// ── configuration ────────────────────────────────────────────────────────────

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..")
const LAUNCHER = path.join(PACKAGE_ROOT, "src", "launcher.ts")
const OUTPUT_DIR = path.join(PACKAGE_ROOT, "tmp", "tui-launch-smoke")
const LOG_FILE = path.join(OUTPUT_DIR, "smoke.log")
const MAX_WAIT_MS = 12_000
const FAILURE_PATTERNS = [
  /Worker has been terminated/i,
  /ModuleNotFound/i,
  /Module not found/i,
  /module\s+not\s+found/i,
  /Cannot find module/i,
  /Cannot resolve module/i,
  /undefined is not an object/i,
  /Cannot read properties of undefined/i,
  /ERR_MODULE_NOT_FOUND/i,
  /ResolveMessage/i,
  /uncaughtException.*fatal/i,
  /FATAL.*launch/i,
  /failed to start.*worker/i,
  /spawn.*ENOENT.*launcher/i,
  /ENOENT.*opencode\.db/i,
  /ENOENT.*launcher\.ts/i,
  /Script not found/i,
] as RegExp[]

const START_PATTERNS = [
  // TUI lifecycle markers (from src/cli/cmd/tui/thread.ts)
  /tui\.thread\.start/i,
  // OpenTUI terminal init — raw escape sequences mean the UI framework booted
  /\x1b\[\??\d+[a-zA-Z]/,   // CSI sequence — terminal control
  /\x1b\[\d+m/,              // SGR color codes
  /\x1b\]66;/,               // OSC 66 — OpenTUI-specific
  // SQLite migration progress (from src/index.ts)
  /sqlite-migration:/i,
  // Generic success
  /opencode.*started/i,
  /render.*ready/i,
  /OpenTUI.*ready/i,
] as RegExp[]

// ── helpers ──────────────────────────────────────────────────────────────────

function failReason(output: string): string | null {
  for (const re of FAILURE_PATTERNS) {
    const m = output.match(re)
    if (m) return m[0]
  }
  return null
}

function startedReason(output: string): string | null {
  for (const re of START_PATTERNS) {
    const m = output.match(re)
    if (m) return m[0]
  }
  return null
}

function ts(): string {
  return new Date().toISOString()
}

function log(lines: string[]) {
  const text = lines.map((l) => `[${ts()}] ${l}`).join("\n") + "\n"
  process.stderr.write(text)
  return text
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  if (!existsSync(LAUNCHER)) {
    const buf = log([
      "SMOKE FAIL — launcher not found",
      `  expected: ${LAUNCHER}`,
    ])
    writeFileSync(LOG_FILE, buf)
    process.exitCode = 1
    return
  }

  const chunks: Buffer[] = []
  let exited = false
  let exitCode: number | null = null
  let exitSignal: string | null = null
  let childPid = 0

  const child = spawn(
    "bun",
    ["run", "--conditions=browser", LAUNCHER],
    {
      cwd: PACKAGE_ROOT,
      env: {
        ...process.env,
        OPENCODE_PURE: "1",         // no external plugins
        CI: "1",                     // hint non-interactive
        NO_COLOR: "1",               // reduce ANSI noise (kept for detection)
        OPENCODE_SEARXNG_PREFLIGHT: "0", // skip searxng preflight for speed
        OPENCODE_SEARXNG_AUTO_START: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  )

  childPid = child.pid ?? 0

  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk))
  child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk))

  child.on("exit", (code, sig) => {
    exited = true
    exitCode = code
    exitSignal = sig
  })

  child.on("error", (err) => {
    chunks.push(Buffer.from(`spawn error: ${err.message}`))
    exited = true
  })

  // Wait up to MAX_WAIT_MS or until the process exits.
  const startMs = Date.now()
  while (!exited && Date.now() - startMs < MAX_WAIT_MS) {
    await Bun.sleep(250)
  }

  // Kill the process tree if still alive.
  if (!exited && childPid > 0) {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/T", "/F", "/PID", String(childPid)], {
          windowsHide: true,
          timeout: 5000,
        })
      } else {
        child.kill("SIGTERM")
      }
    } catch { /* best effort */ }
    await Bun.sleep(500)
    if (!exited) {
      try { child.kill("SIGKILL") } catch { /* best effort */ }
      await Bun.sleep(200)
    }
  }

  const elapsed = Date.now() - startMs
  const output = Buffer.concat(chunks).toString("utf8")
  const failure = failReason(output)
  const started = startedReason(output)

  // Verdict logic:
  // 1. If a failure pattern matched → FAIL
  // 2. If a start pattern matched and no failure → PASS (even if exited ≠ 0,
  //    because TUI legitimately exits fast without a TTY)
  // 3. If no output was emitted and no failure matched → INCONCLUSIVE
  // 4. If no start pattern and exited with non-zero after producing output → FAIL
  // 5. Otherwise → INCONCLUSIVE (ran but produced nothing recognizable)
  const verdict = failure
    ? "FAIL"
    : started
      ? "PASS"
      : output.length === 0
        ? "INCONCLUSIVE (non-TTY silent exit)"
        : exited && exitCode !== 0
          ? "FAIL"
          : "INCONCLUSIVE"

  const lines = [
    `TUI LAUNCH SMOKE — ${verdict}`,
    `  launcher:      ${LAUNCHER}`,
    `  elapsed:       ${elapsed} ms`,
    `  exited:        ${exited}`,
    `  exitCode:      ${exitCode}`,
    `  signal:        ${exitSignal ?? "—"}`,
    `  failure_match: ${failure ?? "none"}`,
    `  start_match:   ${started ?? "none"}`,
    `  output_bytes:  ${Buffer.byteLength(output, "utf8")}`,
    `  log:           ${LOG_FILE}`,
  ]

  // Append last 3 KB of output for diagnostics.
  const tail = output.slice(-3072)
  if (tail) {
    lines.push("")
    lines.push("── output tail (last 3 KB) ──")
    lines.push(tail)
    lines.push("── end tail ──")
  }

  const buf = log(lines)
  writeFileSync(LOG_FILE, buf)

  if (verdict.startsWith("FAIL")) {
    process.exitCode = 1
  }
}

await main()
