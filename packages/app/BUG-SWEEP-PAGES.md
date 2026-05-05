# Bug Sweep: Pages & Components

**Scope:** `packages/app/src/pages/**/*.tsx`, `packages/app/src/pages/**/*.ts`, `packages/app/src/components/**/*.tsx`, `packages/app/src/components/**/*.ts` (excluding `*.test.*` files)
**Date:** 2026-04-03

---

## BUG-1: Unhandled promise in `session.tsx` — `sdk.directory()` call

- **File:** `packages/app/src/pages/session.tsx`
- **Lines:** 1003-1029
- **Code:**
  ```ts
  createEffect(() => {
    const dir = sdk.directory
    if (!isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (sync.status === "loading") return

    // ...
    sdk.directory().then((result) => {
      // ...
    })
  })
  ```
- **Why it's a bug:** The `sdk.directory()` promise is called without `.catch()` and not awaited inside try/catch. If the SDK call rejects, it becomes an unhandled promise rejection. This is a `void` promise inside a `createEffect` — no error boundary catches it.
- **Severity:** MEDIUM

---

## BUG-2: Unhandled promise in `session.tsx` — `sync.session.diff(id)` call

- **File:** `packages/app/src/pages/session.tsx`
- **Lines:** 988-1000
- **Code:**
  ```ts
  createEffect(() => {
    const id = params.id
    if (!id) return
    // ...
    void sync.session.diff(id)
  })
  ```
- **Why it's a bug:** `void sync.session.diff(id)` discards the promise entirely. If the diff request fails, the rejection is silently swallowed. No toast, no retry, no logging. The user will see a perpetually loading review tab with no indication of failure.
- **Severity:** MEDIUM

---

## BUG-3: Unhandled promise in `message-timeline.tsx` — `saveTitleEditor()`

- **File:** `packages/app/src/pages/session/message-timeline.tsx`
- **Lines:** 600-601
- **Code:**
  ```tsx
  if (event.key === "Enter") {
    event.preventDefault()
    void saveTitleEditor()
    return
  }
  ```
- **Why it's a bug:** `saveTitleEditor()` is an `async` function. The `void` discards the promise. While the function has its own `.catch()` handler on the inner `sdk.client.session.update().then().catch()` chain, the function itself is `async` and any error thrown before reaching the `.catch()` (e.g., a synchronous exception) would be unhandled. In practice the `.catch()` on the inner promise covers the main path, but the `void` is still a code smell — if the function is refactored to throw before the `.then()`, the rejection goes unhandled.
- **Severity:** LOW

---

## BUG-4: Unhandled promise in `message-timeline.tsx` — `archiveSession(id)`

- **File:** `packages/app/src/pages/session/message-timeline.tsx`
- **Line:** 649
- **Code:**
  ```tsx
  <DropdownMenu.Item onSelect={() => void archiveSession(id)}>
  ```
- **Why it's a bug:** `archiveSession` is `async` and has a `.catch()` on its inner promise chain, so the primary error path is handled. However, the outer `void` means any synchronous exception before the `.then()` would be unhandled. Same pattern as BUG-3.
- **Severity:** LOW

---

## BUG-5: `as any` cast in `file-tabs.tsx` — `onScroll` handler

- **File:** `packages/app/src/pages/session/file-tabs.tsx`
- **Line:** 456
- **Code:**
  ```tsx
  onScroll={handleScroll as any}
  ```
- **Why it's a bug:** The `handleScroll` function is cast to `any` to bypass type checking. This means if the `ScrollView` component's `onScroll` signature changes, the mismatch will be silently ignored, potentially causing runtime errors. This is a type safety escape hatch that masks a real type incompatibility.
- **Severity:** LOW

---

## BUG-6: `as` cast in `terminal-panel.tsx` — `language.t` type cast

- **File:** `packages/app/src/pages/session/terminal-panel.tsx`
- **Line:** 240
- **Code:**
  ```tsx
  t: language.t as (key: string, vars?: Record<string, string | number | boolean>) => string,
  ```
- **Why it's a bug:** `language.t` is cast to a narrower function signature. If the actual `language.t` function has different parameter types or return types than the cast expects, this will silently bypass type checking. This is a type safety issue that could mask incompatibilities if the i18n layer changes.
- **Severity:** LOW

