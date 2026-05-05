# OpenCodex Proof & Caveats - Technical Reviewer Reference

**Scope:** This document is a living proof record for technical reviewers.
It lists what is currently proven, exact commands that passed recently, what each proof demonstrates, and what is intentionally not claimed yet.
**Do not expose, store, or print secrets or credentials.**

---

## Proven: TUI Dialog Modules (no-model, no-network)

### What

Real DialogPlan and DialogTracker TypeScript modules are imported and rendered under a deterministic mock harness. No model calls, no network egress.

### Commands

```
# Render proof - writes char frames + HTML proof to tmp/tui-render-proof/
bun run script/tui-render-proof.tsx

# Unit proof - runs render proof as a Bun test
bun test test/cli/tui-render-proof.test.tsx --timeout 120000
```

### Demonstrates

| Claim | How |
|---|---|
| Real DialogPlan and DialogTracker modules render without crashing | testRender() from @opentui/solid mounts each component; captureCharFrame() extracts output |
| DialogTracker list and DAG modes render | renderDialogTrackerFrames() captures default list mode, presses d via OpenTUI mock input, captures DAG mode |
| Session route uses shared /plan and /tracker command options | sessionPlanTrackerCommandOptions(...) lives in src/cli/cmd/tui/routes/session/plan-tracker-command-options.tsx; source verified |
| /plan, /tracker, and /tasks dispatch through the real command API | renderSlashCommandDispatchFrames() mounts CommandProvider, calls triggerSlash(...), captures resulting DialogPlan/DialogTracker frames |
| No product model calls | Render proof has no LLM/API imports; network egress absent from call graph |
| Real TypeScript source (not stubs) | Modules imported via import() from src/cli/cmd/tui/routes/session/ |

### Artifacts

| File | Location |
|---|---|
| dialog-plan-frame.txt | docs/proof-artifacts/tui-render/ |
| dialog-tracker-list-frame.txt | docs/proof-artifacts/tui-render/ |
| dialog-tracker-dag-frame.txt | docs/proof-artifacts/tui-render/ |
| slash-command-wiring.json | docs/proof-artifacts/tui-render/ |
| slash-command-dispatch.json | docs/proof-artifacts/tui-render/ |
| real-dialog-proof.png | docs/proof-artifacts/tui-render/ |
| real-dialog-proof.html | docs/proof-artifacts/tui-render/ |
| real-dialog-proof-summary.json | docs/proof-artifacts/tui-render/ - includes productModelCalls: false |

### What is mocked

TUI contexts only: useSync, useDialog, useToast, useTheme, useKeybind, Clipboard, SkillRegistry, DialogSelect.
**The dialog components themselves are real TypeScript source.**

---

## Proven: TUI Launch (non-TTY smoke)

### What

The source launcher (src/launcher.ts) is spawned, checked for immediate fatal failure patterns, and a non-TTY silent exit is reported as INCONCLUSIVE (not a false pass, not a false crash).

### Command

```
bun run script/tui-launch-smoke.ts
```

### Demonstrates

- Launcher resolves source paths correctly
- Known startup failure patterns are caught (ModuleNotFound, Cannot find module, Worker terminated, etc.)
- Non-TTY silent exit is reported as INCONCLUSIVE (non-TTY silent exit) - this is the correct behavior; the script does not overclaim visible UI proof

### Caveat

- Non-TTY launch smoke does NOT prove visible UI rendering
- On Windows, the TUI writes ANSI escape sequences to stderr; in a non-TTY spawn these appear as raw bytes - this is expected and does not indicate a crash
- Slash commands are UI-level operations, not triggerable through a non-TTY spawn text stream

### Artifact

- tmp/tui-launch-smoke/smoke.log

---

## Proven: TUI Launch (PTY-backed)

### What

The TUI is spawned in a pseudo-terminal (bun-pty), raw ANSI output is captured, and visible frame evidence is reported when present. Otherwise reports INCONCLUSIVE.

### Command

```
bun run script/tui-pty-proof.ts
```

### Demonstrates

- TUI boots in a PTY (isTTY=true) and emits terminal control sequences
- Visible frame evidence (border characters, OpenCode/OpenTUI markers) is captured when present
- Slash commands are not triggered via PTY text input - those are UI-level Solid command dialog operations handled by internal RPC, not shell-style text commands

### Caveat

- PTY proof is currently INCONCLUSIVE on this Windows run because no visible frame text, border characters, or OpenCode/OpenTUI markers were captured - only terminal initialization escapes
- Slash command dispatch requires the testRender harness, not PTY text input
- PTY frame rendering has not been conclusively proven on this run

### Artifact

- tmp/tui-pty-proof/pty-proof-summary.json - includes hasBorderCharacters, hasOpenTuiMarker, verdict

---

## Proven: Task Tool - Dependencies (deterministic)

### What

TaskTool stores depends_on, classifies dependency state (satisfied, blocked, failed), surfaces dependency_missing/failed/canceled in task status output, and marks queued dependent tasks as error when a dependency is missing, failed, or canceled.

### Commands

```
# Deterministic unit tests
bun test test/tool/task.test.ts --timeout 30000
bun test test/tool/task-dependencies.test.ts --timeout 30000
bun test test/tool/task.test.ts test/tool/task-dependencies.test.ts --timeout 30000
```

### Demonstrates

