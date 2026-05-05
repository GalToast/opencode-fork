# Builtin Tool Audit Matrix - 2026-03-29

This is the repo-wide source of truth for the builtin tool audit in `packages/opencode`.

It supersedes the tranche-local matrices as the current ownership view because the tranche docs are intentionally historical snapshots. When a tranche note and this matrix disagree, trust the current code plus this file.

## Scope

- Registry source: `src/tool/registry.ts`
- Capability/composition source: `src/capability/runtime.ts`, `src/tool/capability.ts`
- Prompt/system source: `src/session/system.ts`, `src/session/prompt/codex_header.txt`, `src/session/prompt/anthropic.txt`, `src/session/prompt/anthropic-20250930.txt`, `src/session/prompt/gemini.txt`, `src/session/prompt/alibaba.txt`, `src/session/prompt/qwen.txt`
- Verification source: focused suites in `test/tool/`, `test/session/`, and `test/shell/`

## Cross-tranche reconciliation

- Tranche 5 correctly fixed the `planning` family drift, but the same capability taxonomy had also drifted for `files`, `patching`, and `coordination`. The runtime and description layers now match the modern registry surface for `list`, `multiedit`, `search_replace`, `todoread`, and `tracker_seed_from_decomposition`.
- Tranche 1's initial matrix called out missing direct todo coverage, but the final tranche body already fixed that gap in `test/tool/todo.test.ts`. The global matrix records the current green state instead of the stale initial scan.
- Tranche 2 grouped `recall` and `retrieval_status` together. That is still directionally correct, but tranche 7 had to come back and add the missing direct `retrieval_status` contract suite so the status surface is no longer riding only on surrounding retrieval plumbing.
- Several builtin families never received explicit tranche ownership even though they are in the registry: `invalid`, `question`, `webfetch` / `websearch` / `codesearch`, `workbench` / `node_repl` / `synthesize`, `snapshot_revert`, `batch`, and `lsp`. This matrix gives each of them an explicit closure status and residual-risk read.
- `anthropic-20250930.txt` is currently a checked-in prompt artifact, not a provider prompt selected by `src/session/system.ts`. It still matters for prompt drift review, but it should not be mistaken for live provider routing.

## Matrix

