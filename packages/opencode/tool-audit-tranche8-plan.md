# Tranche 8 Plan - Post-Promotion Reconciliation

## Scope

Tranche 8 is the narrow cleanup pass after the `batch` / `lsp` promotion work. It is not another broad builtin sweep.

The target surface is:

- reconcile stale audit docs that still describe `batch` and `lsp` as flagged-only tools
- add thin focused direct suites for `list` and `glob`
- tighten prompt parity across the live provider paths where recent tool guidance was still uneven

## Why this tranche exists

After tranche 7 and the later promotion work, the code and the audit docs diverged:

- `src/tool/registry.ts` now promotes `batch` and `lsp` by default
- `tool-audit-matrix.md` and `tool-audit-tranche7-closeout.md` still describe them as flag-gated expert surfaces
- `list` and direct `glob` behavior remain thinner than neighboring file-navigation tools
- recent tool-surface guidance was not fully mirrored across the live Alibaba/Qwen/default prompt paths selected by `src/session/system.ts`

## Planned changes

1. Update the matrix and tranche-7 closeout so the written audit record matches the promoted registry state.
2. Add direct focused suites for `list` and `glob`.
3. Reconcile the live Alibaba/Qwen/default prompt paths with the recent audited tool guidance, including `snapshot_revert`, `batch`, `lsp`, `terminal`, and direct-tool-vs-`task` routing.
4. Re-run a focused confidence slice and record tranche status in repo memory.

## Success criteria

- audit docs no longer claim `batch` and `lsp` are still behind flags
- `test/tool/list.test.ts` and `test/tool/glob.test.ts` exist and pass
- live provider prompt artifacts selected by `src/session/system.ts` are aligned closely enough on the recent tool-surface heuristics that the matrix can treat them as parity-maintained rather than partially stale
- the residual tranche-8 risk is documentation drift or future coverage erosion, not unresolved promotion confusion
