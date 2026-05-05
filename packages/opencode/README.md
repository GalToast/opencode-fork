# OpenCodex by McCullough Digital

> A systems-oriented AI coding workbench built around task DAGs, scheduler lanes, semantic retrieval, stateful agent runtime, and self-editing evaluation loops.

## What This Is

OpenCodex is a fork of OpenCode that adds or restores subsystems for orchestrating multi-turn coding work. Human-in-the-loop operator controls mean session routes, plan state, and permission surfaces that let a person supervise, pause, redirect, and verify active agent work. This README presents the current restored fork honestly: focused proofs are strong, `packages/opencode` typecheck and TUI lint are currently clean, while live TUI capture remains active hardening work. The key additions over upstream are:

### Subagent Orchestration
- **Task DAGs** - tasks declare explicit `depends_on` relationships; the scheduler skips dispatch while unmet dependencies exist and propagates `failed`/`canceled`/`missing` state upstream.
- **Scheduler lanes** - task turns route through named lanes (`subagent_tasks`, `orchestrator`, `adversarial_review`, `healer`, etc.) with per-lane concurrency limits and root fairness. `dispatchTurns()` submits routed task turns with `getEffectiveDispatchLane(job.schedulerLane)`.
- **Subagent model routing** - task dispatch resolves agent roles (including Codex-style aliases like `worker`/`default` -> `general`, `explore` -> `explore`) and supports model pinning per task/session.

### Semantic Retrieval & Compaction
- **Retrieval substrate** - hybrid lexical + semantic search over session messages, plans, tool outputs, task artifacts, and code chunks. Queries are routed by intent classification (`file`, `decision`, `recovery`, `task_pattern`, `compaction`, `evidence`) with prompt-preset and instruction-routed variants.
- **Semantic compaction baton** - before context overflow, session messages are embedded and reranked; the top-ranked chunks are injected into the summary prompt so durable technical anchors survive compaction.
- **Multiple retrieval policies** - `auto`, `fast`, `quality`, `local`, `isolated`. The `auto` policy routes to task-tuned or quality-tuned variants based on query intent. Local policies use `qwen3-embedding-0.6b` / `qwen3-reranker-0.6b` GGUF models with synthetic fallback when remote embedding is unavailable.
- **Retrieval harnesses** - `retrieval-quality-benchmark.ts` runs 12 seeded scenarios across 22 policy variants and reports top-1 accuracy, top-3 recall, and mean reciprocal rank per variant and per intent category.

### Self-Editing Feedback Loops (Harness)
- **Proposal state** - staged self-improvement proposals with `low`/`medium`/`high` confidence, effective confidence climbing, and cooldown-throttled research. Proposals declare target files, patch summaries, and risk classification.
- **Confidence research** - `HarnessConfidence.researchProposal(...)` runs a read-only harness session against the source files, promotes confidence when at least two evidence points support it, and narrows the declared file scope if needed. It uses the `healer` lane.
- **Healer** - on patch generation or review failure, the healer retries generation or proposes targeted repair with mode (`continue`/`stage_only`), prompt notes, and retry model hints.
- **Review** - a separate model reviews patches against the `VERIFY` contract and returns `APPROVE`/`REJECT` with concrete concerns. The reviewer lane is finish-now/no-prose/no-future-verification.
- **Self-edit execution** - shadow-workspace isolation with `applyLive:false` verification, artifact inspection, and live source preservation guards.
- **Blackboard** - shared working memory for multi-agent task coordination.
- **Stateful agent workbench** - registered `workbench` tool with a persistent per-session JavaScript runtime and create/list/inspect/replace/delete flow for ephemeral helper tools.
- **Counterpressure and seat-delegation** - harness fixtures for benchmarking solo vs. parallel vs. delegate vs. context-gathering decision quality.

### Runtime Surface Inventory
- **Coordination tools** - `task`, `tracker_*`, `todowrite`/`todoread`, and `blackboard_*` are registered runtime surfaces, not just implementation details. They cover dependency-aware delegation, durable task graphs, session-scoped todos, and shared lane memory.
- **Workbench and helper synthesis** - `workbench` provides persistent session JavaScript execution through a Node child-process kernel plus ephemeral TypeScript helper lifecycle management. `synthesize` / `synthesize_tool` support reusable session-local helper tools.
- **Semantic memory tools** - `recall` and `retrieval_status` expose retrieval state alongside the retrieval subsystem and semantic compaction baton.
- **Skill loading** - `skill` ranks, filters, and loads local `SKILL.md` bundles into the session.
- **Core editing/search tools** - the fork keeps the normal file, patch, shell, web, and code search tool surface while adding OpenCodex coordination layers.
- **Gated experimental tools** - `batch`, `lsp`, and `plan_exit` are registered only when their feature flags or config gates are active.
- **Recovery and analysis utilities** - gap detection, semantic decision helpers, snapshot revert, diagnostics, and dependency explorer live in source but are documented separately when they are not default callable tools.

See [../../docs/opencodex-runtime-surface.md](../../docs/opencodex-runtime-surface.md) for the source-backed inventory used to prevent README drift.

### TUI and Launch Proof
- **TUI render proof** - deterministic no-model capture of the real `DialogPlan` and `DialogTracker` Solid components with mocked TUI contexts. Produces committed character-frame, HTML, PNG, and slash-command dispatch artifacts under `docs/proof-artifacts/tui-render/`.
- **Launch smoke** - spawns the source launcher and scans stdout/stderr against a blocklist of failure patterns.
- **PTY proof** - pseudo-terminal capture of launcher ANSI output; reports inconclusive when only terminal initialization is present and no visible frame is detected.
- These proofs do not yet exercise full live TUI keyboard navigation or real session context injection.

