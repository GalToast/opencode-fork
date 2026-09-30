# OpenCodex in 5 Minutes

OpenCodex is a fork of upstream OpenCode that adds agent orchestration
surfaces: task DAGs, a durable task tracker, semantic retrieval/compaction,
a stateful workbench, and deterministic TUI proofs. This page is the
shortest path to seeing the fork's own code actually run.

For the full file-by-file map of what the fork adds vs upstream, see
[what-i-changed.md](what-i-changed.md).

## Proof path (no API keys, no network calls by the demo itself)

Prerequisites: [bun](https://bun.sh) 1.3.11+.

```bash
git clone https://github.com/GalToast/opencode-fork.git
cd opencode-fork
git checkout opencode-fork
bun install --frozen-lockfile
```

Then run the one demo command (from the repo root):

```bash
bun run --cwd packages/opencode script/tui-render-proof.tsx
```

What this does: it renders the fork's real Plan and Tracker TUI dialogs
headlessly — no model, no network — and prints the frames to your terminal.
You should see output starting with:

```
=== DialogPlan ===
     Plan
     Status: Awaiting Approval
...
=== DialogTracker ===
     Tracker  |  [L]ist / [D]AG
...
```

It also writes the proof artifacts to
`packages/opencode/tmp/tui-render-proof/` (frames as text, slash-command
wiring and dispatch results as JSON). Open
`packages/opencode/tmp/tui-render-proof/dialog-tracker-dag-frame.txt` to see
the tracker in DAG mode.

The whole path — clone, install, demo — takes under five minutes on a
typical connection.

## What to look at next

| If you want... | Start here |
|---|---|
| The feature/file map vs upstream | [what-i-changed.md](what-i-changed.md) |
| Task DAGs (dependency-aware orchestration) | `packages/opencode/src/tool/task.ts`, `packages/opencode/test/tool/task-dependencies.test.ts` |
| Durable tracker | `packages/opencode/src/tool/tracker.ts`, `packages/opencode/test/tool/tracker.test.ts` |
| Semantic retrieval + compaction baton | `packages/opencode/src/retrieval/`, `packages/opencode/test/retrieval/` |
| Stateful workbench | `packages/opencode/src/tool/workbench.ts`, `packages/opencode/test/tool/workbench.test.ts` |
| Runtime surface inventory | [opencodex-runtime-surface.md](opencodex-runtime-surface.md) |

## Verification

Fork CI (`.github/workflows/opencodex.yml`) runs `bun run typecheck` in
`packages/opencode` plus the focused tests for the fork's additions on every
push to the `opencode-fork` branch. The inherited upstream workflows
(`test.yml`, `typecheck.yml`) target upstream's `dev` branch and do not run
here — their status is not evidence for this fork.

## Boundaries

- The self-editing harness (`packages/opencode/src/harness/`) is active
  research: opt-in and review-required, not a finished product.
- Some provider/model flows need credentials that are not in this repo.