| Family | Builtins | Prompt coverage | Direct tests | Capability gating / exposure | Tranche status | Residual risk |
| --- | --- | --- | --- | --- | --- | --- |
| Invalid fallback | `invalid` | None. Not taught in top-level prompts. | No dedicated focused suite. | Always registered; internal fallback surface, not family-routed. | Final closure ownership only. | Low. Real risk is discoverability, not runtime complexity. |
| Capability broker | `capability` | Explicit in Codex, Anthropic, Gemini. | `test/tool/capability.test.ts`, `test/session/system-prompt.test.ts` | Core-visible. Manages family expansion and turn/session masking. | Closed in tranche 4 and tranche 5; taxonomy tightened again in final closure. | Medium. Family taxonomy is still hand-maintained and can drift when new builtins land. |
| Question / gated plan entry | `question` | Partial. Mentioned in provider prompts as planning surface, but not as prominently as task or tracker. | `test/tool/question.test.ts`, `test/question/question.test.ts` | Registered builtin, but surfaced by `question` flag / client mode and by `planning` family enablement. | Closed as part of planning closure. | Medium. Behavior is gated and easy to miss in broad green slices. |
| Shell / terminal runtime | `shell`, `bash`, `terminal` | Explicit in system + all major prompts. | `test/shell/shell.test.ts`, `test/tool/bash.test.ts`, `test/tool/bash-safety.test.ts`, `test/tool/terminal.test.ts` | `shell`, `bash`, and `terminal` are core-visible; `world` family also exposes them. | Closed in the pre-tranche shell audit; reaffirmed here. | Low to medium. Biggest risk is platform-specific lifecycle edge cases, not prompt drift. |
| Basic file navigation | `read`, `glob`, `grep`, `list` | Explicit in Codex, Anthropic, and Gemini, plus system guidance. | `test/tool/read.test.ts`, `test/tool/read-offset.test.ts`, `test/tool/grep.test.ts`, `test/tool/grep-sorting.test.ts`, `test/tool/glob.test.ts`, `test/tool/list.test.ts`; lower-level overlap still exists in `test/util/glob.test.ts`. | `read`, `glob`, and `grep` are core-visible and in the `files` family; `list` is registered and now also in the `files` family. | Closed in tranche 2, then tightened again in tranche 8. | Low to medium. The dedicated `list` and `glob` contracts are now pinned; remaining risk is normal file-surface drift rather than missing direct ownership. |
| Mutation surface | `apply_patch`, `edit`, `multiedit`, `write`, `search_replace` | Explicit in Codex and broadly aligned in Anthropic / Gemini. | `test/tool/apply_patch.test.ts`, `test/tool/edit.test.ts`, `test/tool/multiedit.test.ts`, `test/tool/write.test.ts`, `test/tool/search_replace.test.ts` | `apply_patch` is selected for GPT-style models; `edit` / `write` are the inverse path; `multiedit` and `search_replace` are always registered. `patching` family now matches the modern set. | Closed in tranche 3; family taxonomy reconciled in final closure. | Medium. `search_replace` remains the most destructive contract with the lightest verification depth relative to blast radius. |
| Delegation / async coordination | `task` | Explicit in Codex, Anthropic, Gemini. | `test/tool/task-description.test.ts`, `test/tool/task-dependencies.test.ts`, `test/tool/task-lane.test.ts`, `test/tool/task-mailbox-smoke.test.ts`, `test/tool/task-provenance.test.ts`, `test/tool/task-wait-settlement.test.ts` | Core-visible and also present in `coordination`. | Closed in tranche 1. | Medium. Large async state surface; future regressions are likely to be mailbox or settlement timing bugs. |
| Todo continuity | `todoread`, `todowrite` | Explicit in Codex, Anthropic, Gemini. | `test/tool/todo.test.ts` | Non-core. `coordination` family now exposes both verbs. | Closed in tranche 1; capability-family drift fixed in final closure. | Low to medium. Runtime is simple, but prompt examples still emphasize TodoWrite much more than TodoRead. |
| Tracker DAG | `tracker_create_task`, `tracker_seed_from_decomposition`, `tracker_delete_task`, `tracker_update_task`, `tracker_get_task`, `tracker_list_tasks`, `tracker_add_dependency`, `tracker_visualize`, `tracker_dag_unblock`, `tracker_add_artifact` | Explicit but family-level. Prompts teach “tracker tools” more than verb-by-verb usage. | `test/tool/tracker.test.ts`, plus integration overlap in task / skill tests | Non-core. `coordination` family now includes the full tracker set, including `tracker_seed_from_decomposition`. | Closed in tranche 1; capability-family drift fixed in final closure. | Medium. Verb coverage is strong, but prompt teaching is still higher-level than the surface now deserves. |
| Blackboard | `blackboard`, `blackboard_get`, `blackboard_set`, `blackboard_append`, `blackboard_increment`, `blackboard_compare_and_swap`, `blackboard_delete`, `blackboard_clear` | Explicit in Codex, Anthropic, Gemini. | `test/tool/blackboard.test.ts` | Non-core high-level `coordination` entry plus separate `blackboard_raw` family. | Closed in tranche 1. | Low to medium. Main risk is misuse of raw verbs, not runtime instability. |
| Skill loading | `skill` | Partial / indirect. Taught mainly through tool description and capability language, not strongly in top-level provider bullets. | `test/tool/skill.test.ts`, `test/tool/skill-routing.test.ts`, prompt overlap in `test/session/prompt.test.ts` | Core-visible and included in `coordination`. | Closed in tranche 4. | Medium. Prompt teaching is still lighter than the actual importance of the direct `skill` tool. |
| Planning family | `enter_plan_mode`, `exit_plan_mode`, `planning_topology_preview`, `planning_topology_compare`, `planning_topology_select`, `planning_topology_outcome`, `planning_execution_brief_commit` | Mixed. Gemini is still the most plan-forward provider even after reconciliation; Codex stays execution-first. | `test/tool/plan.test.ts`, `test/tool/question.test.ts`, `test/session/system-prompt.test.ts` | Flag-gated in registry (`OPENCODE_EXPERIMENTAL_PLAN_MODE` + CLI) and exposed through the `planning` family. | Closed in tranche 4 and tranche 5. | Medium. Provider posture still varies, so planning overuse remains more likely on Gemini than elsewhere. |
| Retrieval memory | `recall`, `retrieval_status` | Explicit in Codex, Anthropic, Gemini. | `test/tool/recall.test.ts`, `test/tool/retrieval_status.test.ts`, prompt overlap in `test/session/system-prompt.test.ts` | Registered builtin; no dedicated capability family, so exact-id enablement is the current expansion path. | Closed in tranche 2, then hardened in tranche 7. | Low to medium. The direct status contract is now pinned; remaining risk is retrieval-runtime behavior, not missing tool ownership. |
| Code intelligence / mecha | `codetree`, `dependency_explorer`, `structural_read`, `impact`, `hypothesis`, `evolution` | Explicit for most of the surface, but emphasis is uneven by provider. | `test/tool/codetree.test.ts`, `test/tool/dependency_explorer.test.ts`, `test/tool/structural-read.test.ts`, `test/tool/impact.test.ts`, `test/tool/hypothesis.test.ts`, `test/session/evolution.test.ts` | Registered builtins; no family alias beyond exact tool ids. | `codetree` / `dependency_explorer` / `structural_read` closed in tranche 2; `impact` / `hypothesis` hardened in tranche 7; `evolution` remains session-level. | Low to medium. `impact` and `hypothesis` now have direct tool contracts; the remaining risk is mostly prompt emphasis and graph-quality variance. |
| Web research / fetch | `webfetch`, `websearch`, `codesearch` | Partial. Anthropic prompts teach `webfetch` strongly for docs lookup; Codex / Gemini teach `websearch` less directly; `codesearch` is mostly description-led. | `test/tool/webfetch.test.ts`, `test/tool/websearch.test.ts`, `test/tool/websearch-tavily.test.ts`, `test/tool/codesearch.test.ts` | `websearch` is core-visible and backend-gated; `codesearch` is provider / EXA gated; `world` and `search` families expose the relevant subsets. | Final closure ownership, then tranche 7 hardening for `codesearch`. | Medium. Direct `codesearch` coverage now exists, but the provider prompt layer still under-teaches it. |
| Workbench / runtime helpers | `workbench`, `node_repl`, `synthesize`, `synthesize_tool` | Explicit in Codex, Anthropic, Gemini. | `test/tool/workbench.test.ts`, `test/tool/node_repl.test.ts`, `test/tool/synthesize.test.ts` | Registered builtins; exact-id expansion only. | Final closure ownership only. | Low to medium. Runtime behavior is well covered, but helper discovery still depends on prompt/tool-description quality. |
| Snapshot safety | `snapshot_revert` | Explicit in Codex, Anthropic, Anthropic-20250930, Gemini, Alibaba, and the Qwen/default fallback prompt after tranche 8 reconciliation. | `test/tool/snapshot_revert.test.ts`, `test/session/system-prompt.test.ts` | Registered builtin; exact-id expansion only. | Closed in tranche 8 discoverability reconciliation. | Low to medium. Runtime is healthy and prompt discoverability is now materially better; remaining risk is mainly that rollback guidance is still lighter than read/edit guidance. |
| Parallel batching | `batch` | Explicit in Codex, Anthropic, Anthropic-20250930, Gemini, Alibaba, and the Qwen/default fallback prompt. | `test/tool/batch.test.ts`, prompt overlap in `test/session/system-prompt.test.ts`, adversarial routing in `test/harness/prompt-tuning-benchmark.test.ts` | Promoted default builtin; also exposed through capability/routing surfaces when visible. | Promoted after tranche 7; reconciled in tranche 8. | Medium. The tool now blocks the most obvious dependent-batch foot-guns, but the remaining risk is misuse of parallel state rather than missing ownership or gating. |
| LSP passthrough | `lsp` | Explicit in Codex, Anthropic, Anthropic-20250930, Gemini, Alibaba, and the Qwen/default fallback prompt as optional code intelligence with fallback guidance. | `test/tool/lsp.test.ts`, `test/lsp/index.test.ts`, prompt overlap in `test/session/system-prompt.test.ts`, adversarial routing in `test/harness/prompt-tuning-benchmark.test.ts` | Promoted default builtin. | Promoted after tranche 7; reconciled in tranche 8. | Medium. Prompt teaching and tool contracts are now aligned, but runtime usefulness still depends on real language-server availability and workspace fit. |