## Quick Start

```bash
# Install
bun install

# Run the TUI through the source launcher
bun run src/launcher.ts
# or, after building/installing the local shim
opencodex

# Run focused checks
bun run typecheck
bun run lint:tui
bun test test/tool/task-dependencies.test.ts --timeout 30000
bun test test/scheduler/root-fairness.test.ts --timeout 30000
bun test test/cli/tui-render-proof.test.tsx --timeout 120000

# Run the render proof directly (no model, no network)
bun run script/tui-render-proof.tsx

# Run auth-gated harness smoke with the most recently recorded passing live model path
OPENCODE_SMOKE_MODE=session-only OPENCODE_HARNESS_MODEL=alibaba-coding-plan/qwen3.5-plus bun run script/harness-model-smoke.ts
```

## Project Layout

```
src/
  agent/agent.ts          - agent registry (build, plan, explore, general, compaction, ...)
  harness/                - self-editing feedback loop
    healer.ts             - patch generation/review retry with staged repair
    confidence.ts         - confidence research, climbing, throttling
    review.ts             - harness review with VERIFY contract
    self-edit.ts          - shadow workspace execution and artifact inspection
    blackboard.ts         - shared working memory
    seat-delegation-*.ts  - solo/parallel/delegate decision benchmarks
    retrieval-quality-*.ts - retrieval policy benchmarking
    state.ts              - proposal and observation state
  retrieval/
    index.ts              - RetrievalService: hybrid search, upsert, session indexing
    policy.ts             - named policies (fast, quality, auto, local, isolated)
    prompt.ts             - intent classification and instruction routing
    baton.ts              - semantic compaction baton and candidate ranking
    rerank.ts             - reranking pipeline
    runtime.ts           - embedding runtime with local/synthetic fallback
  session/
    compaction.ts         - semantic compaction with baton injection
    processor.ts          - prompt loop and continuation logic
  tool/
    task.ts               - task DAG, scheduler lane dispatch, depends_on
    tracker.ts            - durable task graph facade
    blackboard.ts         - shared coordination state tools
    workbench.ts          - persistent runtime and ephemeral helper creation
    node_repl.ts          - Node child-process kernel used by workbench exec
    synthesize.ts         - session-local helper tool generation
    skill.ts              - local skill bundle ranking and loading
  cli/cmd/tui/
    routes/session/       - DialogPlan, DialogTracker, permission dialogs
    component/prompt/     - prompt input
    plugin/runtime.ts     - command registration and trigger
script/
  tui-render-proof.tsx    - no-model dialog render capture
  tui-pty-proof.ts       - PTY launch capture
  tui-launch-smoke.ts    - launcher failure pattern detection
test/
  tool/task-dependencies.test.ts
  scheduler/root-fairness.test.ts
  scheduler/soak.test.ts
  cli/tui-render-proof.test.tsx
```

## Caveats

- **Production stability** - the harness self-editing loop (review, healer, shadow apply) has focused smoke tests passing, but full end-to-end hardening is still active development. The live harness smoke script requires approved model credentials; it is not a vanilla CI proof. Do not rely on it as the sole gate for untrusted code.
- **TUI on Windows** - the TUI render proof (no-model, no-network) passes reliably. PTY and non-TTY launch capture currently report inconclusive on Windows because the launcher emits terminal initialization escapes but not visible frame output. Live TUI render proof requires the render harness; do not claim full TUI correctness until the live capture path matures.
- **Validation** - in `packages/opencode`, `bun run typecheck` and `bun run lint:tui` are currently clean. Full live model/harness smoke still depends on local credentials and provider quota.
- **Retrieval embeddings and benchmarks** - local policies require GGUF model files. Remote policies require provider credentials with sufficient quota for embedding and reranking calls. The 22-variant retrieval harness count includes named policy sweeps; `retrieval-quality-benchmark.ts` is deterministic scoring, while substrate and trace replay benchmarks exercise the SQLite-backed retrieval path.
- **No live session context in proof** - the render proof uses handcrafted mock sync data. A production proof would derive it from a real session DB snapshot.
- **Secrets** - API keys are expected to come from environment/user config outside the repo, not from tracked source files.

## Comparison to Upstream OpenCode

| Feature | OpenCode | OpenCodex (this fork) |
|---|---|---|
| Task tool | Basic | Task DAGs with `depends_on`, failure propagation, scheduler lanes |
| Subagent dispatch | Blocking default | Background default; Codex alias compatibility |
| Semantic retrieval | - | Hybrid lexical + embedding + rerank, 6 intent categories, local/remote GGUF |
| Compaction | Token-based prune | Semantic baton: embedding-ranked chunks injected into summary |
| Harness | Removed | Restored: proposals, confidence research, healer, review, self-edit |
| Blackboard | - | Shared multi-agent working memory |
| Workbench tool | - | Persistent runtime plus ephemeral helper tools for session-local experimentation |
| Seat-delegation benchmarking | - | Solo/parallel/delegate/collect-more-context decision benchmarking |
| Retrieval quality harness | - | 12 seeded scenarios x 22 policy variants with MRR/top-1/top-3 reporting |
| TUI proof | - | Render and launch smoke proofs with committed frame artifacts; PTY capture currently reports inconclusive on Windows when only terminal initialization is emitted |
| Model routing | - | Prompt-preset and instruction-routed `auto` policy; healer lane integration |

## License

Same as upstream OpenCode.
