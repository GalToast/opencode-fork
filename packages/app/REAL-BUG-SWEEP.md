# Real Bug Sweep: Context Providers

**Scope:** All `.tsx` files in `packages/app/src/context/` (19 files)
**Date:** 2026-04-03
**Method:** Manual source review of every file

---

## BUG-1: Unhandled promise rejection — `loadMessages` in `sync.tsx`

**Severity:** HIGH
**File:** `packages/app/src/context/sync.tsx`
**Lines:** 149-162, 253, 317

`loadMessages` uses `.then(...).finally(...)` with no `.catch()`. If `fetchMessages` throws (server unreachable, 500, etc.), the rejection propagates:

```typescript
// Line 149-162
await fetchMessages(input)
  .then((next) => {
    batch(() => {
      input.setStore("message", input.sessionID, reconcile(next.session, { key: "id" }))
      for (const p of next.part) {
        input.setStore("part", p.id, p.part)
      }
      setMeta("limit", key, input.limit)
      setMeta("complete", key, next.complete)
    })
  })
  .finally(() => {
    setMeta("loading", key, false)
  })
```

Callers also don't catch:
- Line 253: `runInflight(inflight, key, () => Promise.all([sessionReq, messagesReq]).then(() => {}))` — `.then(() => {})` swallows success but not rejection.
- Line 317: `await loadMessages(...)` in `history.loadMore` — no try/catch.

Downstream callers fire-and-forget the result:
- `pages/session.tsx:215` — `void fetchOlderMessages({ prefetch: true })`
- `pages/session.tsx:221` — `void fetchOlderMessages()`
- `pages/session.tsx:1243` — `void historyWindow.loadAndReveal()`

**Fix:** Add `.catch(() => {})` to `loadMessages` or wrap callers in try/catch.

---

## BUG-2: Unhandled promise rejection — `session.diff` and `session.todo` in `sync.tsx`

**Severity:** HIGH
**File:** `packages/app/src/context/sync.tsx`
**Lines:** 262-266, 286-292

Both `diff` and `todo` use `retry(...).then(...)` with no `.catch()`:

```typescript
// Line 262-266
return runInflight(inflightDiff, key, () =>
  retry(() => client.session.diff({ sessionID })).then((diff) => {
    setStore("session_diff", sessionID, reconcile(diff.data ?? [], { key: "file" }))
  }),
)

// Line 286-292
return runInflight(inflightTodo, key, () =>
  retry(() => client.session.todo({ sessionID })).then((todo) => {
    const list = todo.data ?? []
    setStore("todo", sessionID, reconcile(list, { key: "id" }))
    globalSync.todo.set(sessionID, list)
  }),
)
```

Callers fire-and-forget:
- `pages/session.tsx:523` — `void sync.session.todo(id)`
- `pages/session.tsx:999` — `void sync.session.diff(id)`

**Fix:** Add `.catch(() => {})` to both, or wrap callers.

---

## BUG-3: Type unsafety — `setStore` cast to `unknown[]` in `sync.tsx`

**Severity:** LOW
**File:** `packages/app/src/context/sync.tsx`
**Lines:** 189, 193

```typescript
// Line 189
setOptimisticAdd(setStore as (...args: unknown[]) => void, input)
// Line 193
setOptimisticRemove(setStore as (...args: unknown[]) => void, input)
```

The `setStore` from `globalSync.child()` is a typed SolidJS store setter. Casting to `(...args: unknown[]) => void` bypasses all type checking. If the setter signature changes, this will silently break at runtime.

**Fix:** Either widen the parameter type of `setOptimisticAdd`/`setOptimisticRemove` to accept the actual setter type, or use a proper type guard instead of `as unknown`.

---

## BUG-4: Dead async methods — `session.fetch` and `session.archive` in `sync.tsx`

**Severity:** LOW (dead code risk)
**File:** `packages/app/src/context/sync.tsx`
**Lines:** 326-337 (`fetch`), 340-351 (`archive`)

Both `session.fetch` and `session.archive` are defined but never called anywhere in the codebase (confirmed via grep across all `.tsx` files). They contain unhandled `await` calls:

```typescript
// Line 331
await client.session.list().then((x) => { ... })  // no .catch()

// Line 344
await client.session.update({ sessionID, time: { archived: Date.now() } })  // no try/catch
```

If these methods are ever wired up to UI, they will throw unhandled rejections.

**Fix:** Either remove dead code or add error handling before exposing to UI.

---

## Files Confirmed Clean

| File | Status | Notes |
|------|--------|-------|
| `sdk.tsx` | ✅ Clean | Event subscription has `onCleanup(unsub)` at line 30 |
| `global-sdk.tsx` | ✅ Clean | Event subscription has `onCleanup(unsub)` at line 142 |
| `global-sync.tsx` | ✅ Clean | `active` flag + `onCleanup` at line 83-85 guards background writes |
| `server.tsx` | ✅ Clean | `onCleanup` for event subscription, null-safe `origin()` guards |
| `layout.tsx` | ✅ Clean | `onCleanup` for resize observer at line 570, null-safe `store.sessionTabs[session]` guards |
| `terminal.tsx` | ✅ Clean | `onCleanup(unsub)` at line 119, `onCleanup(disposeAll)` at line 291 |
| `permission.tsx` | ✅ Clean | `respond` has `.catch(() => {})` at line 97, `onCleanup` at line 121 |
| `language.tsx` | ✅ Clean | Pure store + effect, no async |
| `settings.tsx` | ✅ Clean | Pure persisted store, no async |
| `models.tsx` | ✅ Clean | Pure store + memo, no async or subscriptions |
| `highlights.tsx` | ✅ Clean | Simple effect with `onCleanup`, platform null guard |
| `prompt.tsx` | ✅ Clean | `createRoot` entries properly disposed via cache prune + `onCleanup` |
| `comments.tsx` | ✅ Clean | `createRoot` entries properly disposed via cache `onCleanup(() => cache.clear())` |
| `file.tsx` | ✅ Clean | Proper `onCleanup` for event subscriptions, null-safe access patterns |
| `command.tsx` | ✅ Clean | Proper `onCleanup` for keyboard listener, null-safe optional chaining |
| `notification.tsx` | ✅ Clean | Proper `onCleanup`, batched store updates, null-safe `?? empty` patterns |
| `local.tsx` | ✅ Clean | Pure memo + store, no async or subscriptions |
| `platform.tsx` | ✅ Clean | Pure type definition + passthrough provider |

---

## Summary

| Severity | Count | Files |
|----------|-------|-------|
| HIGH | 2 | `sync.tsx` (BUG-1: `loadMessages`, BUG-2: `diff`/`todo`) |
| LOW | 2 | `sync.tsx` (BUG-3: type cast, BUG-4: dead async methods) |

**Total confirmed bugs: 4** across 1 file (`sync.tsx`). All are unhandled promise rejections or type unsafety in async paths. The two HIGH severity bugs will surface as runtime errors when the server is unreachable or returns an error response, with no user-visible feedback.
