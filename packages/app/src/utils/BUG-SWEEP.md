# Utils Bug Sweep — Critique Artifact

**Scope:** 23 files in `packages/app/src/utils/` (excluding `.test.ts`)
**Date:** 2026-04-03

---

## BUG-1: Dead code — unused module variables

**File:** `id.ts:13-14`
**Severity:** Low (dead code)

```ts
12: const LENGTH = 26
13: let lastTimestamp = 0
14: let counter = 0
```

`lastTimestamp` and `counter` are declared at module scope but never referenced anywhere in the file. The `generate` function (line ~59) uses `Date.now()` for the time component and `randomBase62()` for randomness — these two variables are remnants of a prior implementation.

**Impact:** None at runtime. Adds noise and may mislead future readers into thinking collision-avoidance logic exists where it doesn't.

**Fix:** Remove lines 13–14.

---

## BUG-2: Quota eviction silently skips non-opencode-prefixed keys

**File:** `persist.ts:109`
**Severity:** Medium (silent data-loss under quota pressure)

```ts
 19: const LOCAL_PREFIX = "opencode."
     ...
101: function evict(storage: Storage, keep: string, value: string) {
     ...
109:     if (!name.startsWith(LOCAL_PREFIX)) continue
```

The `evict` function is called when `localStorage` throws a quota error. It iterates all keys and only considers evicting those starting with `"opencode."`. However, `localStorageWithPrefix(prefix)` (line 212) can produce keys like `"myapp:someKey"` when given an arbitrary prefix — those keys would be skipped by `evict`, meaning quota recovery silently fails for any storage scope whose prefix doesn't begin with `"opencode."`.

**Impact:** If a new storage type or prefix is added that doesn't start with `"opencode."`, quota eviction will remove nothing and the write will fail silently (the `write` function returns `false` and the caller's `setItem` becomes a no-op). Data appears saved but is dropped.

**Fix:** Pass the relevant prefix into `evict` and use it for the `startsWith` check instead of the hardcoded `LOCAL_PREFIX`.

---

## BUG-3: Unhandled undefined `url` on FilePart

**File:** `prompt.ts:104`
**Severity:** Medium (runtime crash)

```ts
104:       if (filePart.url.startsWith("data:")) {
```

If `filePart.url` is `undefined` (e.g., a FilePart that has neither `source.text` nor a resolved URL), calling `.startsWith()` throws `TypeError: Cannot read properties of undefined`.

The code path is reached when a `FilePart` exists but `filePart.source?.text` is falsy (line 83). There is no guard on `filePart.url` before dereferencing it.

**Impact:** `extractPromptFromParts` crashes on any FilePart without a URL, breaking prompt restoration for that message.

**Fix:** Add a guard: `if (!filePart.url) continue` before line 104, or use optional chaining: `if (filePart.url?.startsWith("data:"))`.

---

## BUG-4: Invalid date strings produce NaN output

**File:** `time.ts:10-21`
**Severity:** Low (cosmetic / UX)

```ts
 9: export function getRelativeTime(dateString: string, t: Translate): string {
10:   const date = new Date(dateString)
11:   const now = new Date()
12:   const diffMs = now.getTime() - date.getTime()
     ...
18:   if (diffSeconds < 60) return t("common.time.justNow")
19:   if (diffMinutes < 60) return t("common.time.minutesAgo.short", { count: diffMinutes })
20:   if (diffHours < 24) return t("common.time.hoursAgo.short", { count: diffHours })
21:   return t("common.time.daysAgo.short", { count: diffDays })
22: }
```

If `dateString` is invalid (e.g., `""`, `"not-a-date"`, or a malformed timestamp), `new Date(dateString)` produces an Invalid Date and `date.getTime()` returns `NaN`. All subsequent arithmetic yields `NaN`, and every comparison (`NaN < 60`, etc.) is `false`, so execution falls through to line 21 and returns `"common.time.daysAgo.short"` with `{ count: NaN }`.

**Impact:** Users see "NaN days ago" or a translated equivalent for any record with a bad timestamp.

**Fix:** Add `if (isNaN(date.getTime())) return dateString` (or a fallback like `"unknown"`) after line 10.

---

## BUG-5: `evict` permanently deletes items even when quota recovery fails

**File:** `persist.ts:117-128`
**Severity:** Low (data-loss edge case)

```ts
117:   for (const item of items) {
118:     storage.removeItem(item.key)
119:     cacheDelete(item.key)
120:
121:     try {
122:       storage.setItem(keep, value)
123:       cacheSet(keep, value)
124:       return true
125:     } catch (error) {
126:       if (!quota(error)) throw error
127:     }
128:   }
```

Each item is removed *before* confirming the target write succeeds. If the target write fails quota on every iteration, all evicted items are gone and unrecoverable. The function returns `false` (line 130), but the damage is done.

**Impact:** In extreme quota scenarios (localStorage nearly full with large values), calling `setItem` can delete other keys without successfully writing the new one.

**Fix:** Attempt the write first before removing each item, or batch-remove only after confirming the write would succeed (e.g., by checking available quota or using a trial write).

---

## Clean files (no bugs found)

| File | Notes |
|---|---|
| `agent.ts` | Simple lookup, safe null handling |
| `aim.ts` | State machine is correct; enabled/disabled gating is sound |
| `base64.ts` | Try/catch covers decode errors |
| `comment-note.ts` | Regex and group extraction are correct |
| `dom.ts` | Range/TreeWalker usage is standard; null guards present |
| `index.ts` | Single re-export |
| `notification-click.ts` | Graceful fallback to `location.assign` |
| `runtime-adapters.ts` | Defensive type guards, no unsafe casts |
| `same.ts` | Reference + shallow equality, correct |
| `scoped-cache.ts` | TTL, prune, and dispose logic are sound |
| `server-errors.ts` | Translator fallback and error shape checks correct |
| `server-health.ts` | Retry logic, abort signals, and timeout cleanup correct |
| `server.ts` | Basic auth header construction correct |
| `solid-dnd.tsx` | `createAxisConstraint` returns a component function; `useDragDropContext` is called at render time, not module init |
| `sound.ts` | `play().catch()` handles autoplay rejection; cleanup returned |
| `speech.ts` | Complex but correct: restart timers, hypothesis tracking, and cleanup all guarded |
| `terminal-writer.ts` | Microtask scheduling with write-in-progress guard is correct |
| `uuid.ts` | Secure-context check and crypto fallback correct |
| `worktree.ts` | Deferred promise pattern and state machine correct |

---

## Summary

| # | File | Line | Severity | Category |
|---|---|---|---|---|
| 1 | `id.ts` | 13-14 | Low | Dead code |
| 2 | `persist.ts` | 109 | Medium | Logic error / silent failure |
| 3 | `prompt.ts` | 104 | Medium | Unhandled null reference |
| 4 | `time.ts` | 10-21 | Low | Missing edge-case validation |
| 5 | `persist.ts` | 117-128 | Low | Data-loss on quota exhaustion |
