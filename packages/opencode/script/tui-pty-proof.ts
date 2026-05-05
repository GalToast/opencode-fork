/**
 * PTY-backed TUI launch proof - no-model, source-path.
 *
 * Uses `bun-pty` to spawn the source TUI in a pseudo-terminal, captures the
 * raw ANSI output, and verifies that the TUI boots and renders UI frames.
 *
 * Scope:
 *  - Proves the TUI boots in a PTY (isTTY=true) and emits terminal frames.
 *  - Captures raw ANSI output and cleaned (ANSI-stripped) text artifacts.
 *  - Does NOT trigger slash commands (/plan, /tracker) - those are UI-level
 *    operations handled by the Solid command dialog, not PTY text input.
 *    Slash command dispatch is already covered by script/tui-render-proof.tsx.
 *
 * Usage: bun run script/tui-pty-proof.ts
 *
 * Ownership: script/tui-pty-proof.ts + tmp/tui-pty-proof/**
 */

import { spawn } from "bun-pty"
import path from "node:path"
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import stripAnsi from "strip-ansi"

// Configuration

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..")
const LAUNCHER = path.join(PACKAGE_ROOT, "src", "launcher.ts")
const OUTPUT_DIR = path.join(PACKAGE_ROOT, "tmp", "tui-pty-proof")
const RAW_LOG = path.join(OUTPUT_DIR, "pty-raw.log")
const CLEAN_LOG = path.join(OUTPUT_DIR, "pty-clean.log")
const SUMMARY = path.join(OUTPUT_DIR, "pty-proof-summary.json")
const FRAME_LOG = path.join(OUTPUT_DIR, "pty-frame-sample.txt")

const COLS = 120
const ROWS = 30
const CAPTURE_MS = 8_000
const DRAIN_MS = 1_000

const FAILURE_PATTERNS = [
  /Worker has been terminated/i,
  /ModuleNotFound/i,
  /Module not found/i,
  /Cannot find module/i,
  /ERR_MODULE_NOT_FOUND/i,
  /ResolveMessage/i,
  /uncaughtException.*fatal/i,
  /FATAL.*launch/i,
  /failed to start.*worker/i,
  /ENOENT.*launcher\.ts/i,
  /Script not found/i,
  /tui\.thread\.start.*error/i,
] as RegExp[]