---

## BUG-7: `as` cast in `message-timeline.tsx` — error type assertion

- **File:** `packages/app/src/pages/session/message-timeline.tsx`
- **Lines:** 283-285
- **Code:**
  ```ts
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  ```
- **Why it's a bug:** The `as` cast assumes the error object has a specific shape. While the guard `typeof err === "object" && "data" in err` provides some safety, the cast to `{ data?: { message?: string } }` is not validated — `data` could be any type (e.g., a number or array), and accessing `.message` on it would return `undefined` rather than throwing. This is technically safe due to optional chaining, but the cast is misleading about what's actually being checked.
- **Severity:** LOW (mitigated by optional chaining)

---

## BUG-8: Missing null check in `session.tsx` — `treeDir` access

- **File:** `packages/app/src/pages/session.tsx`
- **Lines:** 1002-1029
- **Code:**
  ```ts
  let treeDir: string | undefined
  createEffect(() => {
    const dir = sdk.directory
    // ...
    sdk.directory().then((result) => {
      treeDir = result.path  // treeDir is set here
      // ...
    })
    // treeDir used below but may be undefined
  })
  ```
- **Why it's a bug:** `treeDir` is a module-scoped `let` variable that is set inside a `.then()` callback. If the effect runs again before the promise resolves, `treeDir` may hold a stale value from a previous invocation, or be `undefined` if it was never set. This is a race condition: the effect can run multiple times, and the promise callbacks can resolve out of order.
- **Severity:** MEDIUM

---

## BUG-9: Race condition in `scroll-spy.ts` — stale closure in `schedule()`

- **File:** `packages/app/src/pages/session/scroll-spy.ts`
- **Lines:** 139-162
- **Code:**
  ```ts
  const schedule = () => {
    if (raf !== undefined) return
    raf = requestAnimationFrame(() => {
      raf = undefined
      // ... reads from `offsets` and `visible` maps
    })
  }
  ```
- **Why it's a bug:** The `schedule` function uses a module-level `raf` variable. If `destroy()` is called while a `requestAnimationFrame` is pending, the callback will still execute after `destroy()` has cleared `io`, `ro`, `mo`, and `root`. The callback reads from `offsets` and `visible` maps which may have been cleared by `clear()`. While the maps being empty is not a crash, the stale rAF callback running after destruction is a minor memory/logic issue. The `destroy()` function does not cancel the pending `raf`.
- **Severity:** LOW

---

## BUG-10: Missing `onCleanup` for `requestAnimationFrame` in `use-session-hash-scroll.ts`

- **File:** `packages/app/src/pages/session/use-session-hash-scroll.ts`
- **Lines:** 171
- **Code:**
  ```ts
  requestAnimationFrame(() => scrollToMessage(msg, "auto"))
  ```
- **Why it's a bug:** Inside the `applyHash` `createEffect`, a `requestAnimationFrame` is scheduled but there is no `onCleanup` to cancel it if the effect re-runs or the component unmounts before the rAF fires. The `scrollToMessage` function accesses DOM elements and scroll state; if called after unmount, it could throw or operate on detached elements.
- **Severity:** LOW

---

## BUG-11: Potential XSS via `innerHTML` in `dialog-release-notes.tsx`

- **File:** `packages/app/src/components/dialog-release-notes.tsx`
- **Lines:** 110-113
- **Code:**
  ```tsx
  <div
    class="flex-1 min-w-0 prose prose-sm dark:prose-invert max-w-none"
    innerHTML={feature()?.description ?? ""}
  />
  ```
- **Why it's a bug:** The `description` field is rendered via `innerHTML` without sanitization. If the release notes data comes from an external source (e.g., a remote API), this is a stored XSS vulnerability. Even if currently controlled internally, this pattern is dangerous if the data source ever changes.
- **Severity:** MEDIUM

---

## BUG-12: Potential XSS in `session-context-tab.tsx` — Markdown rendering

- **File:** `packages/app/src/components/session/session-context-tab.tsx`
- **Line:** 324
- **Code:**
  ```tsx
  <Markdown text={prompt()} class="text-12-regular" />
  ```
