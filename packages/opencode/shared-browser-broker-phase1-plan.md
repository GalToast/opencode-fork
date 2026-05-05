# Shared Browser Broker Phase 1

## Goal

Reduce duplicate browser-helper cost when multiple `opencode` runtimes are open at the same time.

Today each runtime owns its own browser MCP client lifecycle in [src/mcp/index.ts](C:/Users/HP/repos/opencode/packages/opencode/src/mcp/index.ts). For browser-local clients (`playwright`, `chrome-devtools`), that means each runtime can spawn its own stdio helper process, keep its own transport, and reconnect independently. That is a good fit for isolation, but it is expensive when three peer terminals all need browser tools.

Phase 1 should centralize helper ownership for browser MCP only. It should not try to broker all MCP servers, and it should not change prompt or permission semantics outside the browser lane.

## Current Seam

The smallest viable seam is already narrow:

- Browser clients are already special-cased by ID in [src/mcp/index.ts](C:/Users/HP/repos/opencode/packages/opencode/src/mcp/index.ts).
- Local stdio helper startup happens in `create(...)`.
- Browser-tool execution is already funneled through `withClientUse(...)`.
- Browser helper idle teardown is already managed in `scheduleBrowserIdleDisconnect(...)`.
- Browser tool discovery already tolerates disconnected clients by reading cached tool defs from `toolCatalog`.

That means phase 1 does not need a new tool surface. It only needs a different owner for the browser-local transport/process lifecycle.

## Phase 1 Scope

Phase 1 should do all of the following:

- Broker only `playwright` and `chrome-devtools`.
- Keep all existing MCP tool IDs unchanged.
- Keep approvals local to the requesting runtime.
- Keep each runtime logically isolated from other runtimes.
- Reuse cached browser tool definitions the same way the current runtime-local path does.
- Fail soft: if the broker is unavailable, the runtime should fall back to the current direct-local MCP path.

Phase 1 should not do any of the following:

- Broker arbitrary remote MCP servers.
- Merge session state across runtimes.
- Share one browser tab or page object across runtimes by default.
- Change capability or prompt behavior outside browser MCP.

## Architecture

### 1. Broker process

Add one workspace-scoped broker process that owns browser helper transports.

Suggested new files:

- `src/mcp/browser-broker.ts`
- `src/mcp/browser-broker-protocol.ts`
- `src/mcp/browser-broker-client.ts`
- `src/mcp/browser-broker-server.ts`

The broker should be started on demand and should live under the current workspace's `.opencode` state directory.

Suggested broker state files:

- `.opencode/runtime/browser-broker.json`
- `.opencode/runtime/browser-broker.sock` or platform-appropriate named pipe endpoint

The broker process should register itself similarly to the existing runtime heartbeat in [src/cli/cmd/tui/runtime-registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/runtime-registry.ts), but it does not need to become part of the user-facing runtime list in phase 1.

### 2. Broker-owned helper lifecycle

The broker should own:

- one `StdioClientTransport` per browser MCP server
- one MCP `Client` per browser MCP server
- cached `listTools()` results for those browser servers
- broker-local idle teardown timers

The broker should expose a tiny RPC surface:

- `status`
- `ensureConnected`
- `disconnect`
- `listTools`
- `callTool`

That is enough for phase 1. Prompts and resources can stay runtime-local for now because the current pressure is tool/helper heavy, not prompt/resource heavy.

### 3. Runtime-side client shim

In [src/mcp/index.ts](C:/Users/HP/repos/opencode/packages/opencode/src/mcp/index.ts), browser MCP should gain a broker-backed path:

- `connect(name)`:
  - if `name` is not browser MCP, keep current behavior
  - if `name` is browser MCP, ask the broker to `ensureConnected`
- `tools(clientNames?)`:
  - for brokered browser clients, get tool defs from broker `listTools`
  - wrap tool execution so `execute(...)` calls broker `callTool`
- `disconnect(name)`:
  - if brokered browser client, ask broker to disconnect it

The runtime-local `toolCatalog` can stay. Phase 1 should keep using it as the fast discovery layer so prompt assembly and capability inspection do not regress.

## Isolation Model

Phase 1 should isolate by runtime, not by session.

That means:

- broker requests must include `runtimeID`
- the broker tracks per-runtime leases for browser usage
- the broker can serialize dangerous shared operations if needed