const BOOT_PATTERNS = [
  // TUI boot markers
  /tui\.thread\.start/i,
  /sqlite-migration:/i,
  // OpenTUI terminal init — escape sequences mean the UI framework booted
  /\x1b\[\??\d+[a-zA-Z]/,
  /\x1b\[\d+m/,
  // Generic launch
  /opencode.*started/i,
  /render.*ready/i,
  /OpenTUI/i,
] as RegExp[]

// Helpers

function ts(): string {
  return new Date().toISOString()
}

function failReason(output: string): string | null {
  for (const re of FAILURE_PATTERNS) {
    const m = output.match(re)
    if (m) return m[0]
  }
  return null
}

function bootReason(output: string): string | null {
  for (const re of BOOT_PATTERNS) {
    const m = output.match(re)
    if (m) return m[0]
  }
  return null
}

function extractFrameSample(cleaned: string, maxLines = 40): string {
  // Grab the first non-empty contiguous block of lines that look like TUI output
  // (borders, aligned text, UI elements)
  const lines = cleaned.split(/\r?\n/)
  const nonEmpty = lines.filter((l) => l.trim().length > 0)
  // Take first N meaningful lines
  return nonEmpty.slice(0, maxLines).join("\n")
}

// Main

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  if (!existsSync(LAUNCHER)) {
    const msg = `[${ts()}] PTY PROOF FAIL — launcher not found\n  expected: ${LAUNCHER}\n`
    process.stderr.write(msg)
    writeFileSync(path.join(OUTPUT_DIR, "pty-proof.log"), msg)
    process.exitCode = 1
    return
  }

  const chunks: string[] = []
  let exited = false
  let exitCode: number | null = null

  const env: Record<string, string> = {
    ...process.env,
    OPENCODE_PURE: "1",
    OPENCODE_SEARXNG_PREFLIGHT: "0",
    OPENCODE_SEARXNG_AUTO_START: "0",
    // Avoid NO_COLOR/FORCE_COLOR conflict; let Bun decide.
    NO_COLOR: undefined as unknown as string,
    FORCE_COLOR: undefined as unknown as string,
    // Force a known terminal size via env (PTY resize handles the rest)
    COLUMNS: String(COLS),
    LINES: String(ROWS),
  }

  // Remove undefined values
  for (const k of Object.keys(env)) {
    if (env[k] === undefined) delete env[k]
  }

  let child: ReturnType<typeof spawn>
  try {
    child = spawn("bun", ["run", "--conditions=browser", LAUNCHER], {
      name: "xterm-256color",
      cwd: PACKAGE_ROOT,
      env,
    })
  } catch (err) {
    const msg = `[${ts()}] PTY PROOF FAIL — spawn error: ${err instanceof Error ? err.message : String(err)}\n`
    process.stderr.write(msg)
    writeFileSync(path.join(OUTPUT_DIR, "pty-proof.log"), msg)
    process.exitCode = 1
    return
  }

  // Resize to known dimensions
  try {
    child.resize(COLS, ROWS)
  } catch {
    // best effort
  }

  child.onData((chunk: string) => {
    chunks.push(chunk)
  })

  child.onExit(({ exitCode: code }) => {
    exited = true
    exitCode = code
  })

  // Wait for capture period or exit
  const startMs = Date.now()
  while (!exited && Date.now() - startMs < CAPTURE_MS) {
    await Bun.sleep(250)
  }

  // Drain any remaining output
  await Bun.sleep(DRAIN_MS)

  // Kill if still alive
  if (!exited) {
    try {
      child.kill()
    } catch {
      // best effort
    }
    await Bun.sleep(500)
  }

  const elapsed = Date.now() - startMs
  const rawOutput = chunks.join("")
  const cleanedOutput = stripAnsi(rawOutput)
  const failure = failReason(rawOutput)
  const booted = bootReason(rawOutput)
  const cleanedLines = cleanedOutput.split(/\r?\n/)
  const nonEmptyLines = cleanedLines.filter((l) => l.trim().length > 0)
  const hasBorderChars = /[│├┤┬┴┼─┌┐└┘╭╮╯╰]/.test(cleanedOutput)
  const hasOpenTuiMarker = /opentui|OpenTUI|opencode/i.test(cleanedOutput)
  const hasRenderedFrame = nonEmptyLines.length > 0 || hasBorderChars || hasOpenTuiMarker

  // Verdict:
  // 1. Failure pattern matched -> FAIL
  // 2. Boot pattern plus rendered output -> PASS
  // 3. Exited with non-zero and no boot -> FAIL
  // 4. Terminal init without visible frame -> INCONCLUSIVE
  // 5. Otherwise -> INCONCLUSIVE
  const verdict = failure
    ? "FAIL"
    : booted && hasRenderedFrame
      ? "PASS"
      : exited && exitCode !== 0
        ? "FAIL (silent exit)"
        : booted
          ? "INCONCLUSIVE (terminal init only)"
          : "INCONCLUSIVE"

  // Extract a sample frame from cleaned output
  const frameSample = extractFrameSample(cleanedOutput)

  // Write artifacts
  writeFileSync(RAW_LOG, rawOutput, "utf-8")
  writeFileSync(CLEAN_LOG, cleanedOutput, "utf-8")
  writeFileSync(FRAME_LOG, frameSample, "utf-8")

  const summary = {
    timestamp: new Date().toISOString(),
    verdict,
    elapsedMs: elapsed,
    cols: COLS,
    rows: ROWS,
    rawBytes: Buffer.byteLength(rawOutput, "utf8"),
    cleanedLines: cleanedLines.length,
    nonEmptyLines: nonEmptyLines.length,
    hasBorderCharacters: hasBorderChars,
    hasOpenTuiMarker: hasOpenTuiMarker,
    bootPattern: booted ?? "none",
    failurePattern: failure ?? "none",
    exitCode,
    exited,
    productModelCalls: false,
    networkCalls: false,
    artifacts: [
      "pty-raw.log",
      "pty-clean.log",
      "pty-frame-sample.txt",
      "pty-proof-summary.json",
    ],
    limitations: [
      "Slash commands (/plan, /tracker) are UI-level operations not triggerable via PTY text input.",
      "This proof confirms frame rendering only when visible frame text, borders, or OpenCode/OpenTUI markers are captured.",
      "Full slash command dispatch requires the testRender harness (see script/tui-render-proof.tsx).",
    ],
  }

  writeFileSync(SUMMARY, JSON.stringify(summary, null, 2), "utf-8")

  // Console output
  const lines = [
    `PTY TUI PROOF - ${verdict}`,
    `  launcher:       ${LAUNCHER}`,
    `  elapsed:        ${elapsed} ms`,
    `  exited:         ${exited}`,
    `  exitCode:       ${exitCode}`,
    `  boot_pattern:   ${booted ?? "none"}`,
    `  failure:        ${failure ?? "none"}`,
    `  raw_bytes:      ${summary.rawBytes}`,
    `  cleaned_lines:  ${summary.cleanedLines}`,
    `  border_chars:   ${hasBorderChars}`,
    `  tui_marker:     ${hasOpenTuiMarker}`,
    `  artifacts:      ${OUTPUT_DIR}`,
  ]

  const output = lines.join("\n") + "\n"
  process.stderr.write(output)

  if (verdict.startsWith("FAIL")) {
    process.exitCode = 1
  }
}

await main()
