# Bug Sweep: util, sdk, function, opencode packages

**Date:** 2026-04-03
**Scope:** packages/util/src, packages/sdk/src, packages/function/src, packages/opencode/src
**Method:** Read every source file end-to-end; verified call sites for flagged patterns.

---

## packages/sdk/src

**No files found.** This package has no `src/` directory. Nothing to sweep.

---

## packages/util/src (11 files)

### No bugs found

All 11 files are small, pure utility modules with no runtime issues:

| File | Verdict |
|------|---------|
| `slug.ts` | Pure string generation, no side effects |
| `retry.ts` | Properly awaits, throws on final attempt, bounded retries |
| `path.ts` | Guards `!path`, uses `?? ""` fallbacks |
| `lazy.ts` | Correct lazy init; does NOT mark loaded on exception (fn() can throw, loaded stays false) |
| `iife.ts` | Trivial identity wrapper |
| `identifier.ts` | Module-level mutable state (`lastTimestamp`, `counter`) — intentional for monotonic IDs; no concurrency issue in Node single-threaded model |
| `fn.ts` | Schema validation before callback, `force` bypass is explicit |
| `error.ts` | Abstract class factory, no runtime issues |
| `encode.ts` | `checksum` and `sampledChecksum` guard `!content`; `hash` is async/await |
| `binary.ts` | Standard binary search/insert, correct bounds |
| `array.ts` | Manual `findLast`, correct descending loop |

---

## packages/function/src (1 file)

### No bugs found

| File | Verdict |
|------|---------|
| `api.ts` | Hono/Cloudflare Workers API. All async routes use `await`. JWT verification guards missing keys. Octokit calls are try/catch'd. |

---

## packages/opencode/src (100+ files)

### BUG 1: Shell injection in archive extraction — HIGH

**File:** `packages/opencode/src/util/archive.ts` — line 9

```ts
const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}' -Force`
await $`powershell -NoProfile -NonInteractive -Command ${cmd}`.quiet()
```

**What's wrong:** `winZipPath` and `winDestDir` are interpolated directly into a PowerShell command string delimited by single quotes. If either path contains a single quote (`'`), it breaks out of the string and allows arbitrary PowerShell command injection.

**Example exploit:** If `winZipPath` = `C:\temp\file'name.zip`, the command becomes:
```
Expand-Archive -Path 'C:\temp\file'name.zip' -DestinationPath '...' -Force
```
The `'` in `file'name` terminates the string early, and `name.zip'` becomes a bare token that PowerShell will attempt to execute.

**Callers:** `lsp/server.ts` calls `Archive.extractZip()` 8 times with paths derived from `Global.Path.bin` and temp directories. While these are currently controlled paths, any future caller passing user-influenced paths would be vulnerable.

