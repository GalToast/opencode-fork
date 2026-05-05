# Seat Agent Authority Rollout

## Purpose

Turn the authority model in `docs/harness/seat-agent-authority-model.md` into a concrete runtime rollout plan.

This plan is intentionally incremental.
It favors explicit runtime metadata and policy checks before deeper storage migrations.

## Goal

Support recursive coordination without losing hierarchical authority boundaries.

The system should allow delegated workers to coordinate locally, including spawning their own subagents, while keeping:

- root user authority at the root seat layer
- material scope changes visible and reviewable
- ownership and lineage inspectable in runtime status surfaces

## Current Baseline

The current system already has most of the execution substrate:

- `task` supports recursive worker lifecycle, relay, broadcast, pause, resume, escalate, lineage, checkpoints, and supervisor check-in/status surfaces.
- scheduler lanes and priorities support real concurrent work.
- tracker DAG supports durable dependency structure and required skills.
- blackboard supports compact shared cross-lane state.
- prompt coordination reminders already encourage these surfaces.

What is missing is explicit authority state and policy.

## Design Target

The runtime should make these three authority layers explicit:

### Execution Authority

Can decide how the assigned work gets done.

Examples:

- pick tools
- plan local steps
- spawn child workers
- supervise child tasks
- integrate child outputs

### Scope Authority

Can redefine or materially widen the task boundary.

Examples:

- changing success criteria
- expanding the write set materially
- changing ownership boundaries
- changing the deliverable

### User Authority

Can make final commitments to the user.

Examples:

- deliver the final answer
- declare the root objective complete
- resolve user-intent ambiguity without escalation

## Rollout Principles

1. Start with runtime metadata, not database migrations.
2. Preserve existing recursive task behavior unless a new guard is explicitly triggered.
3. Prefer upward escalation for scope changes instead of hard denials where possible.
4. Make authority visible in `status` and `check_in` before trying to optimize policy.
5. Keep tracker/storage changes additive until the runtime policy proves useful.

## Wave 1: Runtime Authority Metadata

### Goal

Teach every task branch to carry explicit authority state in runtime memory.

### Files

- `packages/opencode/src/tool/task.ts`

### Add

To `RuntimeJob`, add:

- `executionAuthority = "local" | "delegated" | "none"`
- `scopeAuthority = "root" | "local_refine_only" | "explicit_override"`
- `userAuthority = "root" | "none"`
- `authoritySource = "root_default" | "parent_inherited" | "explicit_override"`
- `scopeEscalationRequired?: boolean`
- `scopeEscalationReason?: string`
- `delegationMode = "stay_solo" | "delegate_bounded_worker" | "coordinate_multi_worker"`

### Initial Policy

- root seat task/session:
  - execution authority = `local`
  - scope authority = `root`
  - user authority = `root`
- delegated child:
  - execution authority = `delegated`
  - scope authority = `local_refine_only`
  - user authority = `none`

### Why First

This gives us inspectable state without changing the behavior model yet.

## Wave 2: Explicit Parent -> Child Authority Inheritance

### Goal

Make child authority inheritance intentional instead of implicit.

### Files

- `packages/opencode/src/tool/task.ts`

### Add

Task start parameters:

- `execution_authority?: "inherit" | "delegated" | "none"`
- `scope_authority?: "inherit" | "local_refine_only" | "explicit_override"`
- `user_authority?: "inherit" | "none"`
- `delegation_mode?: "inherit" | "stay_solo" | "delegate_bounded_worker" | "coordinate_multi_worker"`

### Initial Defaults

- if omitted for root launches:
  - use root defaults
- if omitted for child launches:
  - inherit execution authority as delegated execution
  - inherit scope authority as limited local refinement only
  - inherit user authority as none

### Important Rule

Workers may grant children execution authority.
Workers may not silently grant user authority.

## Wave 3: Scope Escalation Policy

### Goal

Allow workers to coordinate freely inside scope while forcing visibility when scope expands materially.

### Files

- `packages/opencode/src/tool/task.ts`
- optionally `packages/opencode/src/session/execution-brief.ts`

### Add

A lightweight scope-escalation helper that flags:

- material write-set expansion
- deliverable change
- new risky subsystem involvement
- fanout or budget expansion beyond parent policy

### Behavior

Do not hard fail first.

Instead:

- mark `scopeEscalationRequired = true`
- store `scopeEscalationReason`
- surface the branch in `check_in` as waiting on supervisor direction
- recommend `message` or `wait` depending on branch state

