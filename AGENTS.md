- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- This repo is the local `opencodex` fork at `C:\Users\HP\repos\opencode`.
- The main package most code changes belong in is `C:\Users\HP\repos\opencode\packages\opencode`.
- When another workspace asks for `opencodex` or `opencode` internals, this is the canonical fork location.

## Verified Features

### 1. Chrome Isolation

**Configuration** (config.ts:1160-1199):

```typescript
chrome: {
  isolated: boolean           // default: false - Enable isolated Chrome instances
  instanceCount: number       // default: 3 - Max concurrent instances (1-10)
  headlessByDefault: boolean  // default: true - Use headless mode
  basePort: number            // default: 9222 - Starting port for instances
  autoCleanup: boolean        // default: true - Clean up temp profiles on shutdown
  prewarm: boolean           // default: false - Pre-spawn instances on startup
}
```

**Implementation**: Instance Pool vs Mutex

- **Instance Pool** (`src/mcp/chrome-instance-pool.ts`): Creates multiple isolated Chrome processes with separate user data directories. Each worker acquires an instance exclusively. Supports automatic respawn on crash (up to maxSpawnAttempts).
- **Mutex** (`BrowserResourceManager`): Single-access queue for Chrome DevTools MCP when pool mode is disabled.

**When to use which**:
- Use `chrome.isolated: true` for concurrent browser operations - eliminates need for gatekeeping
- Use Mutex (default) when memory constrained or for simple sequential operations

**Configuration example**:
```yaml
chrome:
  isolated: true
  instanceCount: 5
  headlessByDefault: true
  basePort: 9222
  autoCleanup: true
  prewarm: true  # Note: Config option exists but not yet implemented
```

### 2. Error Handling

**9 Error Categories** (src/harness/errors.ts:10-22):
- `TIMEOUT` - Provider timeout or stall detection
- `OOM` - Out of memory during generation  
- `API` - Authentication, server errors
- `PARSE` - JSON parsing failures
- `VALIDATION` - Patch validation failures
- `AUTH` - Authentication/authorization failures
- `RATE_LIMIT` - Rate limiting from provider
- `CIRCUIT_BREAKER` - Circuit breaker open
- `NETWORK` - Network connectivity issues
- `SESSION` - Session lifecycle errors
- `UNKNOWN` - Unclassified errors

**4 Severity Levels** (src/harness/errors.ts:24-29):
- `TRANSIENT` - Can retry immediately
- `RECOVERABLE` - Can retry with backoff
- `DEGRADED` - Can retry with model rotation
- `FATAL` - Should not retry, stage immediately

**Circuit Breaker Pattern** (src/harness/retry.ts:39-71):
- States: `closed`, `open`, `half-open`
- Configurable: failureThreshold (default 5), recoveryTimeoutMS (default 30000)
- Auto-transitions: closed → open on threshold, open → half-open after timeout, half-open → closed on success

**Example error handling**:
```typescript
import { HarnessError, HarnessErrorCategory, HarnessErrorSeverity } from "./harness/errors"

try {
  await operation()
} catch (err) {
  if (err instanceof HarnessError) {
    if (err.shouldOpenCircuitBreaker()) {
      // Open circuit for rate limits or fatal API errors
    }
    if (err.shouldRotateModel()) {
      // Rotate to fallback model
    }
    const strategy = err.getRetryStrategy()
    // Apply retry with backoff
  }
}
```

### 3. Session Checkpointing

**Location**: `.opencode/runtime/harness/checkpoints/`

**Format**: JSON with version 1 (src/harness/session.ts:502-522)

**States** (session.ts:491-501):
- `starting` - Initial state
- `model_routed` - Model selected
- `root_session_created` - Root session established
- `child_session_created` - Child session established
- `event_stream_ready` - Event stream initialized
- `prompt_dispatched` - Prompt sent to provider
- `processing` - Provider generating response
- `completed` - Session finished successfully
- `error` - Session encountered error

**Resume behavior**: On crash, system finds latest checkpoint for input title, skipping completed/error states. Restores session state and continues from last checkpoint.

**Structure**:
```typescript
{
  version: 1,
  checkpointID: string,
  state: HarnessSessionCheckpointState,
  input: HarnessReadOnlySessionInput,
  textParts: string[],
  streamedPartOrder: string[],
  streamedPartTexts: Record<string, string>,
  seenPartIDs: string[],
  // ... additional metadata
  createdAt: number,
  updatedAt: number
}
```

### 4. Task Dependencies

**Parameter**: `depends_on: string[]` (src/tool/task.ts:2360)

**Behavior**: Task blocks until all dependency task IDs complete successfully. If any dependency fails, task remains blocked.

**Implementation**: 
- Syncs with Tracker service for persistence (task.ts:436-466)
- Falls back to runtime job status check (task.ts:468-497)
- Publishes "blocked" status to work graph while waiting (task.ts:499-506)

**Example usage**:
```typescript
await tool.task({
  title: "Deploy after tests",
  description: "Deploy application",
  depends_on: ["test-task-id", "build-task-id"]
})
```

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

### Naming

Prefer single word names for variables and functions. Only use multiple words if necessary.

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

```ts
// Good
const foo = 1
function journal(dir: string) {}

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
```

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## SearXNG (Local Search Backend)

SearXNG runs in WSL Docker as a free, unlimited web search backend for AI agents.

### Quick Start

```bash
wsl docker compose -f script/searxng/docker-compose.yml up -d
```

Wait ~30 seconds for health check to pass.

### Diagnostics

```bash
# Check container status
wsl docker ps --filter "name=searxng" --format "{{.Names}}: {{.Status}}"

# Test from WSL
wsl curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/config

# Test from Windows
powershell -Command "(Invoke-WebRequest -Uri 'http://127.0.0.1:8080/config' -UseBasicParsing -TimeoutSec 10).StatusCode"
```

### Common Issues

**Container keeps restarting:**

- Check logs: `wsl docker logs opencodex-searxng --tail 50`
- Usually caused by upstream engine rate limits (403 errors)
- Wait 3-5 minutes for rate limits to reset

**Windows can't connect but WSL can:**

- WSL networking issue
- Run WSL keepalive: `pwsh -File script/searxng/start-wsl-keepalive.ps1`
- Or use WSL IP directly: `wsl hostname -I`

**403 errors from engines:**

- Upstream search engines (Google, Bing, Mojeek) rate-limiting
- Temporary - wait for `suspended_time` to expire
- Adjust engine weights in `searxng-settings.yml`

### Full Reset

```bash
wsl docker compose -f script/searxng/docker-compose.yml down -v
wsl docker compose -f script/searxng/docker-compose.yml up -d
```

### Files

- `script/searxng/docker-compose.yml` - Container config
- `script/searxng/searxng-settings.yml` - Engine settings
- `.opencode/skills/searxng-troubleshoot/SKILL.md` - Full troubleshooting guide

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.
