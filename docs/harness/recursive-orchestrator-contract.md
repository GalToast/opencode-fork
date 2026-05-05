# Recursive Orchestrator Contract

## Goal

Let orchestrator agents spawn and supervise their own workers safely, with durable state, explicit ownership, bounded budgets, and parent-reviewed outputs.

This document defines the contract for recursive delegation in OpenCode without replacing the current task tool, tracker, or scheduler in one step.

## Current Baseline

OpenCode already has several pieces of the future system:

- The `task` tool supports subagent spawning, relay, broadcast, pause, resume, cancel, and status inspection.
- Task routing already distinguishes `orchestrator`, `research`, `synthesis`, `worker`, and `adversarial` disciplines.
- Scheduler lanes already include `orchestrator_swarm`, `adversarial_review`, and `subagent_tasks`.
- Runtime task state already tracks artifacts, review status, priority, heartbeat, and execution-ledger history.
- `SessionWorkGraph` already stores objectives, lanes, and artifacts as a root-scoped runtime projection.
- The tracker already stores durable parent/child work and dependency edges.

What is missing is a clean contract that ties those systems together so recursive delegation is safe and understandable.

## Design Principles

- `graph-first`: durable work graph is the source of truth for long-running work.
- `parent-reviewed`: a parent orchestrator accepts artifacts, not just claims.
- `bounded recursion`: every delegation branch has explicit depth, fanout, and budget limits.
- `resume-safe`: every orchestrator and worker can be resumed from checkpoints.
- `projection-not-duplication`: tracker, workgraph, approvals, and runtime telemetry are linked projections of the same work, not parallel planning systems.
- `terminal-native`: the operator should be able to answer what is happening, why, and what to do next from the terminal UI.

## Core Entities

### Root Objective

The top-level user initiative for a root session family.

Fields:

- `rootSessionID`
- `title`
- `status`
- `constraintsSummary`
- `ownerSessionID`
- `createdAt`
- `updatedAt`

### Tracker Work Item

The durable unit of planned or executable work.

Near-term required fields:

- `id`
- `title`
- `description`
- `type`
- `status`
- `parentId`
- `dependencies`
- `rootSessionID`
- `ownerSessionID`
- `priority`
- `blockedReason`
- `delegatedToSessionID`
- `latestPlanArtifactID`
- `latestRunID`
- `updatedAt`

### Plan Artifact

The approval-bound execution brief for a work item.

Fields:

- `id`
- `taskID`
- `kind = plan`
- `path`
- `revision`
- `status = draft | awaiting_approval | approved | superseded`
- `summary`
- `feedback[]`
- `createdBySessionID`
- `createdAt`
- `approvedAt?`

### Run

One execution attempt for a task or orchestrator branch.

Fields:

- `id`
- `taskID`
- `sessionID`
- `parentRunID?`
- `parentTaskID?`
- `discipline`
- `schedulerLane`
- `status = queued | running | blocked | completed | error | canceled`
- `artifactIDs[]`
- `startedAt`
- `updatedAt`
- `finishedAt?`

### Approval

The durable human-in-the-loop gate for high-risk transitions.

Fields:

- `id`
- `scope = task | plan | permission | budget_override`
- `scopeID`
- `status = pending | approved | rejected | expired`
- `evidence`
- `feedback`
- `createdAt`
- `resolvedAt?`

### Checkpoint

The resumable state for an orchestrator branch.

Fields:

- `id`
- `runID`
- `taskID`
- `snapshot`
- `artifactIDs[]`
- `createdAt`

## Orchestrator Contract

Every orchestrator branch must have:

- one parent objective
- one owning tracker work item
- one active run
- explicit budget and spawn policy
- explicit success criteria
- explicit review contract for child outputs

Required contract fields:

- `objective`
- `inputs`
- `constraints`
- `deliverable`
- `successCriteria`
- `spawnPolicy`
- `budget`
- `reviewPolicy`
- `resumePolicy`

### Spawn Policy

Required spawn policy fields:

- `maxDepth`
- `maxFanout`
- `allowedDisciplines[]`
- `allowedTools?`
- `inheritApprovalPolicy`
- `inheritBudgetPolicy`
- `dedupeKey?`