**Fix:** Escape single quotes in the interpolated values:
```ts
const escapedZipPath = winZipPath.replace(/'/g, "''")
const escapedDestDir = winDestDir.replace(/'/g, "''")
const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${escapedZipPath}' -DestinationPath '${escapedDestDir}' -Force`
```

---

### BUG 2: AsyncQueue iterator hangs forever after exhaustion — HIGH (latent)

**File:** `packages/opencode/src/util/queue.ts` — lines 16-18

```ts
async *[Symbol.asyncIterator]() {
  while (true) yield await this.next()
}
```

**What's wrong:** `next()` returns a `Promise<T>` that only resolves when either (a) an item is already in the queue, or (b) a future `.push()` call resolves the waiting promise. After the queue is exhausted and no more `.push()` calls will ever come, any `for await` consumer will hang forever on `this.next()` — there is no sentinel value, no `done` signal, and no timeout.

**Current impact:** The `Symbol.asyncIterator` is never consumed via `for await` anywhere in the codebase. Only `.next()` and `.push()` are called directly in `server/routes/tui.ts`. So this is a **latent bug** — the iterator contract is broken but the broken path is unused.

**Severity:** HIGH if the iterator is ever used; LOW in current codebase.

---

### BUG 3: JSON.parse without try/catch on external process output — MEDIUM

**File:** `packages/opencode/src/file/ripgrep.ts` — line 386

```ts
const lines = result.stdout.toString().trim().split(/\r?\n/).filter(Boolean)
const matches: z.output<typeof Match>[] = []
for (const line of lines) {
  const parsed: unknown = JSON.parse(line)  // ← unguarded
  const rgResult = Result.parse(parsed)
  if (rgResult.type === "match") matches.push(rgResult.data)
}
```

**What's wrong:** `JSON.parse(line)` is called on each line of ripgrep's stdout without a try/catch. While ripgrep is invoked with `--json` (line 353), which should produce valid JSON lines, any corruption, truncation, or unexpected output from the external process would crash the entire search with an unhandled exception.

**Why it matters:** External process output should never be trusted. A single malformed line crashes the entire search instead of gracefully skipping it.

**Fix:**
```ts
for (const line of lines) {
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch { continue }
  const rgResult = Result.parse(parsed)
  if (rgResult.type === "match") matches.push(rgResult.data)
}
```

---

### BUG 4: Incomplete recursive-delete flag detection — MEDIUM

**File:** `packages/opencode/src/tool/shell.ts` — line 217

```ts
const isRecursive = command.some((arg) => arg === "-r" || arg === "-R" || arg === "-rf" || arg === "-rfv")
```

**What's wrong:** The check only matches exact flag strings. Common combined/permuted flags are **not detected**:
- `-fr`, `-Rf`, `-vrf`, `-rv`, `-fR` (different order)
- `-rfx`, `-Rfv` (extra flags attached)
- `--recursive` (GNU long form)

A command like `rm -fr /sensitive/path` or `rm -xrf data/` would bypass the risk scanner entirely, producing no risk warnings in the permission prompt.

**Fix:** Check each character individually:
```ts
const isRecursive = command.some((arg) => {
  if (arg.startsWith("--")) return arg === "--recursive"
  const flags = arg.startsWith("-") ? arg.slice(1) : ""
  return flags.includes("r") || flags.includes("R")
})
```

---

### BUG 5: proc.exitCode is null when process killed by signal — LOW

**File:** `packages/opencode/src/tool/shell.ts` — line 407

```ts
metadata: {
  exit: proc.exitCode,  // number | null
  ...
}
```

**What's wrong:** When a process is killed by a signal (e.g., the timeout kill via `Shell.killTree`), `proc.exitCode` is `null` and `proc.signalCode` holds the signal name instead. Downstream consumers expecting a numeric exit code will receive `null`, which can cause incorrect behavior — e.g., treating `null` as `0` (success) in loose equality checks (`== 0`), or crashing in strict numeric contexts.

**Fix:** Fall back to a sentinel value:
```ts
exit: proc.exitCode ?? (proc.signalCode ? -1 : null),
```

---

### DEAD CODE: eventloop.ts — not imported anywhere

**File:** `packages/opencode/src/util/eventloop.ts`

This file is not imported by any other file in the codebase. Additionally, `_getActiveHandles()` and `_getActiveRequests()` are Node.js internals that **do not exist in Bun** (this project runs on Bun). If it were ever used, it would throw `TypeError: runtime._getActiveHandles is not a function`.

**Severity:** Not a runtime bug (dead code), but should be removed to avoid confusion.

---

## Summary

| # | File | Line(s) | Severity | Status |
|---|------|---------|----------|--------|
| 1 | `opencode/src/util/archive.ts` | 9 | **HIGH** | Shell injection via unescaped single quotes in PowerShell command |
| 2 | `opencode/src/util/queue.ts` | 16-18 | **HIGH** (latent) | AsyncQueue `for await` iterator hangs forever after exhaustion |
| 3 | `opencode/src/file/ripgrep.ts` | 386 | **MEDIUM** | `JSON.parse` without try/catch on external process output |
| 4 | `opencode/src/tool/shell.ts` | 217 | **MEDIUM** | Incomplete recursive-delete flag detection (`-fr`, `--recursive` bypass) |
| 5 | `opencode/src/tool/shell.ts` | 407 | **LOW** | `proc.exitCode` is `null` when process killed by signal |
| 6 | `opencode/src/util/eventloop.ts` | all | N/A | Dead code + uses Node internals not available in Bun |

**Total: 2 HIGH, 2 MEDIUM, 1 LOW, 1 dead code.**