- depends_on is stored on runtime jobs and surfaced in lineage/status
- Chain dependencies (A->B->C) execute in proper sequence
- Multiple-dependency convergence (task waits for ALL before starting)
- Non-existent, canceled, and failed dependency propagation - dependent tasks fail with dependency_state: failed and last_error: Task dependency blocked permanently
- wait_for_result omitted defaults to background dispatch (status: running without blocking main lane)
- Lane routing (orchestrator, adversarial, worker) submits to correct scheduler lanes (orchestrator_swarm, adversarial_review, subagent_tasks)
- Task progress labels (Task status: X, Waiting for task: X) render correctly, not as Unknown Task

### Recent results

- bun test test/tool/task.test.ts test/tool/task-dependencies.test.ts --timeout 30000 passed 15/15
- bun test test/scheduler/root-fairness.test.ts test/scheduler/soak.test.ts --timeout 120000 passed 2/2

---

## Proven: Scheduler Fairness (deterministic)

### What

Root sessions do not monopolize multiple responder slots before queued sibling root sessions start.

### Commands

```
bun test test/scheduler/root-fairness.test.ts --timeout 30000
bun test test/scheduler/root-fairness.test.ts test/scheduler/soak.test.ts --timeout 120000
```

### Demonstrates

- Scheduler enforces fairness across root sessions
- No root occupies multiple responder slots before another queued root starts

---

## Proven: Scheduler Soak (deterministic)

### What

Mixed load autoscales lanes and drains without dropping work; guardrails prevent starvation.

### Command

```
bun test test/scheduler/soak.test.ts --timeout 120000
```

### Demonstrates

- All 40 main + 30 steer + 12 tool + 12 long tasks complete
- Peak main concurrency scales between 2 and 10
- Peak steer concurrency scales between 2 and 12
- Tool and long jobs run alongside busy main lane (no starvation)

---

## Proven: Live Model Harness Smoke (requires approved model)

### What

The full harness pipeline (init -> review -> healer -> self-edit) runs against a live approved model in an isolated shadow workspace. applyLive: false preserves live source. Slash command wiring verified via source inspection.

### Commands

```
# Minimal session-only smoke (no artifacts written)
OPENCODE_SMOKE_MODE=session-only OPENCODE_HARNESS_MODEL=alibaba-coding-plan/qwen3.5-plus bun run script/harness-model-smoke.ts

# Full smoke with shadow workspace
OPENCODE_SMOKE_MODE=full OPENCODE_HARNESS_MODEL=alibaba-coding-plan/qwen3.5-plus bun run script/harness-model-smoke.ts

# Verify applyLive: false preserves live source
OPENCODE_HARNESS_MODEL=alibaba-coding-plan/qwen3.5-plus bun run script/harness-model-smoke.ts
```

### Demonstrates

- Review phase emits VERDICT: APPROVE + SUMMARY + CONCERNS + VERIFY contract
- Healer phase produces repair decision and trace
- Self-edit phase writes shadow workspace artifacts, does NOT apply to live source
- Live source preserved (verified post-run)
- sessionPlanTrackerCommandOptions(...) wiring verified from source

### Model allowlist

Only these are permitted; any other model is rejected:
- alibaba-coding-plan/glm-5
- alibaba-coding-plan/kimi-k2.5
- alibaba-coding-plan/qwen3-coder-plus
- alibaba-coding-plan/qwen3.5-plus
- alibaba-coding-plan/qwen3.6-plus
- minimax-coding-plan/MiniMax-M2.7
- minimax-coding-plan/MiniMax-M2.7-highspeed
- opencode/*free*
- openrouter/*:free

### Caveat

- Live model smoke requires approved model and network access
- PTY/live TUI visual capture is still partial/inconclusive - terminal initialization was captured but no visible frame text, border characters, or OpenCode/OpenTUI markers
- Full repo typecheck remains broad-red from existing fork drift (not claimed here)

---

## Intentionally Not Claimed Yet

| Gap | Reason |
|---|---|
| Repeatable live harness proof across every approved model | Current recorded success is the qwen3.5-plus path; other approved models may be slower or require separate proof |
| Live TUI screenshot capture | PTY proof currently INCONCLUSIVE on this Windows run |
| Full keyboard navigation exercise | Requires testRender harness; PTY does not capture interactive keybind handling |
| Real TUI sync context injection | syncData is handcrafted; future proof could derive from live session DB snapshot |
| DialogSelect full keyboard behavior | Current mock renders static rows; live keyboard navigation not exercised |
| Full repo typecheck | Broad-red from unrelated fork drift; use scoped --filter for touched files |
| POSIX PTY behavior | bun-pty PTY support may vary across platforms; POSIX verification pending |

---

## Quick Verification Commands

```
# TUI render proof (no model)
bun run script/tui-render-proof.tsx
bun test test/cli/tui-render-proof.test.tsx --timeout 120000

# TUI launch smoke (no model, reports INCONCLUSIVE for non-TTY)
bun run script/tui-launch-smoke.ts

# PTY launch proof (no model, reports INCONCLUSIVE if no visible frame)
bun run script/tui-pty-proof.ts

# Task tool deterministic tests
bun test test/tool/task.test.ts test/tool/task-dependencies.test.ts --timeout 30000

# Scheduler deterministic tests
bun test test/scheduler/root-fairness.test.ts test/scheduler/soak.test.ts --timeout 120000

# Live model smoke (requires approved model)
OPENCODE_SMOKE_MODE=session-only OPENCODE_HARNESS_MODEL=alibaba-coding-plan/qwen3.5-plus bun run script/harness-model-smoke.ts

# Read artifacts
Get-Content -Raw docs/proof-artifacts/tui-render/real-dialog-proof-summary.json
Get-Content -Raw tmp/tui-launch-smoke/smoke.log
Get-Content -Raw tmp/tui-pty-proof/pty-proof-summary.json
```