### Why

This keeps coordination permissive while preserving hierarchy.

## Wave 4: Authority Surfaces In Status And Check-In

### Goal

Make authority visible to operators and parent agents.

### Files

- `packages/opencode/src/tool/task.ts`

### Extend

`status` output:

- `execution_authority`
- `scope_authority`
- `user_authority`
- `authority_source`
- `delegation_mode`
- `scope_escalation_required`
- `scope_escalation_reason`

`check_in` metadata/output:

- authority summary
- whether branch may continue local coordination
- whether branch needs upward scope approval

### Recommended output additions

- `authority_summary: delegated execution | local scope refinement only | no user authority`
- `scope_gate: open | escalation_required`

## Wave 5: Tracker Projection

### Goal

Project proven authority state into durable task structure after the runtime policy settles.

### Files

- `packages/opencode/src/tracker/types.ts`
- `packages/opencode/src/tracker/service.ts`
- `packages/opencode/src/tool/tracker.ts`

### Observation

Tracker storage already has flexible `results` and `metadata`, but it does not yet have first-class authority fields.

### Near-Term Move

Before schema changes, store authority projection under task metadata:

- `authority.execution`
- `authority.scope`
- `authority.user`
- `authority.mode`
- `authority.owner_session_id`
- `authority.scope_gate`

### Later Move

Promote those into typed task fields only if they prove useful in real runtime flows.

## Wave 6: Recursive Coordination Policy

### Goal

Define the runtime chooser for:

1. `stay_solo`
2. `delegate_bounded_worker`
3. `coordinate_multi_worker`

### Files

- `packages/opencode/src/tool/task.ts`
- `packages/opencode/src/session/prompt/coordination.txt`
- benchmark and routing surfaces adjacent to seat delegation

### Policy

- allow all three modes recursively
- keep bounded delegation the default recommendation
- require stronger signals before suggesting broad multi-worker coordination
- preserve recursive local orchestration when a worker chooses it for valid local reasons

### Important Distinction

Suggestion policy is not permission policy.

The runtime may allow multi-worker coordination more broadly than it recommends it.

## Wave 7: Budget And Fanout Gates

### Goal

Make recursive coordination safe under load.

### Files

- `packages/opencode/src/tool/task.ts`
- `packages/opencode/src/scheduler/control-plane.ts`

### Add

Per-branch policy fields:

- `maxDepth`
- `maxFanout`
- `maxParallelChildren`
- `maxQueuedChildren`

### Behavior

- child spawning past policy should trigger escalation, not silent runaway recursion
- root seat agent may override
- worker may request override

## Wave 8: Runtime Read Model

### Goal

Expose authority and recursive lineage in one place.

### Files

- `packages/opencode/src/tool/task.ts`
- `packages/opencode/src/session/workgraph.ts`
- possibly session server routes and TUI surfaces later

### Add

A root-family authority snapshot that answers:

- who owns the user relationship
- which branch owns execution for each active slice
- which branches are blocked on scope escalation
- which branches are acting as local orchestrators
- which children belong to which parent run

## Concrete First Implementation Slice

If we want the smallest useful shipping slice, do this first:

1. Add runtime authority fields to `RuntimeJob`.
2. Inherit those fields on `task(action="start")`.
3. Surface them in `status` and `check_in`.
4. Add a lightweight `scopeEscalationRequired` flag path.
5. Do not change tracker schema yet.

That would already make recursive authority inspectable and enforce the key hierarchy without blocking current delegation power.

## Suggested Tests

### Task Tool

- worker can spawn child worker and child inherits no user authority
- child can coordinate locally without parent denial
- child hitting a scope escalation flag surfaces `recommended_action: message`
- root seat retains `user_authority = root`

### Status / Check-In

- authority fields appear in status output
- authority fields appear in check-in metadata
- scope escalation shows clear supervisor guidance

### Recursive Delegation

- worker-launched child branch can itself relay/broadcast/pause/resume children
- root seat remains the only final user-facing authority in reported metadata

## Non-Goals For This Rollout

- forcing a deep tracker schema migration immediately
- forbidding recursive delegation until every guard exists
- turning scope escalation into a brittle deny-by-default gate
- replacing the current task tool with a brand new orchestrator system

## Recommended Next Move

Implement Wave 1 through Wave 4 together as one focused runtime patch:

- runtime authority fields
- inheritance on spawn
- scope escalation flagging
- status and check-in visibility

That is the smallest change that makes the authority model operational.
