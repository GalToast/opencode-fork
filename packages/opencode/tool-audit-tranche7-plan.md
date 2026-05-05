# Tranche 7 Plan - Residual Audit Hardening

## Why tranche 7 exists

The repo-wide builtin audit is closed for the stable core, but not every residual risk belongs in the same bucket.

Tranche 7 is the narrow follow-on pass for the surfaces that are still only "stable enough" rather than fully closed:

- experimental edges that remain behind flags
- thinner-contract builtin tools that still lack strong direct test ownership
- prompt/runtime drift exposed by the broader `test/session/prompt.test.ts` sweep but not fixed in the final audit closeout

This is not another full builtin audit. It is a bounded hardening tranche.

## Scope

### Primary targets

- `batch`
- `lsp`
- `codesearch`
- `retrieval_status`
- `impact`
- `hypothesis`
- `snapshot_revert`

### Prompt/runtime hardening targets

- broad `test/session/prompt.test.ts` reds that were outside the tranche 6 closure slice
- shell synthetic-tool naming drift (`bash` vs `shell`)
- title-generation expectation drift
- workgraph objective ingress expectation drift
- semantic recall baton expectation drift

### Explicit non-goals

- do not reopen the already-green stable core families unless tranche 7 finds a direct contradiction
- do not broaden into another registry-wide matrix rewrite
- do not run full-repo test sweeps as the default lane

## Workstreams

### 1. Experimental edge audit

Goal:
- decide whether `batch` and `lsp` should remain "behind flags but acceptable" or should move toward a real stable contract

Steps:
1. Inventory the exact registry gating and runtime dependencies for `batch` and `lsp`.
2. Read their tool descriptions and current usage assumptions.
3. Add or expand direct focused tests for each tool.
4. Verify whether capability/prompt surfaces should mention them at all while they are still experimental.
5. End with one explicit recommendation per tool:
   - keep behind flag as-is
   - harden and promote
   - deprecate or narrow further

Exit criteria:
- each tool has a direct ownership note
- each tool has at least one focused contract suite
- each tool has an explicit recommendation, not an implied one

### 2. Thin-contract builtin hardening

Goal:
- close the obvious "green slice but one tool still lacks a strong direct contract" holes

Priority order:
1. `retrieval_status`
2. `codesearch`
3. `impact`
4. `hypothesis`
5. `snapshot_revert`

Steps:
1. Verify current direct test ownership.
2. Add focused suites where coverage is missing or too indirect.
3. Re-check prompt discoverability for tools that are safety-relevant but under-taught.
4. Record residual risk only if a concrete hole still remains after the focused pass.

Exit criteria:
- each target has either a dedicated focused suite or a documented reason why that is intentionally deferred
- any remaining residual risk is specific and test-shaped, not generic

### 3. Prompt/runtime red-cluster cleanup

Goal:
- address the broad `test/session/prompt.test.ts` failures that surfaced during the adversarial sweep

Known cluster to triage first:
1. shell synthetic-tool naming expectations
2. title-generation provider/model expectation drift
3. workgraph objective ingress expectations
4. semantic recall baton expectations
5. plan-mode semantic-planning-brief expectation drift

Steps:
1. Reproduce the failing cases in isolated targeted subsets.
2. Separate expectation drift from runtime/product regressions.
3. Fix product/runtime bugs first.
4. Then fix stale prompt tests.
5. Re-run only the targeted red cluster until green.

Exit criteria:
- the known failing cluster has a clear disposition:
  - fixed green
  - intentionally rewritten expectation
  - explicitly deferred with a reason

### 4. Final tranche-7 closeout

Goal:
- leave one clean answer on whether the remaining builtin surface is actually done

Deliverables:
- `tool-audit-tranche7-*.md` closeout doc
- updated `tool-audit-matrix.md` residual-risk section
- explicit status call:
  - done
  - done except flagged experimental edges
  - still stable enough, not done

## Verification plan

### Required focused slices

- experimental edge suites for `batch` / `lsp`
- direct contract suites for whichever of `retrieval_status`, `codesearch`, `impact`, `hypothesis`, and `snapshot_revert` are expanded
- targeted `test/session/prompt.test.ts` subsets for each red cluster fixed
- `test/tool/registry.test.ts`
- `test/tool/capability.test.ts`
- `test/session/system-prompt.test.ts`

### Recommended discipline

- run one representative targeted subset at a time
- do not use a giant omnibus suite until the targeted reds are green
- treat broad `prompt.test.ts` runs as adversarial probes, not the first debugging loop

## Success criteria

Tranche 7 is complete when all of the following are true:

- `batch` and `lsp` have explicit recommendations backed by focused evidence
- the thin-contract builtin targets no longer have obvious direct-test ownership holes
- the currently known broad prompt-test red cluster has been triaged and either fixed or explicitly deferred
- `tool-audit-matrix.md` can say whether the builtin surface is actually done without hiding behind vague residual-risk language

## Recommendation before starting

Start tranche 7 in this order:

1. Prompt/runtime red-cluster cleanup
2. `retrieval_status` and `codesearch`
3. `impact` and `hypothesis`
4. `snapshot_revert`
5. `batch` and `lsp`

That order gives the fastest reduction in ambiguity first, then closes the remaining obvious contract holes, and leaves the truly experimental edge judgment for the end when the rest of the surface is already clean.
