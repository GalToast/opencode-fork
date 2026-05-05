# Server Routes & API Layer Sweep Findings

**Scope:** `packages/opencode/src/server/` - Server routes, API layer, and HTTP handlers  
**Date:** 2026-03-28  
**Search Pattern:** UNFINISHED FEATURES and UNHOOKED CODE

---

## Executive Summary

The server routes layer is **largely complete and well-integrated**. All major route modules are properly registered and functional. However, several issues were identified:

1. **One unregistered route module** (`WorkspaceRoutes`) - nested under experimental, intentional
2. **Loose type schemas** in several endpoints using `z.any()`, `z.unknown()`, or `unknown`
3. **One TODO comment** indicating technical debt
4. **No critical unhooked code found**

---

## Detailed Findings

### 1. Route Registration Status

**Finding:** All route modules are properly registered

| Route Module | Exported | Imported in server.ts | Registered | Path |
|--------------|----------|----------------------|------------|------|
| ConfigRoutes | ✅ | ✅ | ✅ | `/config` |
| ExperimentalRoutes | ✅ | ✅ | ✅ | `/experimental` |
| FileRoutes | ✅ | ✅ | ✅ | `/` |
| GlobalRoutes | ✅ | ✅ | ✅ | `/global` |
| McpRoutes | ✅ | ✅ | ✅ | `/mcp` |
| PermissionRoutes | ✅ | ✅ | ✅ | `/permission` |
| ProjectRoutes | ✅ | ✅ | ✅ | `/project` |
| ProviderRoutes | ✅ | ✅ | ✅ | `/provider` |
| PtyRoutes | ✅ | ✅ | ✅ | `/pty` |
| QuestionRoutes | ✅ | ✅ | ✅ | `/question` |
| SessionRoutes | ✅ | ✅ | ✅ | `/session` |
| TuiRoutes | ✅ | ✅ | ✅ | `/tui` |
| WorkspaceRoutes | ✅ | ❌ | ✅ | `/experimental/workspace` |

**Note:** `WorkspaceRoutes` is intentionally nested under `ExperimentalRoutes` (line 114 in `experimental.ts`), not directly in server.ts.

---

### 2. Loose Type Schemas (Medium Severity)

**Files Affected:**

#### `routes/experimental.ts`
- **Line 82:** `parameters: z.any()` - Tool invocation parameters use loose typing
- **Line 34:** `isZodParameters(value: unknown)` - Type guard for unknown values

```typescript
// Line 82
parameters: z.any(),
```

**Recommended Action:** Define specific parameter schemas for each tool type

#### `routes/global.ts`
- **Line 16:** `payload: unknown` - Event payload type
- **Line 21:** `z.object({})` - Empty schema for GlobalDisposedEvent

```typescript
// Line 16
payload: unknown

// Line 21
export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))
```

**Recommended Action:** Define specific payload types for each event type

#### `routes/session.ts`
- **Line 137:** `parseSessionModelSelection(input: unknown)` - Type guard
- **Line 189:** `value: z.any()` - Generic value schema
- **Line 267:** `extra?: Record<string, unknown>` - Logging extra data

```typescript
// Line 189
value: z.any(),
```

**Recommended Action:** Replace with specific union types where practical

#### `routes/tui.ts`
- **Line 13:** `body: z.unknown()`
- **Line 19:** `const response = new AsyncQueue<unknown>()`
- **Line 22:** `const body: unknown = await ctx.req.json()`
- **Line 70:** `validator("json", z.unknown())`

```typescript
// Line 70
validator("json", z.unknown()),
```

**Recommended Action:** Define specific TUI event schemas

#### `routes/pty.ts`
- **Lines 170-175:** Multiple `unknown` type checks in `isSocket` guard

```typescript
// Lines 170-175
const isSocket = (value: unknown): value is Socket => {
  if (!("send" in value) || typeof (value as { send?: unknown }).send !== "function") return false
  if (!("close" in value) || typeof (value as { close?: unknown }).close !== "function") return false
  return typeof (value as { readyState?: unknown }).readyState === "number"
}
```

**Recommended Action:** Acceptable for runtime type guards; consider defining Socket interface

---

### 3. Technical Debt (Low Severity)

#### `server.ts`
- **Line 69:** `// TODO: Break server.ts into smaller route files to fix type inference`

```typescript
// Line 69
// TODO: Break server.ts into smaller route files to fix type inference
```

**Severity:** Low  
**Recommended Action:** Refactor when type inference issues become problematic

---

### 4. WebSocket Handlers (No Issues)