## Prompt / system reconciliation

- `src/session/system.ts` remains the source of truth for live provider routing and injected runtime environment.
- `src/session/prompt/gemini.txt` was materially behind the audited execution posture:
  - it taught a stronger “plan first, then ask before proceeding” workflow than the current audited execution-first behavior
  - it did not explicitly repeat the “do not infer host OS or shell from one failed command” rule that the other providers already carried
- `src/session/prompt/anthropic-20250930.txt` contained a frozen Linux cwd / date / model block that directly contradicted the live runtime environment injection path. That block is now replaced with a runtime-honesty note.
- After reconciliation, the remaining provider skew is stylistic, not contractual:
  - Codex remains the most execution-first
  - Anthropic is the most balanced
  - Gemini is still somewhat more plan-forward, but no longer teaches the most obvious approval-first contradiction

## Focused residual risks

- The capability-family map is now coherent with the audited registry, but it is still manual. Any future builtin addition can drift again if `runtime.ts`, `capability.ts`, and prompt examples are not updated together.
- `batch` and `lsp` are now promoted and prompt-taught, but both still have sharper edges than the read/edit core. Future regressions are most likely to show up in misuse (`batch`) or environment shape (`lsp`), not in basic registration.
- `snapshot_revert` is now discoverable enough in the live provider layer that it no longer looks like a hidden safety valve, but it is still a lighter-taught pattern than `read`, `edit`, or `grep`.
- The remaining builtin risk is no longer “experimental edges behind flags.” It is routine drift risk: registry, prompt, and focused coverage can still fall out of sync when new tools or heuristics land.