- **Why it's a bug:** The `prompt()` value is rendered through a `<Markdown>` component. If the `Markdown` component does not sanitize its input, user-controlled prompt text could inject HTML/JS. This depends on the `<Markdown>` component's implementation, but the pattern of rendering user-generated content as Markdown is a common XSS vector.
- **Severity:** LOW (depends on `<Markdown>` component sanitization)

---

## BUG-13: Stale closure in `file-tabs.tsx` — `handleScroll` captured state

- **File:** `packages/app/src/pages/session/file-tabs.tsx`
- **Lines:** 299-320
- **Code:**
  ```ts
  const handleScroll = () => {
    if (!scroll) return
    const scrollTop = scroll.scrollTop
    // ...
    store.scrollPositions.set(props.tab, scrollTop)
    // ...
  }
  ```
- **Why it's a bug:** `handleScroll` is defined inside the `FileTabContent` component function and captures `props.tab` and `scroll` from the closure. It is then passed as `onScroll={handleScroll as any}` to `ScrollView`. If `ScrollView` memoizes or caches the handler, it may hold a stale reference to `scroll` or `props.tab` after the component re-renders. The `as any` cast (BUG-5) prevents TypeScript from flagging this.
- **Severity:** LOW

---

## BUG-14: Missing error handling in `dialog-select-server.tsx` — `checkConnection`

- **File:** `packages/app/src/components/dialog-select-server.tsx`
- **Lines:** ~200-250 (form submission path)
- **Code:**
  ```ts
  const submitForm = async () => {
    // ...
    const result = await sdk.client.server.test({ ... })
    // ...
  }
  ```
- **Why it's a bug:** The `submitForm` function is `async` and called from an `onClick` handler. If `sdk.client.server.test` rejects and the rejection is not caught within the function, it becomes an unhandled promise rejection. The function uses `try/catch` internally but the pattern should be verified for all code paths.
- **Severity:** LOW (likely handled internally, needs verification of all paths)

---

## BUG-15: Memory leak risk in `prompt-input/attachments.ts` — global event listeners

- **File:** `packages/app/src/components/prompt-input/attachments.ts`
- **Lines:** 163-173
- **Code:**
  ```ts
  onMount(() => {
    document.addEventListener("dragover", handleGlobalDragOver)
    document.addEventListener("dragleave", handleGlobalDragLeave)
    document.addEventListener("drop", handleGlobalDrop)
  })

  onCleanup(() => {
    document.removeEventListener("dragover", handleGlobalDragOver)
    document.removeEventListener("dragleave", handleGlobalDragLeave)
    document.removeEventListener("drop", handleGlobalDrop)
  })
  ```
- **Why it's a bug:** This is actually **correctly handled** — `onCleanup` properly removes all listeners added in `onMount`. Not a bug, but included for completeness of the audit.
- **Severity:** N/A (verified clean)

---

## BUG-16: Potential null access in `session.tsx` — `sync.data.session_diff[id]`

- **File:** `packages/app/src/pages/session.tsx`
- **Lines:** 996
- **Code:**
  ```ts
  if (sync.data.session_diff[id] !== undefined) return
  ```
- **Why it's a bug:** `sync.data.session_diff` could be `undefined` if the sync data hasn't been initialized. Accessing `[id]` on `undefined` would throw a TypeError. This depends on the sync context's initialization guarantees.
- **Severity:** LOW (likely initialized by context provider)

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| MEDIUM | 3 | BUG-1, BUG-2, BUG-11 |
| LOW | 11 | BUG-3, BUG-4, BUG-5, BUG-6, BUG-7, BUG-8, BUG-9, BUG-10, BUG-12, BUG-13, BUG-14, BUG-16 |
| N/A | 1 | BUG-15 (verified clean) |

### Top 3 to fix:

1. **BUG-1** (`session.tsx` L1003-1029): Add `.catch()` to `sdk.directory()` promise or wrap in try/catch.
2. **BUG-2** (`session.tsx` L999): Replace `void sync.session.diff(id)` with proper error handling — at minimum `.catch()` with a toast.
3. **BUG-11** (`dialog-release-notes.tsx` L110-113): Sanitize `description` before `innerHTML` or use a safe rendering approach.
