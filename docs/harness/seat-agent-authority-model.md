# Seat Agent Authority Model

## Purpose

Clarify how recursive coordination should work in OpenCode without collapsing authority boundaries.

This document is the companion to `docs/harness/recursive-orchestrator-contract.md`.
Implementation rollout lives in `docs/harness/seat-agent-authority-rollout.md`.

That contract explains how recursive delegation should be structured.
This document explains who is allowed to do what once delegation begins.

## Core Claim

Recursive coordination is allowed.

Workers may plan, decompose, spawn their own subagents, supervise child work, and integrate child outputs when that is the best way to complete their assigned scope.

What must remain hierarchical is authority, not capability.

## The Model In One Sentence

Coordination is recursive, authority is hierarchical, and the root seat agent remains the only final user-facing authority.

## Roles

### Root Seat Agent

The root seat agent is the session branch responsible for the user relationship.

It owns:

- the final user-facing answer
- the final acceptance of major scope changes
- final merge and synthesis responsibility for root work
- escalation to the user when constraints, risk, or intent materially change

The root seat agent may delegate execution.
It does not delegate accountability.

### Local Seat Agent

A delegated worker may act like a local seat agent inside its assigned scope.

That means it may:

- break work into subtasks
- choose to stay solo
- choose to launch one sidecar
- choose to launch multiple child workers
- supervise child work
- integrate and summarize child outputs

It does not automatically gain authority to redefine the parent objective or speak for the root branch to the user.

### Worker

A worker is any child branch executing a bounded scope.

Workers may be simple executors or local orchestrators depending on the branch contract.

The important distinction is not whether a branch is called a worker.
The important distinction is what authority that branch has been granted.

## Three Kinds Of Authority

### 1. Execution Authority

Permission to decide how assigned work gets done.

Includes:

- choosing tools
- planning local steps
- spawning subagents
- relaying or broadcasting to child branches
- building a local DAG
- integrating child outputs

Default policy:

- root seat agent: yes
- delegated worker: yes, within assigned scope

### 2. Scope Authority

Permission to redefine, widen, or materially redirect the task.

Includes:

- changing success criteria
- expanding the write set beyond the assigned boundary
- changing ownership boundaries
- pulling in new risky surfaces
- changing the intended deliverable

Default policy:

- root seat agent: yes
- delegated worker: limited

Workers may refine local execution plans.
Workers should not materially widen scope without escalating upward.

### 3. User Authority

Permission to make final commitments to the user.

Includes:

- delivering the final answer
- claiming work is complete for the root objective
- making outward guarantees
- resolving ambiguity in user intent without escalation

Default policy:

- root seat agent: yes
- delegated worker: no

## Invariants

These invariants should hold even when recursion is deep.

1. The root seat agent is the only final user-facing authority.
2. Any branch may coordinate recursively inside its delegated scope.
3. Child branches inherit constraints unless explicitly narrowed or expanded by a parent with scope authority.
4. Final acceptance rolls upward.
5. Shared resource conflicts must still be enforced globally.
6. Recursive delegation must remain inspectable in runtime state.

## What Workers Should Be Allowed To Do

Workers should be allowed to:

- spawn their own child workers
- pause or resume child work
- escalate child priority
- build local tracker structures
- use blackboard state for local coordination
- review and reject child artifacts
- ask for narrower retries
- terminate unhelpful child branches

This is expected behavior, not an exception path.

If a worker cannot coordinate inside its own scope, it is not really responsible for outcomes.

## What Workers Should Not Do By Default

Workers should not, by default:

- redefine the root objective
- claim a major scope change without parent approval
- silently fan out into unbounded swarms
- take final ownership of user-facing commitments
- mutate contested shared files without coordination rules
- bypass parent review for high-risk outputs

## Delegation Ladder

Every branch should be able to choose among these modes:

1. `stay_solo`
2. `delegate_bounded_worker`
3. `coordinate_multi_worker`

This ladder applies recursively.

A worker may itself decide that `coordinate_multi_worker` is appropriate for its local scope.

The important rule is that the ladder governs execution strategy, not user authority.

## Recommendation Policy

The runtime should not treat all three modes as equally default.

Current benchmark evidence most strongly supports:

- reliable suggestions for `delegate_bounded_worker`
- caution around premature broad parallelization

That means:

- multi-worker coordination should be allowed
- multi-worker coordination should not be suggested casually
- the system should prefer bounded delegation unless there is strong evidence of clean decomposition

## Escalation Rules

A child branch should escalate upward when any of the following is true:

- the task boundary appears wrong
- the write set expands materially
- the branch needs a new approval boundary
- the branch discovers a major change to deliverable or intent
- the branch hits budget or recursion limits
- the branch finds conflicting child results it cannot safely reconcile

Escalation is about scope and commitment, not about ordinary execution planning.

## Resource And Conflict Rules

Recursive coordination does not remove global safety constraints.

The system still needs:

- file ownership or contention handling
- browser or tool mutexes where required
- scheduler fairness across root families
- bounded recursion and fanout
- visible lineage for parent and child branches

If a child branch coordinates aggressively, those protections matter more, not less.

## Practical Runtime Mapping

This model maps cleanly onto the current system:

- `task` provides recursive worker lifecycle management
- scheduler lanes and priorities provide execution control
- tracker DAG provides durable dependency structure
- blackboard provides compact shared lane memory
- runtime task lineage provides inspectability
- root seat agent remains the final answer layer

What is still needed is a clearer runtime policy that makes these authority boundaries explicit instead of implicit.

## Near-Term Runtime Policy

The near-term runtime policy should be:

1. Let any branch coordinate within its delegated scope.
2. Keep root user authority at the root seat layer only.
3. Require upward escalation for material scope changes.
4. Bias suggestions toward bounded delegation before broad parallelization.
5. Keep recursive lineage, budgets, and ownership visible in status surfaces.

## Non-Goals

This model does not require:

- forbidding recursive delegation
- making the root seat agent micromanage every child step
- forcing all workers to remain simple executors
- flattening all orchestration into one top-level planner

## Recommended Next Move

Encode this authority split explicitly in runtime policy:

- execution authority
- scope authority
- user authority

Then teach the delegation and coordination surfaces to preserve those boundaries while still allowing recursive orchestration.
