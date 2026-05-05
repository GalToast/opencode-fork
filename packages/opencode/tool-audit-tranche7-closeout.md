# Tranche 7 Closeout - Residual Audit Hardening

Historical note: this document captures the tranche-7 decision point. `batch` and `lsp` were later promoted by default in tranche 8 after prompt teaching, runtime confidence, and adversarial routing evidence cleared; see [tool-audit-tranche8-closeout.md](C:/Users/HP/repos/opencode/packages/opencode/tool-audit-tranche8-closeout.md) for the current post-promotion reconciliation pass.

## Scope

Tranche 7 was the bounded follow-on pass for the residual audit surface:

- prompt/runtime red-cluster cleanup
- thin-contract builtin hardening for `retrieval_status`, `codesearch`, `impact`, `hypothesis`, and `snapshot_revert`
- experimental-edge decisions for `batch` and `lsp`

This was not a new broad builtin sweep.

## What closed

### Prompt/runtime red cluster

- [prompt.ts](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt.ts) now records root-scoped workgraph objectives during normal ingress instead of only in steer mode.
- Normal turns again inject a semantic recall baton from `SessionWorkGraph.materialize(...)`, with project/session-family scope preserved and zero-signal matches filtered out.
- Auto title generation now prefers `Provider.getSemanticExactOutputSafeModel(...)` before the generic small-model fallback when no explicit title-agent model is configured.
- [prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/prompt.test.ts) now reflects the canonical `shell` tool naming and carries explicit 20s budgets for the two Windows-sensitive prompt cases that were brushing Bun's default 5s timeout.

### Thin-contract builtin hardening

- Added [codesearch.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/codesearch.test.ts) to pin permission requests plus SSE parsing/fallback behavior.
- Added [retrieval_status.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/retrieval_status.test.ts) to pin empty-state output plus routing/fallback diagnostics from a real recall-seeded run.
- Added [impact.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/impact.test.ts) to pin risk/blast-radius/test-coverage formatting and no-dependent fallback behavior.
- Added [hypothesis.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/hypothesis.test.ts) to pin propose/list behavior plus the auto-refute and auto-support thresholds.
- Re-verified [snapshot_revert.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/snapshot_revert.test.ts); no new product change was needed there because the direct contract already existed.

### Experimental edges

- Added [batch.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/batch.test.ts) to pin partial-failure aggregation and the no-nested-batch guard.
- Added [lsp.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/lsp.test.ts) to pin permission gating, JSON result formatting, and the no-server failure path.
- Tightened the `batch` product contract in [batch.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/batch.ts):
  - multiple mutation tools in one batch are now rejected
  - same-target mutate-plus-inspect batches are now rejected
- Improved `lsp` fallback guidance in [lsp.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/lsp.ts):
  - no-server failures now suggest `structural_read`, `grep`, or `read`
  - empty-result responses now include the same fallback guidance
- Verified the registry truth in [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts):
  - `batch` remains config-gated by `config.experimental?.batch_tool === true`
  - `lsp` remains flag-gated by `Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL`

## Recommendations

### `batch`

Recommendation: keep behind flag as-is.

Why:

- the runtime contract is now directly tested
- the tool now blocks the two most obvious dependent-batch foot-guns instead of only documenting them
- the tool is still intentionally absent from live top-level prompt teaching
- the surface is parallel-stateful and easy to misuse when ordering matters

That means it is acceptable as an expert, opt-in acceleration path, but not ready to be treated as stable core.

### `lsp`

Recommendation: keep behind flag as-is.

Why:

- the tool contract is now directly tested
- the no-server and no-result paths now point to usable fallback tools
- real behavior still depends heavily on local server availability and filetype configuration
- the tool remains environment-shaped enough that promoting it would create more discoverability pressure and support burden than the current prompt layer justifies

### Overall tranche status

Recommendation: done except flagged experimental edges.

That is the honest shortest read:

- stable core builtin surface: done
- tranche 7 thin-contract holes: closed
- `batch` and `lsp`: acceptable behind flags, not promoted

## Verification used

### Prompt/runtime and stable guardrails

1. `bun test test/session/prompt.test.ts -t "shell follow-up preserves|records root-scoped workgraph objective metadata|semantic recall baton|title|session-family memory|broader project memory|zero-signal retrieval matches"`
2. `bun test test/tool/registry.test.ts test/tool/capability.test.ts test/session/system-prompt.test.ts`

### Thin-contract suites

1. `bun test test/tool/codesearch.test.ts test/tool/retrieval_status.test.ts`
2. `bun test test/tool/impact.test.ts test/tool/hypothesis.test.ts`
3. `bun test test/tool/structural-read.test.ts test/tool/snapshot_revert.test.ts`

### Experimental-edge suites

1. `bun test test/tool/batch.test.ts test/tool/lsp.test.ts`

### Promotion-oriented guardrail rerun

1. `bun test test/tool/batch.test.ts test/tool/lsp.test.ts`

## Remaining residual risk

- [snapshot_revert.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/snapshot_revert.ts) remains safer than its prompt discoverability suggests. If we want broader model use, it deserves one more explicit provider-level mention.
- `batch` and `lsp` now have direct ownership, but they are still intentionally not part of the promoted stable-core posture.
- Promotion criteria now live in [tool-promotion-batch-lsp.md](C:/Users/HP/repos/opencode/packages/opencode/tool-promotion-batch-lsp.md) so the next decision can be evidence-based.
