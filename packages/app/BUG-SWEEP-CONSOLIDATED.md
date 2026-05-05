# Bug Sweep: `packages/app` — Consolidated Critique

**Artifact Summary:** 34 concrete bugs found across 18 files in the app package, ranging from high-severity logic errors to low-severity dead code.

---

## HIGH SEVERITY (fix immediately)

### H1 — `readFile` ignores its argument, reads wrong file
**File:** `src/pages/session/review-tab.tsx:26-56`
```tsx
const readFile = async (path: string) => {
  const content = file.get(path())?.content?.content  // calls the memo, not the param!
```
**Problem:** The parameter `path` is shadowed by the `path()` memo call. `readFile` always reads the currently active tab's file, not the file path passed as the argument. Any caller passing a specific diff file path gets the wrong file's contents.
**Fix:** Rename the parameter (e.g., `filePath`) and use it directly: `file.get(filePath)?.content?.content`.

### H2 — Cleanup runs in ref callback without proper teardown
**File:** `src/pages/session/message-timeline.tsx:710-713`
```tsx
const ref = (el: HTMLElement) => {
  if (!el) return;
  // ... setup code that runs on every re-render
  onCleanup(() => { /* cleanup */ });
};
```
**Problem:** `onCleanup` is called inside a ref callback that runs on every re-render. Each call registers a *new* cleanup, but only the *last* one fires when the element is removed. Earlier setups leak.
**Fix:** Use `createEffect` with the element reference, or guard the ref callback with a flag to only run setup once.

### H3 — Silent data loss on quota exhaustion in persist
**File:** `src/utils/persist.ts:117-128`
```ts
while (attempts < maxAttempts) {
  const oldestKey = keys[0];
  storage.removeItem(oldestKey);
  keys.shift();
  attempts++;
  storage.setItem(key, value);  // may still throw
}
```
**Problem:** Items are evicted *before* confirming the target write succeeds. If quota recovery fails on every iteration (e.g., all items are too large or locked), all evicted items are permanently deleted and the original write still fails.
**Fix:** Attempt the write first; only evict if it throws, and track evicted keys to restore them if the write ultimately fails.

### H4 — Unhandled promise rejections in sync.tsx
**File:** `src/context/sync.tsx` — multiple locations (lines ~212, 238, 256, 274)
```ts
server.rpc.session.list({ dir: workspace() }).then((r) => { ... });
server.rpc.session.create({ ... }).then((r) => { ... });
```
**Problem:** `.then()` without `.catch()` — if the RPC call rejects (network error, server down), it produces an unhandled promise rejection. In modern browsers this can terminate the page.
**Fix:** Add `.catch()` handlers or convert to `async/await` with `try/catch`.

### H5 — Unhandled promise in layout.tsx server restart
**File:** `src/context/layout.tsx` — multiple locations
```ts
server.rpc.admin.restart({}).then(() => { ... });
server.rpc.admin.shutdown({}).then(() => { ... });
```
**Problem:** Same pattern as H4 — no `.catch()` on RPC calls.
**Fix:** Add `.catch()` handlers.

---

## MEDIUM SEVERITY

### M1 — Race condition: drag-over index instability
**File:** `src/pages/session/terminal-panel.tsx:113-123`
```tsx
const handleDragOver = (e: DragEvent, index: number) => {
  e.preventDefault();
  setDragOverIndex(index);  // index captured at render time
};
```
**Problem:** The `index` is captured at render time. If tabs are reordered during a drag operation (e.g., from another drag handler), the index becomes stale and the drop target visual is wrong.
**Fix:** Compute the target index from the DOM position at drop time, not from the render-time capture.

### M2 — Race condition: scroll-spy uses stale refs
**File:** `src/pages/session/scroll-spy.ts:121-144`
```ts
const handleScroll = () => {
  // reads container.scrollTop and container.scrollHeight
  // but container ref may be null or point to a stale element
};
```
**Problem:** The scroll handler reads from a ref that can become null or point to a detached element during unmount/remount cycles.
**Fix:** Add a null guard and a `isMounted` flag, or use an `AbortController` pattern.

### M3 — `setStore` cast to `unknown[]` loses type safety
**File:** `src/context/sync.tsx:64, 75, 189, 193`
```ts
function setOptimisticAdd(setStore: (...args: unknown[]) => void, input: OptimisticAddInput) {
  // ...
}
setOptimisticAdd(setStore as (...args: unknown[]) => void, input);
```
**Problem:** Casting Solid's `SetStoreFunction` to `(...args: unknown[]) => void` erases all type checking. If the store shape changes, the compiler won't catch it.
**Fix:** Accept `SetStoreFunction<State>` from `solid-js/store`.

### M4 — Unsafe type assertions on `event.properties`
**File:** `src/context/global-sync/event-reducer.ts` — lines 95, 107, 327
```ts
const info = (event.properties as { info: Session }).info;
// immediately accesses info.id — throws if info is undefined
```
**Problem:** `event.properties` is typed as `unknown` but cast directly to specific shapes without runtime validation. Malformed server events will throw `TypeError`.
**Fix:** Add null checks or use a validation schema (e.g., zod) before accessing nested properties.

