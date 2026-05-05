# TUI Launch/Render Proof Path - Recruiter-Facing Summary

## What This Is

A no-model, no-network proof path that validates the real `DialogPlan` and `DialogTracker` TypeScript modules can be imported and rendered under a deterministic mock harness. It also includes a PTY-backed live launch proof that confirms the source launcher boots in a pseudo-terminal and records whether visible UI frames were emitted.

There are three independent proof scripts:

1. **`script/tui-render-proof.tsx`** - renders the two dialog modules to character frames, captures Tracker list + DAG modes, drives `/plan`, `/tracker`, and `/tasks` through the real `CommandProvider.triggerSlash()` path, and emits artifacts
2. **`script/tui-launch-smoke.ts`** - spawns `src/launcher.ts`, checks for startup failure patterns, and reports non-TTY silent exits as inconclusive
3. **`script/tui-pty-proof.ts`** - spawns the TUI via `bun-pty`, captures raw ANSI output, and reports visible-frame evidence when present

---

## What to Run

```powershell
# Render proof (no model, no network) - mounts real DialogPlan/DialogTracker with mocked contexts
bun run script/tui-render-proof.tsx

# Launch smoke (spawns launcher, checks for fatal patterns)
bun run script/tui-launch-smoke.ts

# PTY proof (spawns TUI in pseudo-terminal, captures frame output)
bun run script/tui-pty-proof.ts

# Unit proof (runs the render proof as a Bun test)
bun test test/cli/tui-render-proof.test.tsx
```

All four can be run in CI or locally. No external services, no secrets, no model API calls.

---

## Artifacts Generated

### Render Proof (`tui-render-proof.tsx`)

| Artifact | Location | Contents |
|---|---|---|
| `dialog-plan-frame.txt` | `tmp/tui-render-proof/` | 88×18 char-frame capture of DialogPlan |
| `dialog-tracker-frame.txt` | `tmp/tui-render-proof/` | Back-compat 108×24 char-frame capture of DialogTracker list mode |
| `dialog-tracker-list-frame.txt` | `tmp/tui-render-proof/` | Tracker list-mode char-frame capture |
| `dialog-tracker-dag-frame.txt` | `tmp/tui-render-proof/` | Tracker DAG-mode char-frame capture after OpenTUI mock input presses `d` |
| `slash-command-wiring.json` | `tmp/tui-render-proof/` | Source verification that the session route uses the shared plan/tracker command options |
| `slash-plan-dispatch-frame.txt` | `tmp/tui-render-proof/` | Frame captured after `CommandProvider.triggerSlash("plan")` opens DialogPlan |
| `slash-tracker-dispatch-frame.txt` | `tmp/tui-render-proof/` | Frame captured after `CommandProvider.triggerSlash("tracker")` opens DialogTracker |
| `slash-tasks-alias-dispatch-frame.txt` | `tmp/tui-render-proof/` | Frame captured after `CommandProvider.triggerSlash("tasks")` opens DialogTracker via alias |
| `slash-command-dispatch.json` | `tmp/tui-render-proof/` | Machine-readable trigger/replace results for `/plan`, `/tracker`, and `/tasks` |
| `real-dialog-proof.html` | `tmp/tui-render-proof/` | Browser-viewable composite of plan, tracker list, tracker DAG, slash wiring, and slash dispatch frames |
| `real-dialog-proof.png` | `tmp/tui-render-proof/` | Optional full-page browser screenshot captured from the generated HTML proof |
| `real-dialog-proof-summary.json` | `tmp/tui-render-proof/` | Machine-readable proof metadata |

### Launch Smoke (`tui-launch-smoke.ts`)

| Artifact | Location | Contents |
|---|---|---|
| `smoke.log` | `tmp/tui-launch-smoke/` | Launcher output tail, verdict, timing |

### PTY Proof (`tui-pty-proof.ts`)

| Artifact | Location | Contents |
|---|---|---|
| `pty-raw.log` | `tmp/tui-pty-proof/` | Raw ANSI terminal output from PTY |
| `pty-clean.log` | `tmp/tui-pty-proof/` | ANSI-stripped cleaned output |
| `pty-frame-sample.txt` | `tmp/tui-pty-proof/` | Extracted TUI frame sample (first 40 non-empty lines) |
| `pty-proof-summary.json` | `tmp/tui-pty-proof/` | Machine-readable proof metadata with verdict |

---

## What Is Proven

| Claim | How |
|---|---|
| Real `DialogPlan` and `DialogTracker` modules import and render without crashing | `testRender()` from `@opentui/solid` mounts each component; `captureCharFrame()` extracts output |
| `DialogTracker` list and DAG modes render | `renderDialogTrackerFrames()` captures default list mode, presses `d` through OpenTUI mock input, then captures DAG mode |
| The session route uses shared `/plan` and `/tracker` command options | `sessionPlanTrackerCommandOptions(...)` lives in `src/cli/cmd/tui/routes/session/plan-tracker-command-options.tsx`; the session route spreads those options into its command registration |
| `/plan`, `/tracker`, and `/tasks` dispatch through the real command API | `renderSlashCommandDispatchFrames()` mounts the real `CommandProvider`, registers the shared session command options, calls `triggerSlash(...)`, and captures the resulting DialogPlan/DialogTracker frames |
| No product model calls are made | `script/tui-render-proof.tsx` has no LLM/API imports; `bun test` confirms no network egress |
| No external network calls during render proof | All `fetch` and RPC paths are absent from the render proof call graph |
| Real TypeScript source is exercised (not stubs) | Modules are imported via `import()` from `src/cli/cmd/tui/routes/session/` |
| Launcher resolves source paths correctly | `test/launcher.test.ts` asserts `localSourceRoot` and `resolveLaunchTarget` |
| Known startup failure patterns are caught | `tui-launch-smoke.ts` scans stdout/stderr against a blocklist of failure patterns and reports silent non-TTY exits as inconclusive |
| TUI launch path can be exercised in a pseudo-terminal | `bun-pty` spawns the source launcher with `isTTY=true`; raw ANSI output is captured for inspection |
| Terminal output is not overclaimed | `pty-proof-summary.json` reports `INCONCLUSIVE (terminal init only)` unless cleaned output contains visible frame text, border characters, or an OpenCode/OpenTUI marker |

