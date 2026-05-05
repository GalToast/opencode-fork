# Performance Bug Sweep Findings

**Date:** 2026-04-02  
**Codebase:** opencode fork at `/c/Users/HP/repos/opencode`  
**Focus:** Performance Issues in Hot Paths

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 8 |
| Medium | 12 |
| Low | 6 |

---

## Critical Issues

### 1. Unbounded Memory Growth in Module-Level Maps (CRITICAL)

**File:** `packages/opencode/src/session/workgraph.ts:95-136`

**Issue:** Multiple module-level Maps grow without bounds:
- `semanticArtifactIndexState` - stores artifact fingerprints
- `semanticSessionIndexState` - stores session timestamps  
- `semanticDigestState` - stores semantic patterns and policies
- `semanticSearchState` - stores search results
- `semanticSearchInflight` - stores in-flight promises

```typescript
const semanticArtifactIndexState = new Map<string, string>()
const semanticSessionIndexState = new Map<string, number>()
const semanticDigestState = new Map<string, { ... }>()
const semanticSearchState = new Map<string, { ... }>()
const semanticSearchInflight = new Map<string, { ... }>()
```

**Impact:** In long-running sessions or projects with many sessions, these maps grow indefinitely, causing memory leaks. No cleanup mechanism exists.

**Recommendation:** Implement TTL-based eviction or LRU cache with configurable limits. Clear entries when sessions are archived or deleted.

---

### 2. Checkpoint Scan Reads All Files on Every Resume (CRITICAL)

**File:** `packages/opencode/src/harness/session.ts:798-816`

**Issue:** `findLatestCheckpointForInput()` scans ALL checkpoint files in directory, reads each JSON file individually:

```typescript
async function findLatestCheckpointForInput(input) {
  const dir = checkpointsDir()
  const entries = await readdir(dir).catch(() => [] as string[])
  
  let latest: HarnessSessionCheckpoint | undefined
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    const checkpoint = await loadCheckpoint(entry.replace(".json", "")).catch(() => undefined)
    // ... reads and parses every JSON file
  }
}
```

**Impact:** O(n) file reads on every harness session start. With many checkpoints, this becomes extremely slow and I/O bound.

**Recommendation:** Use an index file with title→checkpointID mapping, or maintain an in-memory index that's persisted incrementally.

---

### 3. N+1 Query Pattern in Session Family Collection (CRITICAL)

**File:** `packages/opencode/src/session/workgraph.ts:138-150`

**Issue:** `collectSessionFamilyIDs()` performs iterative DB lookups:

```typescript
export function collectSessionFamilyIDs(rootSessionID: string) {
  const family = new Set<string>([rootSessionID])
  const queue = [rootSessionID]
  while (queue.length > 0) {
    const next = queue.shift()!
    for (const child of Session.children(next)) {  // DB query per node
      if (family.has(child.id)) continue
      family.add(child.id)
      queue.push(child.id)
    }
  }
  return [...family]
}
```

**Impact:** Each `Session.children()` call hits the database. For deep session trees, this creates O(depth × children) DB queries.

**Recommendation:** Single query with recursive CTE or pre-fetch all children for a project.

---

## High Severity Issues

### 4. JSON.stringify in Hot Path for Fingerprinting (HIGH)

**File:** `packages/opencode/src/session/workgraph.ts:673-715`

**Issue:** Multiple `JSON.stringify` calls for fingerprinting in hot paths:

```typescript
function semanticDigestFingerprint(input) {
  return createHash("sha1")
    .update(JSON.stringify({
      query: input.query,
      rootSessionID: input.info.rootSessionID,
      preferredSessionIDs: input.preferredSessionIDs,
      relevantSessionActivity,
      artifactFingerprint: semanticArtifactIndexFingerprint(input.info),
      currentSourceID: input.currentSourceID ?? null,
      limit: input.limit ?? 3,
    }))
    .digest("hex")
}
```

**Impact:** Called on every semantic digest/search operation. Large objects cause significant CPU overhead.

**Recommendation:** Cache fingerprints, use incremental hashing, or lazy-compute.

---

### 5. Repeated JSON.stringify for Tool Input Comparison (HIGH)

**File:** `packages/opencode/src/session/processor.ts:459`

**Issue:** Doom loop detection serializes objects twice per comparison:

```typescript
lastThree.every((p) =>
  p.type === "tool" &&
  p.tool === value.toolName &&
  p.state.status !== "pending" &&
  JSON.stringify(p.state.input) === JSON.stringify(value.input),
)
```

**Impact:** On every tool call, this can perform up to 6 `JSON.stringify` operations.

**Recommendation:** Use deep equality check or hash-based comparison. Cache serialized inputs.

---

### 6. Missing Cleanup for Heartbeat Timers (HIGH)

**File:** `packages/opencode/src/tool/task.ts:1025, 5011`

**Issue:** Heartbeat timers stored in module-level map without guaranteed cleanup:

```typescript
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()
// ...
const timer = setInterval(() => { ... }, heartbeatIntervalMS)
```

**Impact:** If task cleanup fails (error, crash), timers continue running and memory leaks.

**Recommendation:** Use AbortController pattern with guaranteed cleanup in finally block. Add periodic sweep of orphaned timers.

---

### 7. Polling Loop Without Backoff (HIGH)

**File:** `packages/opencode/src/harness/session.ts:1763-1772`

**Issue:** Fixed 3-second polling interval:

```typescript
messagesPollHandle = setInterval(() => {
  void pollLatestAssistantMessage().catch((pollError) => { ... })
}, 3_000)
```

**Impact:** Constant polling regardless of activity. No backoff when idle, no faster polling when active.

**Recommendation:** Exponential backoff when no changes detected, faster polling during active streaming.

---

### 8. Synchronous Snapshot Tracking on Every Step (HIGH)

**File:** `packages/opencode/src/session/processor.ts:557-565`

**Issue:** `Snapshot.track()` called synchronously at step start:

```typescript
case "start-step":
  snapshot = await Snapshot.track()  // Blocking I/O
  Session.updatePart({ ... })
  break
```

**Impact:** Filesystem operations block the main processing loop during each model step.

**Recommendation:** Run snapshot tracking asynchronously or lazily. Defer until step completion.

---

### 9. No Batching for Part Updates (HIGH)

**File:** `packages/opencode/src/session/processor.ts:340-412`

**Issue:** Each reasoning delta triggers immediate DB update:

```typescript
case "reasoning-delta":
  Session.updatePartDelta({  // DB write per delta
    sessionID: part.sessionID,
    messageID: part.messageID,
    partID: part.id,
    field: "text",
    delta: value.text,
  })
```

**Impact:** Streaming responses with thousands of tokens cause thousands of DB writes.

**Recommendation:** Batch updates with debouncing (e.g., every 100ms or 50 tokens).

---

### 10. Inefficient String Concatenation in Streaming (HIGH)

**File:** `packages/opencode/src/harness/session.ts:1519-1543`

**Issue:** On every delta, entire output is re-joined:

```typescript
const partialRaw = streamedPartOrder
  .map((id) => streamedPartTexts.get(id) ?? "")
  .filter(Boolean)
  .join("\n\n")
  .trim()

// Called for EVERY delta event
```

**Impact:** O(n²) string concatenation as parts grow during streaming.

**Recommendation:** Incrementally build string, only recompute changed portions.

---

### 11. Chrome Instance Pool No Pre-warming (HIGH)

**File:** `packages/opencode/src/harness/session.ts:222-228, 1249-1265`

**Issue:** Chrome instances acquired synchronously during session start:

```typescript
chromeInstance = await chromePool.acquire({
  workerId: input.lane ?? 'author',
  timeout: 30000,  // Can block for 30s
})
```

**Impact:** First session of each type waits for Chrome spawn. `prewarm` config option exists but not implemented.

**Recommendation:** Implement pre-warming on startup. Use async acquisition with fallback.

---

## Medium Severity Issues

### 12. Token Computation Repeated for Every Message (MEDIUM)

**File:** `packages/opencode/src/session/prompt.ts:282-305`

**Issue:** `reasoningTokens()` called repeatedly in nested loops:

```typescript
function reasoningScore(input) {
  const left = new Set(reasoningTokens(input.left))   // Tokenizes
  const right = new Set(reasoningTokens(input.right)) // Tokenizes again
  // ...
}

// Called in loops for falsifier resolution
```

**Impact:** Same text tokenized multiple times in reasoning ledger processing.

**Recommendation:** Cache tokenization results with WeakMap.

---

### 13. Unbounded Set in Semantic Stopwords (MEDIUM)

**File:** `packages/opencode/src/session/workgraph.ts:20-94`

