# Tranche 8 Closeout - Post-Promotion Reconciliation

## Scope

Tranche 8 was the narrow cleanup pass after the `batch` / `lsp` promotion work:

- reconcile stale audit docs
- add thin focused direct coverage for `list` and `glob`
- improve live provider prompt parity for recent tool-surface guidance

## What closed

### Audit record reconciliation

- [tool-audit-matrix.md](C:/Users/HP/repos/opencode/packages/opencode/tool-audit-matrix.md) now reflects the current registry truth:
  - `batch` and `lsp` are promoted default builtins, not flag-gated expert-only surfaces
  - the residual-risk language now focuses on prompt discipline and environment shape instead of stale gating assumptions
- [tool-audit-tranche7-closeout.md](C:/Users/HP/repos/opencode/packages/opencode/tool-audit-tranche7-closeout.md) now carries a historical note pointing to tranche 8 for the later promotion outcome, so the tranche-7 document stays historically useful without silently contradicting the current codebase

### Thin direct coverage

- Added [list.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/list.test.ts) to pin:
  - tree rendering
  - default ignore behavior
  - caller-provided ignore globs
  - truncation metadata at the listing limit
- Added [glob.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/glob.test.ts) to pin:
  - absolute-path output
  - mtime-descending sorting
  - empty-match output
  - truncation guidance at the match limit

### Snapshot discoverability

- Added explicit `snapshot_revert` guidance to the live provider prompts and fallback prompt paths that were still under-teaching it:
  - [anthropic.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic.txt)
  - [anthropic-20250930.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic-20250930.txt)
  - [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt)
  - [alibaba.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/alibaba.txt)
  - [qwen.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/qwen.txt)
- Expanded [system-prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/system-prompt.test.ts) so that prompt discoverability is pinned rather than implied
- Verified that the default `SystemPrompt.provider(...)` fallback path now inherits the same rollback guidance through the Qwen-family prompt artifact

### Live prompt parity

- Reconciled the live Alibaba/Qwen/default prompt paths with the recent audited tool guidance instead of stopping at `snapshot_revert` alone.
- [alibaba.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/alibaba.txt) and [qwen.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/qwen.txt) now also teach:
  - direct-tool-vs-`task` routing instead of forcing delegation for every lookup
  - `batch` as independent/non-dependent-only fanout
  - `lsp` as optional code intelligence with fallback tools
  - `terminal` over `shell` for persistent processes
- [system-prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/system-prompt.test.ts) now pins those parity expectations, and the default `SystemPrompt.provider(...)` fallback assertion proves the non-specialized provider path inherits them too.

## Verification used

1. `bun test test/tool/list.test.ts test/tool/glob.test.ts`
2. `bun test test/session/system-prompt.test.ts`
3. `bun test test/tool/list.test.ts test/tool/glob.test.ts test/tool/registry.test.ts test/tool/batch.test.ts test/tool/lsp.test.ts test/session/system-prompt.test.ts`

## Residual risk

- `list` and `glob` now have direct focused suites, but they are still lightweight contracts compared with the deeper `read` / `grep` coverage.
- `lsp` remains more environment-shaped than most promoted tools, so future regressions are still likely to show up first in runtime availability rather than in the prompt layer.
- The main remaining risk is future document drift when registry/prompt/coverage changes land out of sync, especially if a new heuristic lands in one prompt family but not in all live provider paths.

## Recommendation

Tranche 8 is closed.

The stable builtin surface, the promoted `batch` / `lsp` posture, and the live provider prompt paths are now aligned closely enough that a tranche 9 only makes sense if a fresh audit finds new drift rather than as a scheduled follow-on.
