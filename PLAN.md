# Opencode Fork — End-to-End Fix Plan

## State (2026-04-04)
- **Real baseline errors:** ~702 (after restoring corrupted `control-plane.test.ts` from null bytes)
- **Our working changes:** 30 files, bash→shell rename, retrieval schema, migration robustness, task recovery, steer fix
- **Our changes introduced 0 new errors** (actually reduced baseline)

---

## Phase 1: Quick Wins (~50 errors, high confidence)

### 1.1 Missing module imports (~10 errors)
**Files:** `script/benchmark-harness-retrieval-quality-matrix.ts`, `script/capture-ambiguous-retrieval-traces.ts`, `script/extract-retrieval-trace-cases.ts`, `script/list-ambiguous-retrieval-traces.ts`, `src/harness/retrieval-trace-ranker-ablation-benchmark.ts`, `src/harness/retrieval-trace-replay-benchmark.ts`, `test/harness/retrieval-trace-ambiguity.test.ts`

**Problem:** Importing `@/retrieval/trace`, `@/retrieval/negative-index`, `../src/harness/retrieval-quality-real-cases` — modules that don't exist.

**Fix:** Either create stub modules or comment out the dead scripts. These are benchmark/harness scripts, not core functionality.

### 1.2 `UnknownRecord` → `SharedV2ProviderOptions` (~1 error)
**File:** `src/agent/agent.ts:360`

**Fix:** Cast or narrow the type properly.

### 1.3 Harness benchmark `unknown` property access (~15 errors)
**Files:** `src/harness/retrieval-substrate-benchmark.ts`, `src/harness/semantic-benchmark.ts`

**Fix:** Add type assertions or proper type narrowing on `candidate`, `input.policy`, `result.properties`.

### 1.4 `provider/transform.ts` unknown access (~2 errors)
**File:** `src/provider/transform.ts:1041`

**Fix:** Type assertion on `result.properties`.

### 1.5 `mecha/integration.ts` and `session/hypothesis.ts` missing module (~2 errors)
**Files:** `src/mecha/integration.ts:322`, `src/session/hypothesis.ts:215`

**Fix:** Create stub `@/retrieval/negative-index` or comment out the import path.

---

## Phase 2: TUI Context System — `ReadyAware` (~120 errors)

### 2.1 Fix `createSimpleContext` generic constraint
**File:** `src/cli/cmd/tui/context/helper.tsx`

**Problem:** `type ReadyAware = { ready?: boolean }` is a stub. The generic `T extends ReadyAware` loses all type info when the context value is consumed via `useContext(ctx)`. Every context provider that returns `{ client, data, keybinds, model, agent, ... }` gets narrowed to just `{ ready?: boolean }`.

**Fix:** Change `ReadyAware` from a concrete type to a **brand marker**, and make the context system preserve the full generic type:

```ts
// Before:
type ReadyAware = { ready?: boolean }

// After:
type ReadyAware = { ready?: boolean }
// Keep ReadyAware as a marker but fix the context return type
// The `use()` function should return `T`, not `ReadyAware`
```

The actual issue is in `helper.tsx` line 4 — the `createSimpleContext<T extends ReadyAware>` function's return type for `use()` correctly returns `T`, but the **init function signature** `((input: Props) => T) | (() => T)` is being checked against `((input: Props) => ReadyAware) | (() => ReadyAware)` at the call site because TypeScript can't validate that the concrete return types satisfy `T extends ReadyAware` through the generic.

**Real fix:** The constraint is fine — the issue is that TypeScript validates the **input function's return type** against the constraint at the call site. Every context provider that doesn't explicitly have `ready?: boolean` in its return type fails.

**Solution:** Add `ready: true` (or `ready?: boolean`) to every context provider's returned object. This is a mechanical fix across ~15 files.

### 2.2 TUI dialog `() => any` not assignable to `Element` (~15 errors)
**Files:** `src/cli/cmd/tui/component/dialog-model.tsx`, `dialog-provider.tsx`, `dialog-session-list.tsx`, `dialog-session-rename.tsx`

**Problem:** Arrow functions `() => JSX.Element` being passed where `Element` is expected.

**Fix:** Call the function or remove the wrapper — these are likely leftover from refactoring.

### 2.3 `KeybindInfo` type mismatches (~5 errors)
**Files:** `dialog-model.tsx`, `dialog-stash.tsx`

**Fix:** Use proper `KeybindInfo` objects instead of raw strings.

### 2.4 TUI sync context `Part`/`Message` type issues (~30 errors)
**File:** `src/cli/cmd/tui/context/sync.tsx`

**Problem:** Accessing `.metadata`, `.state`, `.text`, `.tool`, `.callID` on discriminated union `Part` without narrowing by `.type`.

**Fix:** Add type guards or switch on `part.type` before accessing variant-specific fields.

---

## Phase 3: Tool & Session Types (~80 errors)

### 3.1 `ToolState` assignability (~10 errors)
**File:** `src/cli/cmd/tui/context/sync.tsx:1519`

**Fix:** Align the tool state shape with the expected `ToolState` type.

### 3.2 `PromptUserMessage[]` not assignable to `Message[]` (~5 errors)
**File:** `src/cli/cmd/tui/component/prompt/index.tsx`

**Fix:** Type narrowing or union widening.

### 3.3 Provider model type mismatches (~5 errors)
**Files:** `dialog-model.tsx`, `prompt/index.tsx`

**Fix:** Align `ProviderModel` with the expected shape.

### 3.4 `footer.tsx` / `header.tsx` / `sidebar.tsx` `Message[]` → `ShellMessage[]` (~10 errors)

**Fix:** These are likely type alias issues from the shell rename. Check if `ShellMessage` is the right type or if it should be `Message[]`.

### 3.5 `shell.ts` Tool.define type (~1 error)
**File:** `src/tool/shell.ts:68`

**Fix:** The `Tool.define` call has a type mismatch on the return shape.

---

## Phase 4: Test Fixes (~217 errors)

### 4.1 Missing test modules
Tests importing dead modules (`retrieval/trace`, `retrieval-quality-real-cases`, etc.)

### 4.2 Unix-dependent tests
Tests using `seq`, bash-specific behavior that fail on Windows.

### 4.3 DB isolation issues
`repro_db_reset.test.ts` — tests not cleaning up between runs.

---

## Phase 5: Commit & Verify

1. Run `bun tsc --noEmit` — target: **0 errors**
2. Run `bun test` — target: all non-environment-dependent tests pass
3. Commit in logical chunks per phase

---

## Priority Order

1. **Phase 1** (quick wins, ~30 errors) — 15 minutes
2. **Phase 2.1** (ReadyAware, ~20 context files) — 30 minutes  
3. **Phase 2.2-2.4** (TUI dialogs + sync, ~50 errors) — 45 minutes
4. **Phase 3** (tool/session types, ~30 errors) — 30 minutes
5. **Phase 4** (test fixes, ~100 errors) — 60 minutes
6. **Phase 5** (verify + commit) — 15 minutes

**Total estimate:** ~3 hours of focused work