**Issue:** Large stopwords set created at module load:

```typescript
const semanticStopwords = new Set([
  "a", "an", "and", "are", /* ... 80+ entries */
])
```

**Impact:** Acceptable size but pattern repeated across multiple files. Could be shared.

**Files affected:**
- `session/workgraph.ts:20-94`
- `retrieval/service.ts:34-99`

**Recommendation:** Extract to shared utility.

---

### 14. Deferred Cleanup May Never Run (MEDIUM)

**File:** `packages/opencode/src/session/prompt.ts:714`

**Issue:** `SessionRevert.cleanup()` may leave dangling resources:

```typescript
await SessionRevert.cleanup(session)
```

**Impact:** If process crashes before cleanup, revert snapshots accumulate.

**Recommendation:** Periodic cleanup job or startup cleanup for orphaned snapshots.

---

### 15. JIT Hydration Timeout Race (MEDIUM)

**File:** `packages/opencode/src/session/llm.ts:205-258`

**Issue:** JIT hydration has 1500ms timeout but race condition exists:

```typescript
const jitContext = await Promise.race([
  JitHydrator.hydrate({ ... }),
  new Promise<undefined>((resolve) =>
    (jitTimer = setTimeout(() => {
      jitAbort.abort()
      resolve(undefined)
    }, jitTimeoutMS))
  ),
])
```

**Impact:** If hydration succeeds just after timeout fires, both branches may execute.

**Recommendation:** Use proper AbortSignal integration and cleanup.

---

### 16. In-Memory Task Cache Without Eviction (MEDIUM)

**File:** `packages/opencode/src/tool/task.ts:1380`

**Issue:** Cache entry deleted after 5s timeout but race condition:

```typescript
setTimeout(() => trackerTaskMapCache().delete("all"), 5000)
```

**Impact:** Multiple concurrent callers may trigger multiple timers, partial cache invalidation.

**Recommendation:** Single debounced invalidation or proper cache TTL.

---

### 17. Message List Reversed Multiple Times (MEDIUM)

**File:** `packages/opencode/src/session/message-v2.ts` (multiple locations)

**Issue:** Patterns like `.toReversed().find()` create intermediate arrays:

```typescript
const candidateAssistant = messageList
  ? [...messageList].reverse().find((message) => message?.info?.role === "assistant")
  : undefined
```

**Impact:** Array copy + reverse on every poll iteration.

**Recommendation:** Iterate from end directly or cache reversed view.

---

### 18. Regex Compilation in Hot Loops (MEDIUM)

**File:** `packages/opencode/src/session/compaction.ts:237-248`

**Issue:** Regex created inside function called frequently:

```typescript
function compactionTechnicalityScore(text: string) {
  let score = 0
  if (/[\\/][\w./-]+/.test(text)) score += 2.5
  if (/\b[a-z0-9._-]+\.[a-z]{2,}\b/i.test(text)) score += 1.2
  // ... more regex tests
}
```

**Impact:** Regex compilation on every call.

**Recommendation:** Hoist regex to module level constants.

---

### 19. Semaphore Wait Without Queue (MEDIUM)

**File:** `packages/opencode/src/harness/session.ts` (various)

**Issue:** No backpressure mechanism for concurrent operations:

```typescript
const chromePool = new ChromeInstancePool({
  instanceCount: 3,  // Fixed pool
  // ...
})
```

**Impact:** When pool exhausted, requests queue indefinitely without feedback.

**Recommendation:** Add queue depth monitoring, rejection on overload.

---

### 20. World State Materialization Not Cached (MEDIUM)

**File:** `packages/opencode/src/session/workgraph.ts:754-798`

**Issue:** `materializeWorldState()` called repeatedly without caching:

```typescript
async function materializeWorldState(input) {
  const reasoningLedger = await SessionWorldState.materialize({
    rootSessionID: input.info.rootSessionID,
  }).catch(() => undefined)
  // ...
}
```

**Impact:** Full ledger materialization on every call.

**Recommendation:** Cache with TTL keyed by rootSessionID.

---

### 21. Vector Hash Computed Repeatedly (MEDIUM)

**File:** `packages/opencode/src/retrieval/service.ts:140-142`

**Issue:** Hash computed via JSON.stringify:

```typescript
function vectorHash(vector: number[]) {
  return createHash("sha1").update(JSON.stringify(vector)).digest("hex")
}
```

