# What I Changed vs Upstream

OpenCodex is a fork of upstream OpenCode. This file lists what the fork adds or
changes on top of upstream, with the exact implementation paths. Everything not
listed here is inherited upstream code.

## How this was determined

The fork's file tree was compared blob-by-blob against upstream OpenCode tags.
The closest match is upstream **v1.3.15** (tagged 2026-04-04): 4,261 of the
fork's 5,073 files are byte-identical to it. The exact upstream commit the fork
was cut from is not recorded in this repo's history, so treat the boundary as
"upstream v1.3.15 plus a small amount of upstream drift", and the files below as
the fork's own additions. (Note: upstream's repo has since moved from
`sst/opencode` to `anomalyco/opencode`.)

"NEW" = file does not exist upstream. "MODIFIED" = upstream file with fork
edits. Counts below come from that comparison.

## 1. Task DAGs and scheduler lanes

Dependency-aware task orchestration: `depends_on`, routed scheduler lanes,
background dispatch, failed/canceled/missing dependency handling.

- MODIFIED `packages/opencode/src/tool/task.ts` (upstream had a small task
  tool; the fork's version implements the DAG/lane machinery)
- NEW `packages/opencode/test/tool/task-dependencies.test.ts`
- NEW `packages/opencode/test/tool/task-lane.test.ts`
- NEW `packages/opencode/test/scheduler/` (6 files)

## 2. Durable tracker state

A persistent task tracker exposed as tools (`tracker_create_task`,
`tracker_update_task`, `tracker_add_artifact`, `tracker_get_task`,
`tracker_list_tasks`, `tracker_add_dependency`, `tracker_visualize`,
`tracker_delete_task`, `tracker_dag_unblock`).

- NEW `packages/opencode/src/tool/tracker.ts`
- NEW `packages/opencode/src/tracker/` (materialize.ts, service.ts, types.ts)
- NEW `packages/opencode/test/tool/tracker.test.ts`
- NEW `packages/opencode/test/tracker/` (dag-scheduler, service,
  skill-unblocking tests)
- NEW TUI: `packages/opencode/src/cli/cmd/tui/routes/session/dialog-tracker.tsx`,
  `split-view-tracker.tsx`, `plan-tracker-command-options.tsx`

## 3. Semantic retrieval and compaction

Hybrid lexical + embedding/rerank retrieval with intent routing and
local/remote policies; embedding-ranked chunks injected into compaction
summaries ("compaction baton").

- NEW `packages/opencode/src/retrieval/` (13 files, incl. `baton.ts`)
- MODIFIED `packages/opencode/src/session/compaction.ts` (baton injection)
- NEW `packages/opencode/test/retrieval/` (6 files, incl. `baton.test.ts`)

## 4. Deterministic TUI proof

Renders the real Plan/Tracker dialogs headlessly (no model, no network) and
saves the frames as reviewable artifacts, instead of screenshots.

- NEW `packages/opencode/script/tui-render-proof.tsx`
- NEW `packages/opencode/test/cli/tui-render-proof.test.tsx`
- NEW `packages/opencode/docs/proof-artifacts/tui-render/`
- NEW TUI plan surface:
  `packages/opencode/src/cli/cmd/tui/routes/session/dialog-plan.tsx`,
  `split-view.tsx`, `header-nav.ts`, `sidebar-state.ts`
- NEW `packages/opencode/src/session/plan-state.ts` (durable plan state)
- MODIFIED `packages/opencode/src/cli/cmd/tui/context/sync.tsx` (plan-state sync)
- MODIFIED `packages/opencode/src/server/routes/session.ts` (plan-state routes)

## 5. Self-editing harness (research, opt-in)

Experimental: proposal state, confidence research, healer, review parsing,
verification plans, shadow self-edit execution. Explicitly review-required,
not always-on.

- NEW `packages/opencode/src/harness/` (41 files)
- NEW `packages/opencode/test/harness/` (33 files)
- NEW `packages/opencode/script/harness-model-smoke.ts`
- NEW docs: `docs/harness/`, `docs/next-gen-harness-principles.md`,
  `docs/qwen3-retrieval-model-notes.md`, `docs/subagent-model-notes.md`

## 6. Stateful workbench

Per-session Node child-process kernel (top-level await, console capture,
timeouts, `reset_runtime`) plus ephemeral helper-file management
(`workbench` / `synthesize` tools), a shared blackboard, and semantic-memory
status tools.

- NEW `packages/opencode/src/tool/workbench.ts`
- NEW `packages/opencode/src/tool/node_repl.ts`
- NEW `packages/opencode/src/tool/synthesize.ts`
- NEW `packages/opencode/src/tool/blackboard.ts`
- NEW `packages/opencode/src/tool/recall.ts`
- NEW `packages/opencode/src/tool/retrieval_status.ts`
- MODIFIED `packages/opencode/src/tool/registry.ts` (registers the new tools)
- NEW tests: `test/tool/workbench.test.ts`, `blackboard.test.ts`,
  `synthesize.test.ts`, `retrieval_status.test.ts`

## 7. Docs, skills, launchers, audit notes

- NEW `docs/architecture/`, `docs/semantic-substrate-*.md`,
  `docs/opencodex-runtime-surface.md`, `docs/opencodex-publish-workflow.md`,
  `docs/recruiter-quickstart.md`
- Root audit notes: `PERFORMANCE_SWEEP_FINDINGS.md`,
  `SWEEP_CONSOLIDATED_FINDINGS.md`, `CLI_LAYER_SWEEP_FACTS.md`, etc.
- `opencode-dev.ps1` launcher, `Opencodex` launcher entry

## 8. Fork infrastructure (this change set)

- `package.json`: added an `overrides` pin for
  `@effect/platform-node-shared` at `4.0.0-beta.43` so a fresh
  `bun install` resolves consistently with the catalog (fixes the
  `effect/Context` module error on clean installs)
- `.github/workflows/opencodex.yml`: CI scoped to the fork surface
  (typecheck + focused tests), separate from upstream workflows

## Explicitly NOT fork work

- The rest of the tree (~4,261 files byte-identical to upstream v1.3.15):
  the full TUI, providers, server, CLI commands, SDK, web app, and all
  upstream tests. Do not cite upstream test counts or workflow runs as
  evidence for the fork's features.
- The inherited `.github/workflows/` (e.g. `test.yml`, `typecheck.yml`)
  target upstream's `dev` branch and PRs; they do not run on this fork's
  `opencode-fork` branch pushes. Their status says nothing about the
  fork's changes. Fork CI is `opencodex.yml` only.