## Verification notes

- Focused confidence slice: green.
  - `bun test test/tool/tracker.test.ts test/tool/dependency_explorer.test.ts test/tool/multiedit.test.ts test/tool/skill.test.ts test/tool/registry.test.ts test/tool/capability.test.ts test/session/system.test.ts test/session/system-prompt.test.ts`
  - `bun test test/session/prompt.test.ts -t "sortByID canonicalizes tool order for stable prompt surfaces|compactToolDescription|ordinary build turns do not inject tracker guidance until tracker tools are enabled|complex build turns encourage coordination before tracker tools are enabled"`
- Adversarial out-of-slice probe:
  - A broader `bun test test/session/prompt.test.ts` run is still red outside this closure slice.
  - The failures observed there were not caused by this audit pass; they clustered around older prompt/test-contract drift in shell synthetic-tool naming, title-generation expectations, workgraph prompt-ingress expectations, and semantic-recall baton assertions.
  - Treat those as separate prompt-runtime hardening work, not as evidence that the builtin registry/capability closeout failed.

## Closeout recommendation

- Stable core builtin surface: done.
- Prompt / capability composition layer: done.
- Promoted advanced tools (`batch`, `lsp`): done enough to be default builtins, with residual sharp-edge risk now captured directly in the matrix.
- Tranche 8 closed the post-promotion reconciliation pass for doc drift, `snapshot_revert` discoverability, and the remaining thin direct coverage for `list` and `glob`.
- The next follow-up should only happen if fresh drift appears, not because this surface still needs a standing cleanup tranche.