**Impact:** Large vectors (embeddings) serialized repeatedly.

**Recommendation:** Use binary serialization or cache hash.

---

### 22. Embedding Semantic Signature Recomputed (MEDIUM)

**File:** `packages/opencode/src/retrieval/service.ts:124-138`

**Issue:** Policy signature computed each time:

```typescript
function embeddingSemanticSignature(policy: RetrievalPolicyResolved) {
  return createHash("sha1")
    .update(JSON.stringify({
      indexSpace: embeddingIndexSpace(policy) ?? null,
      // ... many fields
    }))
    .digest("hex")
}
```

**Impact:** Called on every embedding operation.

**Recommendation:** Cache on policy object or use WeakMap.

---

### 23. No Request Deduplication (MEDIUM)

**File:** `packages/opencode/src/session/llm.ts` (stream function)

**Issue:** Identical concurrent requests not deduplicated:

```typescript
export async function stream(input: StreamInput) {
  // No check for in-flight identical request
  const result = streamText({ ... })
}
```

**Impact:** Multiple identical prompts in quick succession create redundant API calls.

**Recommendation:** Request coalescing with short TTL dedupe window.

---

## Low Severity Issues

### 24. Excessive Logging in Debug Mode (LOW)

**File:** `packages/opencode/src/session/llm.ts:427-481`

**Issue:** Large objects logged when debug timing enabled:

```typescript
if (Flag.OPENCODE_DEBUG_PROMPT_TIMING) {
  l.info("prompt timing", {
    // ... large messageSummary array
  })
}
```

**Impact:** Significant logging overhead when debug flags enabled.

**Recommendation:** Use debug level, include only summaries.

---

### 25. Duplicate Stopwords Definitions (LOW)

**Issue:** Similar stopwords defined in multiple files:

- `session/workgraph.ts:20-94` - 80+ stopwords
- `retrieval/service.ts:34-99` - 60+ stopwords (slightly different)

**Recommendation:** Consolidate into shared utility.

---

### 26. setTimeout Without clearTimeout in Some Paths (LOW)

**File:** `packages/opencode/src/session/prompt.ts:567-571`

**Issue:** Timer may not be cleared if callback fires:

```typescript
const timer = setTimeout(() => {
  removeFutureTurnCallback(sessionID, callback)
  resolve(undefined)
}, timeoutMS)
```

**Impact:** Minor, but timer can fire after session changed.

**Recommendation:** Store timer ID and clear on session change.

---

### 27. Inefficient Array Operations (LOW)

**File:** `packages/opencode/src/session/workgraph.ts:417-419`

**Issue:** `slice` creates new array for trimming:

```typescript
function trimLog<T>(items: T[], limit: number) {
  return items.slice(Math.max(0, items.length - limit))
}
```

**Impact:** Called frequently, creates garbage arrays.

**Recommendation:** In-place splice for large arrays.

---

### 28. No Batching for Bus Events (LOW)

**File:** Multiple files

**Issue:** Events published individually in loops:

```typescript
for (const item of items) {
  await Bus.publish(Event.Updated, { info: item })
}
```

**Impact:** Many event handler invocations.

**Recommendation:** Batch event publishing.

---

### 29. String Operations in Hot Path (LOW)

**File:** `packages/opencode/src/session/compaction.ts:152-194`

**Issue:** Multiple string operations per compaction:

```typescript
const normalized = query.replace(/\r/g, "")
const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean)
```

**Impact:** Minor overhead per compaction.

**Recommendation:** Cache normalized queries.

---

## Additional Observations

### Positive Patterns Found

1. **SolidJS reactive system** - Using `createMemo` and `createStore` correctly in app package
2. **Proper signal handling** - AbortController used throughout
3. **Lock mechanisms** - File locking implemented for concurrent access
4. **Circuit breakers** - Present in harness/retry.ts

### Areas Needing Further Investigation

1. **Memory profiling** during long sessions to verify leak sources
2. **Database query patterns** - Could benefit from query analysis
3. **Network request pooling** - HTTP connection reuse patterns

---

## Recommended Priority Actions

1. **Immediate:** Fix unbounded Map growth (#1) - memory leak risk
2. **High:** Fix checkpoint scanning (#2) - I/O bottleneck
3. **High:** Fix N+1 queries (#3) - database load
4. **Medium:** Implement batching for part updates (#9)
5. **Medium:** Add cleanup for module-level caches