Default recommendations:

- `maxDepth = 2`
- `maxFanout = 3`
- child orchestrators only when the parent has a clearly separable workstream
- workers should be preferred over child orchestrators for simple bounded execution

### Budget

Each branch must receive explicit inherited or overridden limits:

- `maxWallClockMS`
- `maxToolCalls`
- `maxModelTurns`
- `maxSpendUSD?`
- `maxParallelChildren`

Parent branches own budget arbitration and can:

- pause children
- cancel children
- escalate priority
- request human override

### Review Policy

Parents review artifacts, not only final text.

Required review actions:

- accept artifact
- reject artifact with feedback
- request retry
- request narrower follow-up
- escalate to adversarial review

Worker outputs should be treated as proposals until accepted by the parent branch.

## Runtime Rules

### Parent-Child Linkage

Every spawned child must record:

- `parentSessionID`
- `parentTaskID`
- `parentRunID`
- `rootSessionID`
- `discipline`
- `schedulerLane`

### Ownership

Only one active branch should own a tracker work item at a time.

If a task is delegated:

- `delegatedToSessionID` is set on the tracker item
- the parent remains accountable for final acceptance
- sibling branches can observe but should not mutate the same work item without explicit reassignment

### Checkpointing

An orchestrator should checkpoint when:

- it spawns children
- it receives child results
- it changes execution strategy
- it hits a budget or approval boundary
- it transitions to blocked or waiting states

### Blocking

Blocked state must always include a reason.

Minimum blocked payload:

- `blockedReason`
- `blockedByTaskIDs[]`
- `nextUnblockAction`

## State Machine

### Work Item Lifecycle

- `planning`
- `awaiting_approval`
- `approved`
- `executing`
- `blocked`
- `completed`
- `canceled`

### Run Lifecycle

- `queued`
- `running`
- `blocked`
- `completed`
- `error`
- `canceled`

### Approval Lifecycle

- `pending`
- `approved`
- `rejected`
- `expired`

## Near-Term Implementation Strategy

### Wave 1: Contract + Read Model

- Write this contract
- Add a root-scoped control snapshot surface combining tracker, plan state, workgraph, runtime task state, and execution ledger
- Do not replace any existing store yet

### Wave 2: Tracker-Backed Plan Artifacts

- Add plan artifacts linked to tracker work items
- Mirror current `enter_plan_mode` / `exit_plan_mode` behavior into tracker-linked state
- Keep `SessionPlanState` as a compatibility mirror during migration

### Wave 3: Explicit Orchestrator Branches

- Add parent/child run IDs and checkpoint records
- Attach spawned task sessions to tracker items and workgraph lanes
- Add explicit review/accept/reject semantics for child artifacts

### Wave 4: Budgets, Approvals, and Replay

- Add budget enforcement
- Add durable approval objects
- Add replayable trace/query surfaces for runs and branch history

## Expected Behaviors

The system should support these behaviors:

1. An orchestrator can spawn bounded child workers.
2. Child workers inherit root session and budget context.
3. Parent branches can inspect child artifacts and summarize them.
4. Recursive delegation is visible in runtime task state and the work graph.
5. Approval and budget boundaries pause execution cleanly instead of losing state.
6. A resumed branch can continue from its last checkpoint without rebuilding the plan from scratch.

## Validation Plan

### Immediate Live Validation

- Launch a real orchestrator-discipline subagent
- Ask it to spawn at least one child worker for a harmless read-only task
- Verify:
  - parent branch completes
  - child session is created
  - actual model response is captured
  - runtime task status reflects discipline and scheduler lane correctly

### Follow-On Automated Coverage

- unit tests for routing and budget inheritance
- task-tool tests for recursive delegation and review acceptance
- session/workgraph tests for parent-child linkage
- execution-ledger tests for branch lineage and replayability

## Non-Goals For Now

- full workflow DSL
- unbounded autonomous swarms
- replacing every existing state store in one pass
- GUI-first control plane before terminal workflows are excellent

## Recommended Next Move

Implement a read-only root control snapshot, then prove recursive orchestration in a small live run before changing deeper storage semantics.
