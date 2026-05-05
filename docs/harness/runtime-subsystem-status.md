# Runtime Subsystem Status

## Purpose

This note captures which advanced harness/session subsystems are currently part
of the live runtime, which ones are still connected but should be treated as
experimental support layers, and which ones were intentionally pruned during the
March 28, 2026 cleanup.

Use this document as a reality check before wiring new features onto older
subsystems that may still exist in history, notes, or prior sweep artifacts.

## Live Runtime Layers

These modules are part of the current execution graph and should be treated as
real runtime surfaces:

- `src/mecha/integration.ts`
- `src/session/reasoning-ledger.ts`
- `src/session/social-memory.ts`
- `src/session/world-state.ts`
- `src/session/agent-state.ts`
- `src/session/execution-brief.ts`
- `src/session/jit-feedback.ts`
- `src/session/evolution.ts`
- `src/session/hypothesis.ts`
- `src/session/goal-engine.ts`

## Experimental Support Layers

These modules are still connected, but they should be treated as supporting
systems rather than settled contracts:

- `src/session/goal-engine.ts`
  - useful for harness-side task decomposition
  - model/prompt assumptions may still evolve
- `src/session/hypothesis.ts`
  - useful for explicit experiment tracking
  - mostly valuable through Mecha/review flows rather than core chat behavior
- `src/session/evolution.ts`
  - useful for long-lived architectural proposals
  - keep the persistence/search contract narrow and test-backed

## Intentionally Pruned

These modules were intentionally removed because they were dead, advisory-only,
or more speculative than useful in the live runtime:

- `src/tool/composer.ts`
- `src/tool/compound-action.ts`
- `src/tool/self-edit.ts`
- `src/tool/refactor.ts`
- `src/session/adversarial.ts`
- `src/session/context-allocator.ts`
- `src/session/attention.ts`
- `src/session/cognitive-load.ts`
- `src/session/prefetch.ts`
- `src/scheduler/speculative.ts`
- `src/harness/retrieval-quality-real-cases.ts`

## Current Guidance

- Prefer wiring new behavior onto live runtime layers instead of reviving removed
  advisory systems.
- If a capability is not in the execution graph, treat it as non-existent until
  it has a concrete caller, tests, and an operator-visible reason to exist.
- For semantic helper features, prefer small, purpose-built tools over broad
  meta-orchestration surfaces.
- Keep retrieval, JIT, and compaction behavior observable and test-backed before
  adding speculative context-shaping layers again.

## Notes From This Cleanup

- `JitFeedback.init()` is expected to be idempotent because bootstrap and Mecha
  can both touch it.
- `Evolution` now persists structured proposal JSON so retrieval-backed `find`
  and `search` stay internally consistent.
- There is no remaining `Prefetch` wiring in `src/` or `test/`; speculative
  staging should not be assumed to exist in the current harness.
