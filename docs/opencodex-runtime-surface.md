# OpenCodex Runtime Surface

This inventory maps the public README claims to implemented runtime surfaces. It should be refreshed before public publishes by comparing it against `packages/opencode/src/tool/registry.ts`, focused tests, and proof artifacts.

## Registered Tool Surface

`ToolRegistry` exposes the normal OpenCode file/edit/search tools plus OpenCodex coordination and workbench additions.

| Surface | Tool IDs | Evidence |
|---|---|---|
| Task orchestration | `task` | `packages/opencode/src/tool/task.ts`, `packages/opencode/test/tool/task-dependencies.test.ts`, `packages/opencode/test/tool/task-lane.test.ts` |
| Durable task tracker | `tracker_create_task`, `tracker_update_task`, `tracker_add_artifact`, `tracker_get_task`, `tracker_list_tasks`, `tracker_add_dependency`, `tracker_visualize`, `tracker_delete_task`, `tracker_dag_unblock` | `packages/opencode/src/tool/tracker.ts`, `packages/opencode/test/tool/tracker.test.ts` |
| Shared blackboard | `blackboard_set`, `blackboard_get`, `blackboard_append`, `blackboard_increment`, `blackboard_compare_and_swap`, `blackboard_delete`, `blackboard_clear` | `packages/opencode/src/tool/blackboard.ts`, `packages/opencode/src/harness/blackboard.ts`, `packages/opencode/test/tool/blackboard.test.ts` |
| Session workbench | `workbench` | `packages/opencode/src/tool/workbench.ts`, `packages/opencode/src/tool/node_repl.ts`, `packages/opencode/test/tool/workbench.test.ts` |
| Ephemeral helper creation | `synthesize`, `synthesize_tool` | `packages/opencode/src/tool/synthesize.ts`, `packages/opencode/src/tool/registry.ts`, `packages/opencode/test/tool/synthesize.test.ts` |
| Skill loading | `skill` | `packages/opencode/src/tool/skill.ts`, `packages/opencode/test/tool/skill.test.ts`, `packages/opencode/test/tool/skill-routing.test.ts` |
| Semantic memory status | `recall`, `retrieval_status` | `packages/opencode/src/tool/recall.ts`, `packages/opencode/src/tool/retrieval_status.ts`, `packages/opencode/test/tool/retrieval_status.test.ts`, `packages/opencode/src/retrieval/` |
| Session todos | `todowrite`, `todoread` | `packages/opencode/src/tool/todo.ts`, `packages/opencode/test/tool/todo.test.ts` |
| Core file and code tools | `read`, `write`, `edit`, `multiedit`, `apply_patch`, `search_replace`, `glob`, `grep`, `list`, `bash`, `webfetch`, `websearch`, `codesearch` | `packages/opencode/src/tool/`, `packages/opencode/test/tool/` |
| Gated tools | `lsp`, `batch`, `plan_exit` | Registered only behind feature flags, config, or CLI client gates in `packages/opencode/src/tool/registry.ts` |

## Workbench Details

The `workbench` tool has two halves:

- `action="exec"` runs JavaScript in a per-session Node child-process kernel from `node_repl.ts`. The kernel supports top-level await, Babel parsing, console capture, timeout handling, and `action="reset_runtime"`.
- `action="create"`, `replace`, `list`, `inspect`, and `delete` manage ephemeral TypeScript helper files under `.opencode/tools/ephemeral_*.ts`, using the same helper-file path as `synthesize_tool`.

The separate `synthesize_tool` is also registered as the `synthesize` alias in `ToolRegistry`, so documentation must keep both the high-level workbench flow and direct helper synthesis visible.

## Runtime Subsystems

| Subsystem | What is implemented | Evidence |
|---|---|---|
| Task DAGs and scheduler lanes | Dependency-aware task start/status/wait, failed/canceled/missing dependency handling, routed lanes for orchestrator/adversarial/general work | `packages/opencode/src/tool/task.ts`, `packages/opencode/test/tool/task-dependencies.test.ts`, `packages/opencode/test/tool/task-lane.test.ts`, `packages/opencode/test/scheduler/` |
| Semantic retrieval | Hybrid lexical plus embedding/rerank search, intent routing, local/remote policies, synthetic fallback | `packages/opencode/src/retrieval/`, `packages/opencode/test/retrieval/` |
| Semantic compaction baton | Embedding-ranked chunks injected into compaction summaries | `packages/opencode/src/session/compaction.ts`, `packages/opencode/src/retrieval/baton.ts`, `packages/opencode/test/retrieval/baton.test.ts` |
| Harness feedback loop | Proposal state, confidence research, healer, review parsing, verification plans, shadow self-edit execution, hotswap notices | `packages/opencode/src/harness/`, `packages/opencode/test/harness/` |
| TUI proof surface | Deterministic render proof for Solid TUI components, launch smoke, PTY proof with Windows caveat | `packages/opencode/script/tui-render-proof.tsx`, `packages/opencode/test/cli/tui-render-proof.test.tsx`, `packages/opencode/docs/proof-artifacts/tui-render/` |
| External CLI delegation wrappers | Archived Claude/Gemini/Qwen read-only and edit-capable wrapper scripts with process-tree timeout handling | `packages/opencode/script/external-cli/` |

## Source Utilities Not Advertised As Always-On Tools

Some source files implement useful analysis or recovery helpers but are not in the always-on `ToolRegistry` list. Do not describe them as currently exposed tools unless they are registered or wired into another public path.

| Utility | Current status | Evidence |
|---|---|---|
| Gap detection | Source utility for noticing repeated failures or missing compound tools; not listed in `ToolRegistry` | `packages/opencode/src/tool/gap-detector.ts` |
| Semantic decision / precedent | Source utilities for precedent-aware task decisions; not listed in `ToolRegistry` | `packages/opencode/src/tool/semantic-decision.ts`, `packages/opencode/src/tool/semantic-precedent.ts` |
| Snapshot revert and diagnostics | Source utilities supporting snapshot restoration and LSP diagnostics; not listed in the default registry surface | `packages/opencode/src/tool/snapshot_revert.ts`, `packages/opencode/src/tool/diagnostics.ts` |
| Dependency explorer | Source utility with focused tests; not listed in the default registry surface | `packages/opencode/src/tool/dependency_explorer.ts`, `packages/opencode/test/tool/dependency_explorer.test.ts` |

## Documentation Gate

Before publishing recruiter-facing updates:

1. Scan `packages/opencode/src/tool/registry.ts` and ensure every OpenCodex-specific registered tool has a README home.
2. Link each public claim to a source path, focused test, benchmark, or proof artifact.
3. Keep experimental and credential-gated surfaces explicitly caveated.
4. Run at least `bun run typecheck`, `bun run lint:tui`, and focused tests for any newly emphasized feature.
5. Confirm the sanitized publish branch does not stage local-only model payloads, temp files, or private diagnostics.