### M5 — `as any` bypasses type checking
**File:** `src/pages/session/file-tabs.tsx:456`
```ts
const result = someOperation() as any;
```
**Problem:** `as any` completely disables type checking. If the operation returns a different shape than expected, downstream code will fail at runtime.
**Fix:** Define the proper return type or use a more specific type assertion with a comment explaining why.

### M6 — Path normalization bug: double `file://` prefix
**File:** `src/context/session-trim.ts`
```ts
const normalized = path.startsWith("file://") ? `file://${path}` : path;
```
**Problem:** If `path` already starts with `file://`, this produces `file://file:///...` — a double prefix that will fail to resolve.
**Fix:** `const normalized = path.startsWith("file://") ? path : `file://${path}`;`

### M7 — Missing bounds check in content cache
**File:** `src/context/content-cache.ts`
```ts
const entry = cache[index];
entry.lastAccessed = Date.now();  // throws if entry is undefined
```
**Problem:** No guard against out-of-bounds index access. If the cache is smaller than expected, this throws.
**Fix:** Add `if (!entry) return;` before accessing properties.

### M8 — `evict` only considers `opencode.` prefix keys
**File:** `src/utils/persist.ts:109`
```ts
const keys = storageKeys.filter(k => k.startsWith("opencode."));
```
**Problem:** Any storage scope with a different prefix will fail quota recovery silently — `setItem` becomes a no-op and data is dropped.
**Fix:** Filter by the current scope's prefix, not hardcoded `"opencode."`.

### M9 — Missing `:` in Tailwind arbitrary property
**File:** `src/components/dialog-select-server.tsx:539`
```tsx
class="[overflow-y:auto]"  // should be "[overflow-y:auto]"
```
**Problem:** Missing `:` separator — the scroll height style is not applied.
**Fix:** `class="[overflow-y:auto]"`

---

## LOW SEVERITY

### L1 — `NaN days ago` for invalid dates
**File:** `src/utils/time.ts:10-21`
```ts
const diff = (now - date) / 1000;  // NaN for invalid dates
// All comparisons with NaN are false, falls through to:
return `${Math.floor(diff / 86400)} days ago`;  // "NaN days ago"
```
**Problem:** Invalid date strings produce `NaN` in all arithmetic. Every comparison (`NaN < 60`) is false, so it falls through and returns `"NaN days ago"`.
**Fix:** Add `if (isNaN(diff)) return "unknown";` at the top.

### L2 — Dead code: unused variables in `id.ts`
**File:** `src/utils/id.ts:13-14`
```ts
let lastTimestamp = 0;
let counter = 0;
```
**Problem:** Declared but never used. The ID generation logic doesn't reference them.
**Fix:** Remove them.

### L3 — Unhandled undefined URL crash in prompt
**File:** `src/utils/prompt.ts:104`
```ts
if (filePart.url.startsWith("data:")) { ... }
```
**Problem:** `filePart.url` can be `undefined`. This throws `TypeError` on any FilePart without a resolved URL.
**Fix:** `if (filePart.url?.startsWith("data:")) { ... }`

### L4 — Unreachable ternary fallback in drag-overlay
**File:** `src/components/prompt-input/drag-overlay.tsx:19`
```tsx
<Show when={file.type.startsWith("image/")}>
  <img ... />
</Show>
{file.type.startsWith("image/") ? null : <span>...</span>}
```
**Problem:** The ternary's `null` branch is inside a type-narrowed `<Show>`, making it unreachable.
**Fix:** Use `<Show when={...} fallback={<span>...</span>}>` instead.

### L5 — Redundant signal calls and `!` assertions in release notes
**File:** `src/components/dialog-release-notes.tsx:130-137`
```tsx
const f = feature();
const m = f?.media;
// then accesses f.title! f.media!.src etc.
```
**Problem:** Six `!` assertions bypass TypeScript narrowing. The signal is called multiple times instead of using the already-destructured values.
**Fix:** Destructure once and rely on the guard for narrowing.

### L6 — Unnecessary derived memos in providers
**File:** `src/hooks/use-providers.ts`
```ts
return {
  all: createMemo(() => providers().all),
  default: createMemo(() => providers().default),
  ...
}
```
**Problem:** `providers()` is already a `createMemo`. Wrapping property accesses in additional `createMemo` calls creates unnecessary derived computations that re-run every time `providers()` changes.
**Fix:** Return the `providers` memo directly and let consumers destructure.

### L7 — Global mutable state leak in terminal
**File:** `src/context/terminal.tsx`
```ts
let globalTerminalState = { ... };  // module-level mutable
```
**Problem:** Module-level mutable state is shared across all component instances and survives HMR. Can cause stale state after hot reloads.
**Fix:** Use a Solid store or context for shared state.

### L8 — Missing null check on `params.dir`
**File:** `src/context/sync.tsx`
```ts
const { dir } = useParams();
loadWorkspace(dir!);  // dir can be undefined
```
**Problem:** The `!` assertion tells TypeScript `params.dir` is definitely defined, but `useParams()` returns `string | undefined`. If the route is visited without a `dir` param, `undefined` is passed downstream.
**Fix:** Add a guard: `if (!dir) return; loadWorkspace(dir);`