### What the PTY proof does NOT prove

| Limitation | Reason |
|---|---|
| Slash commands (/plan, /tracker) are not triggered via PTY input | These are UI-level operations handled by the Solid command dialog and dispatched via internal RPC (`sdk.client.session.command()`), not text-based shell commands |
| Live command-palette typing is not driven end-to-end | The render proof drives `CommandProvider.triggerSlash(...)` directly; it does not simulate keystrokes through the full prompt text input and palette UI |
| Full keyboard navigation is not exercised | PTY captures raw output; interactive keybind handling requires `testRender` harness |
| PTY frame rendering is not currently proven on this Windows run | The launcher emitted terminal initialization escapes and exited cleanly, but did not emit visible frame text, border characters, or OpenCode/OpenTUI markers |
| Non-TTY launch smoke does not prove visible UI rendering | On this Windows run, the non-TTY spawn exited silently, so the script reports `INCONCLUSIVE (non-TTY silent exit)` instead of a false pass or false crash |
| Provider/model routing is not exercised | `OPENCODE_PURE=1` disables external providers |

The render proof (`tui-render-proof.tsx`) covers visible dialog rendering and slash dispatch through `CommandProvider.triggerSlash(...)`. The PTY proof currently covers launch/terminal initialization capture and intentionally reports inconclusive when no visible frame is captured.

---

## What Is Mocked

| Module | Mock behavior |
|---|---|
| `@tui/context/sync` | `useSync()` returns a fixed deterministic `syncData` object; `getRootSessionID()` walks a static session tree |
| `@tui/context/theme` | `useTheme()` returns a hardcoded theme; `selectedForeground()` returns a fixed RGBA |
| `@tui/ui/dialog` / `../../ui/dialog` | `useDialog()` returns a deterministic proof dialog; direct renders use no-op behavior, slash-dispatch renders capture `dialog.replace(...)` output |
| `@tui/ui/toast` | `useToast()` returns no-op `show()` and `error()` |
| `@tui/ui/dialog-select` | A static `DialogSelect` that renders up to 6 options as plain text rows (real keyboard machinery not exercised) |
| `@tui/util/clipboard` | `Clipboard.copy()` is a no-op |
| `@/skill/registry` | `SkillRegistry.isLoaded()` returns `true` only for `typescript` and `solid` |

TUI contexts (sync state, theme, dialog overlay, toast, clipboard) are mocked with static data. **The dialog components themselves are real.**

---

## What Remains Future Work

- **Real TUI context injection** - `syncData` is handcrafted; a future proof could derive it from an actual session DB snapshot
- **DialogSelect full behavior** - current mock renders static rows; live keyboard navigation through DialogSelect is not exercised
- **Launcher smoke on non-Windows** - the smoke test uses `taskkill /T /F` on Win32; POSIX equivalents are stubbed but not CI-verified here
- **Integration with real session/agent lifecycle** - this proof deliberately stops at the dialog module boundary; full session start/stop is out of scope
- **Prompt-input slash typing** - the proof drives `triggerSlash(...)`; typing `/plan` into the full prompt input and selecting from the palette remains future work
- **PTY proof on non-Windows** - `bun-pty` PTY support may vary across platforms; POSIX verification pending

---

## Verification

```powershell
# Read the proof summary
Get-Content -Raw tmp/tui-render-proof/real-dialog-proof-summary.json

# Read the DialogPlan frame
Get-Content -Raw tmp/tui-render-proof/dialog-plan-frame.txt

# Read the DialogTracker list frame
Get-Content -Raw tmp/tui-render-proof/dialog-tracker-frame.txt

# Read the DialogTracker DAG frame
Get-Content -Raw tmp/tui-render-proof/dialog-tracker-dag-frame.txt

# Read the slash-command wiring proof
Get-Content -Raw tmp/tui-render-proof/slash-command-wiring.json

# Read the slash-command dispatch proof
Get-Content -Raw tmp/tui-render-proof/slash-command-dispatch.json

# Optional visual proof captured from the HTML artifact
Start-Process tmp/tui-render-proof/real-dialog-proof.png

# Read the smoke verdict
Get-Content -Raw tmp/tui-launch-smoke/smoke.log

# Read the PTY proof summary
Get-Content -Raw tmp/tui-pty-proof/pty-proof-summary.json

# Read the PTY frame sample
Get-Content -Raw tmp/tui-pty-proof/pty-frame-sample.txt
```

The `real-dialog-proof-summary.json` includes a `productModelCalls: false` field confirming the no-model constraint.
The `pty-proof-summary.json` includes `hasBorderCharacters` and `hasOpenTuiMarker` fields so the PTY script can distinguish visible UI evidence from terminal initialization only.

---

## Coordination

This proof path was cleaned up under the main Codex lane after the OpenCodex restoration slice was claimed on switchboard.