**Finding:** WebSocket implementation is complete and properly connected

- **File:** `routes/pty.ts`
- **Line 3:** `import { upgradeWebSocket } from "hono/bun"`
- **Lines 152-198:** Full WebSocket handler with `onOpen`, `onMessage`, `onClose`, `onError`
- **Line 184:** `handler = Pty.connect(id, ws.raw, cursor)` - Properly connected to Pty subsystem

**Status:** ✅ Fully implemented and hooked up

---

### 5. Middleware (No Issues)

**Finding:** Middleware is properly applied

#### WorkspaceRouterMiddleware
- **File:** `control-plane/workspace-router-middleware.ts`
- **Line 39:** `export const WorkspaceRouterMiddleware: MiddlewareHandler`
- **Applied in:** `server.ts` lines 204-277 (inline middleware for workspace/directory handling)

#### Server Middleware Stack (server.ts lines 204-277)
```typescript
.use(async (c, next) => {
  if (c.req.path === "/log") return next()
  const workspaceID = c.req.query("workspace") || c.req.header("x-opencode-workspace")
  const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
  // ... workspace resolution logic
})
```

**Status:** ✅ All middleware properly applied

---

### 6. Authentication Flows (No Issues)

**Finding:** Authentication flows are complete

#### MCP OAuth (routes/mcp.ts)
- **Lines 64-91:** `POST /:name/auth` - Start OAuth flow
- **Lines 96-123:** `POST /:name/auth/callback` - Complete OAuth
- **Lines 128-151:** `POST /:name/auth/authenticate` - Full auth with browser
- **Lines 156-171:** `DELETE /:name/auth` - Remove credentials

#### Provider Auth (routes/provider.ts)
- **Lines 127-164:** `POST /:providerID/auth` - Provider authentication callback

**Status:** ✅ All auth endpoints implemented and connected to underlying auth systems

---

### 7. Streaming/Response Handling (No Issues)

**Finding:** Streaming is properly implemented

#### SSE Streaming (routes/global.ts)
- **Line 3:** `import { streamSSE } from "hono/streaming"`
- **Lines 76-105:** Full SSE stream with heartbeat

#### Response Streaming (routes/session.ts)
- **Line 2:** `import { stream } from "hono/streaming"`
- **Lines 1948-1955:** Stream writer for AI responses

**Status:** ✅ Streaming properly implemented

---

### 8. Placeholder Responses (Informational)

**Finding:** Multiple endpoints return `c.json(true)` as success acknowledgment

This is **intentional design** for fire-and-forget or acknowledgment endpoints, not placeholder code. Examples:

- Permission acknowledgment (permission.ts:43)
- Question accept/reject (question.ts:65, 95)
- TUI control events (tui.ts:74, 101, 125, etc.)
- Session operations (session.ts:1386, 1469, 1529, etc.)

**Status:** ✅ Intentional design pattern, not unfinished code

---

## Summary by Severity

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 0 | No critical issues found |
| High | 0 | No high-severity issues found |
| Medium | 5 | Loose type schemas in 5 files |
| Low | 1 | One TODO comment for future refactoring |

---

## Recommendations

### Immediate Actions
1. **None required** - All critical and high-severity issues absent

### Future Improvements
1. **Replace `z.any()` and `z.unknown()`** with specific schemas where practical
2. **Define explicit payload types** for event systems
3. **Consider refactoring server.ts** if type inference becomes problematic

---

## Files Analyzed

```
packages/opencode/src/server/
├── server.ts (687 lines)
├── event.ts (7 lines)
├── error.ts
├── mdns.ts (65 lines)
└── routes/
    ├── config.ts (92 lines)
    ├── experimental.ts (463 lines)
    ├── file.ts (192 lines)
    ├── global.ts (190 lines)
    ├── mcp.ts (225 lines)
    ├── permission.ts (68 lines)
    ├── project.ts (82 lines)
    ├── provider.ts (165 lines)
    ├── pty.ts (199 lines)
    ├── question.ts (98 lines)
    ├── session.ts (2147 lines)
    ├── tui.ts (379 lines)
    └── workspace.ts (96 lines)
```

**Total Lines Analyzed:** ~5,000+ lines of server/route code

---

## Conclusion

The server routes layer demonstrates **mature implementation** with:
- ✅ All route modules properly registered
- ✅ WebSocket handlers fully connected
- ✅ Middleware properly applied
- ✅ Authentication flows complete
- ✅ Streaming responses implemented
- ✅ No empty handlers or placeholder code

The only improvements are type safety refinements (medium severity) and one technical debt TODO (low severity).