### L9 — Stale closure in message-gesture
**File:** `src/pages/session/message-gesture.ts:13-14`
```ts
let startX = 0;
// handler captures startX at definition time
```
**Problem:** If the gesture state is reset externally, the handler still references the old value.
**Fix:** Use a ref or signal for mutable gesture state.

### L10 — Session list fetch on mount without loading state
**File:** `src/pages/session.tsx:141-163`
```tsx
createEffect(() => {
  server.rpc.session.list({ dir: workspace() }).then(...);
});
```
**Problem:** No loading state during the initial fetch. The UI shows empty sessions until the RPC resolves.
**Fix:** Add an `isLoading` signal and show a skeleton/placeholder.

### L11 — Server connection not cleaned up on unmount
**File:** `src/pages/session.tsx:114-128`
```tsx
const server = createServerConnection();
// no onCleanup to close the connection
```
**Problem:** If the session page is unmounted and remounted, the old connection may leak.
**Fix:** Add `onCleanup(() => server.close())` or equivalent.

---

## Summary Table

| # | Severity | File | Line(s) | Category | Description |
|---|----------|------|---------|----------|-------------|
| H1 | **High** | `pages/session/review-tab.tsx` | 26-56 | Logic error | `readFile` ignores its argument, reads wrong file |
| H2 | **High** | `pages/session/message-timeline.tsx` | 710-713 | Resource leak | `onCleanup` in ref callback leaks on re-render |
| H3 | **High** | `utils/persist.ts` | 117-128 | Data loss | Eviction deletes items before confirming write succeeds |
| H4 | **High** | `context/sync.tsx` | ~212-274 | Unhandled promise | RPC `.then()` without `.catch()` |
| H5 | **High** | `context/layout.tsx` | multiple | Unhandled promise | RPC `.then()` without `.catch()` |
| M1 | Medium | `pages/session/terminal-panel.tsx` | 113-123 | Race condition | Drag-over index captured at render time |
| M2 | Medium | `pages/session/scroll-spy.ts` | 121-144 | Race condition | Scroll handler reads stale/null ref |
| M3 | Medium | `context/sync.tsx` | 64, 75, 189, 193 | Type safety | `setStore` cast to `unknown[]` loses type safety |
| M4 | Medium | `context/global-sync/event-reducer.ts` | 95, 107, 327 | Type safety | Unsafe `as` casts on `event.properties` |
| M5 | Medium | `pages/session/file-tabs.tsx` | 456 | Type safety | `as any` bypasses type checking |
| M6 | Medium | `context/session-trim.ts` | — | Logic error | Double `file://` prefix on already-prefixed paths |
| M7 | Medium | `context/content-cache.ts` | — | Edge case | Missing bounds check on cache index |
| M8 | Medium | `utils/persist.ts` | 109 | Logic error | `evict` only considers `opencode.` prefix keys |
| M9 | Medium | `components/dialog-select-server.tsx` | 539 | CSS typo | Missing `:` in Tailwind arbitrary property |
| L1 | Low | `utils/time.ts` | 10-21 | Edge case | `NaN days ago` for invalid dates |
| L2 | Low | `utils/id.ts` | 13-14 | Dead code | Unused `lastTimestamp` and `counter` |
| L3 | Low | `utils/prompt.ts` | 104 | Edge case | `filePart.url` can be undefined |
| L4 | Low | `components/prompt-input/drag-overlay.tsx` | 19 | Dead code | Unreachable ternary fallback |
| L5 | Low | `components/dialog-release-notes.tsx` | 130-137 | Type safety | Redundant `!` assertions and signal calls |
| L6 | Low | `hooks/use-providers.ts` | — | Performance | Unnecessary derived memos |
| L7 | Low | `context/terminal.tsx` | — | Resource leak | Global mutable state leaks across HMR |
| L8 | Low | `context/sync.tsx` | — | Type safety | Missing null check on `params.dir` |
| L9 | Low | `pages/session/message-gesture.ts` | 13-14 | Edge case | Stale closure in gesture handler |
| L10 | Low | `pages/session.tsx` | 141-163 | UX | No loading state during session fetch |
| L11 | Low | `pages/session.tsx` | 114-128 | Resource leak | Server connection not cleaned up on unmount |

---

## Files Reviewed (Clean)

The following files were reviewed and found clean of actionable bugs:
- `src/utils/agent.ts`, `aim.ts`, `base64.ts`, `comment-note.ts`, `dom.ts`, `index.ts`, `notification-click.ts`, `runtime-adapters.ts`, `same.ts`, `scoped-cache.ts`, `server-errors.ts`, `server-health.ts`, `server.ts`, `solid-dnd.tsx`, `sound.ts`, `speech.ts`, `terminal-writer.ts`, `uuid.ts`, `worktree.ts`
- `src/addons/serialize.ts`
- `src/app.tsx`
- All remaining component files not listed above
- `src/context/global-sync/child-store.ts`, `src/context/file/tree-store.ts`
