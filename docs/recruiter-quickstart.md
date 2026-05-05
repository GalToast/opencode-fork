# OpenCodex Recruiter Quickstart

This is the shortest inspection path for the McCullough Digital OpenCodex fork. It helps a reviewer quickly separate fork-specific systems work from upstream OpenCode.

## Upstream Boundary

OpenCodex is built on the upstream OpenCode foundation. McCullough Digital maintains this fork to explore additional agent orchestration, durable state, retrieval, proof, and harness surfaces. Treat upstream installation, provider, and platform notes as inherited baseline context unless a linked OpenCodex document or source path calls out fork-specific work.

## What This Shows

OpenCodex is a systems-oriented AI coding workbench for long-horizon, human-in-the-loop software work. The strongest evidence is in coordination and runtime surfaces: task DAGs, durable tracker state, semantic retrieval and compaction, deterministic TUI proof artifacts, a stateful agent workbench runtime, and self-editing evaluation harnesses with explicit caveats.

## Inspect First

| Area | Why it matters | Start here |
| --- | --- | --- |
| Fork feature guide | Gives the fastest overview of changed behavior and caveats. | [packages/opencode/README.md](../packages/opencode/README.md) |
| Runtime surface inventory | Lists fork-specific tools, harnesses, and boundaries. | [opencodex-runtime-surface.md](opencodex-runtime-surface.md) |
| Stateful workbench | Shows persistent Node-backed agent sessions and helper creation. | `../packages/opencode/src/tool/workbench.ts`, `../packages/opencode/src/tool/node_repl.ts`, `../packages/opencode/test/tool/workbench.test.ts` |
| Durable tracker | Shows persistent task state and tool-facing coordination. | `../packages/opencode/src/tool/tracker.ts`, `../packages/opencode/test/tool/tracker.test.ts` |
| Task DAG orchestration | Shows dependency-aware task behavior and verification coverage. | `../packages/opencode/src/tool/task.ts`, `../packages/opencode/test/tool/task-dependencies.test.ts` |
| Semantic retrieval | Shows retrieval policy, rerank, runtime, and compaction baton work. | `../packages/opencode/src/retrieval/` |
| Self-editing harness | Shows the experimental healer, reviewer, confidence, and shadow-workspace systems. | `../packages/opencode/src/harness/` |
| TUI proof artifacts | Shows deterministic terminal rendering proofs and related tests. | `../packages/opencode/docs/proof-artifacts/tui-render/`, `../packages/opencode/test/cli/tui-render-proof.test.tsx` |

## Local Source Check

Use the source tree when evaluating OpenCodex-specific changes. The upstream package manager and install commands may resolve baseline OpenCode instead of this branch.

```bash
git clone https://github.com/GalToast/opencode-fork.git
cd opencode-fork
git checkout opencode-fork
bun install
bun run --cwd packages/opencode typecheck
bun run --cwd packages/opencode dev
```

For a broad monorepo typecheck, run `bun run typecheck` from the repository root.

## Reading The TUI Proof

The TUI proof artifacts are controlled test outputs, not marketing screenshots. Review the saved render artifacts beside `../packages/opencode/test/cli/tui-render-proof.test.tsx` to see what state was rendered, what the test expected, and how terminal UI behavior is kept inspectable during changes.

## Verification Snapshot

Recent checks for the current publish-prep branch:

- Focused tool-surface test batch passed with no failures.
- `bun run typecheck` in `packages/opencode` passed.
- Compact publish worktree package typecheck passed.
- Pre-push monorepo typecheck hook passed.

## Boundaries

- Self-editing harnesses are active development surfaces and should be treated as opt-in, review-required research systems.
- Live TUI capture and replay are still being hardened; deterministic proof artifacts are the stronger current evidence.
- Local embeddings, model smoke tests, and some provider flows may require credentials or model files that are not committed to the public repo.
- The upstream installation commands in the root README are kept for baseline OpenCode compatibility. Inspect or build this repository when evaluating OpenCodex-specific systems work.

## Strongest Conversation Hooks

- Stateful agent workbench runtime with persistent Node-backed sessions.
- Durable task tracker and dependency-aware task DAG orchestration.
- Semantic retrieval and compaction baton support for longer coding sessions.
- Deterministic TUI proof artifacts instead of only screenshots.
- Documentation that separates proven surfaces from active research.