This keeps the design simple and matches the actual performance pain: three runtimes on one machine. It also avoids inventing session-level routing rules before we know we need them.

For `chrome-devtools`, if the broker has to multiplex one browser target, phase 1 should serialize tool calls per runtime lease rather than trying to make concurrent mutation safe.

For `playwright`, the broker should prefer a per-runtime browser context or per-runtime server-side session if the helper supports that cleanly. If not, phase 1 should still allow only one in-flight call at a time per brokered MCP client and document that concurrency remains conservative.

## Where This Reuses Existing Work

The repo already has browser-isolation work in [src/mcp/chrome-instance-pool.ts](C:/Users/HP/repos/opencode/packages/opencode/src/mcp/chrome-instance-pool.ts) and config in [src/config/config.ts](C:/Users/HP/repos/opencode/packages/opencode/src/config/config.ts).

Phase 1 should not try to merge the broker and Chrome instance pool immediately.

Instead:

- keep helper-process ownership in the new broker
- leave Chrome instance-pool policy alone
- optionally let the broker consult the existing Chrome config later

That avoids coupling two meaningful browser changes into one rollout.

## Rollout Plan

### Step 1. Add broker protocol and standalone server

Build the broker server and client with no MCP integration yet.

Acceptance:

- one process can start the broker
- another process can connect and make a health-check RPC
- stale broker metadata can be detected and replaced

### Step 2. Broker `listTools` for browser MCP

Teach the broker to own browser helper startup and `listTools()` for `playwright` and `chrome-devtools`.

Acceptance:

- three runtimes asking for browser tools only produce one helper process per browser MCP server
- tool IDs remain unchanged from the current `MCP.tools(...)` output

### Step 3. Broker `callTool`

Route browser tool execution through the broker.

Acceptance:

- browser MCP tool execution still works from normal prompt turns
- idle teardown still happens, but in the broker
- local runtime no longer respawns duplicate browser helpers for each terminal

### Step 4. Fallback and observability

If broker startup or IPC fails, fall back to the current runtime-local path.

Acceptance:

- broken broker does not make browser tools disappear entirely
- logs clearly show whether a runtime used brokered or direct-local browser MCP

## Tests

Add focused tests rather than trying to prove this only through end-to-end TUI runs.

Suggested suites:

- `test/mcp/browser-broker.test.ts`
  - broker starts
  - second client reuses existing broker
  - stale broker entry is replaced
- `test/mcp/browser-broker-integration.test.ts`
  - two simulated runtimes share one broker-owned browser helper
  - `tools()` returns stable IDs
  - `callTool()` reaches the helper through the broker
- extend `test/mcp/local-cwd.test.ts`
  - brokered browser MCP does not spawn duplicate stdio helpers across runtimes
  - fallback path still works when broker is unavailable

## Risks

### Shared failure domain

If the broker dies, all runtimes lose brokered browser tools at once.

Mitigation:

- keep direct-local fallback in phase 1
- keep broker protocol tiny

### Cross-runtime interference

One runtime could affect another runtime's browser state.

Mitigation:

- require `runtimeID` on every request
- keep conservative serialization for mutation-heavy browser tool calls
- do not attempt page/tab sharing in phase 1

### Permission confusion

Approvals must still feel local to the runtime that asked for the tool.

Mitigation:

- approvals stay in the runtime
- broker only executes already-approved requests

### Scope creep

It is easy to turn this into a general MCP control plane.

Mitigation:

- browser MCP only
- tools only
- no prompts/resources in phase 1

## Success Metrics

The change is worth keeping only if it improves the multi-runtime case in a measurable way.

Track:

- number of `playwright` helper processes with 3 active runtimes
- number of `chrome-devtools` helper processes with 3 active runtimes
- total resident memory of those helpers
- time to first browser tool call in a fresh runtime
- time to first browser tool call in a second runtime after the broker is already warm

The minimum win bar for phase 1 should be:

- browser helper count drops from per-runtime duplication to one shared owner per workspace
- no browser-tool regression in the focused MCP tests
- no prompt-surface regression for browser tool visibility

## Recommendation

This is worth doing, but only as a staged browser-only broker.

The smallest valuable version is:

1. workspace-scoped broker
2. broker owns browser helper startup plus `listTools`
3. broker owns browser `callTool`
4. runtime falls back to direct-local behavior if the broker is unhealthy

That should buy the main performance win without forcing a broad MCP redesign.
