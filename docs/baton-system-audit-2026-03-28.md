# Baton System Audit

Date: 2026-03-28

Scope: `packages/opencode` baton-like continuity and handoff mechanisms across prompt assembly, task orchestration, recovery, compaction, planning, retrieval, and foreground orchestration.

## Follow-up implementation notes

The narrow baton follow-up landed after this audit and changes a few details in the live code:

- Normal prompt assembly now injects the latest committed execution brief as its own baton block when one exists in the root-session workgraph.
- Mission ingress no longer mirrors raw user intent into `constraintsSummary`; prompt ingress now extracts constraint-like clauses separately so the mission baton is less self-duplicating.
- Prompt-side baton observability now has an internal helper in `src/session/prompt.ts` (`SessionPrompt.inspectBatons(...)`) that reports the currently materializable mission, reasoning-ledger, execution-brief, social-memory, and foreground baton state for a session.
- Baton observability is now centered on an internal registry in `src/session/baton-registry.ts`. It provides an agent-friendly active snapshot plus a recent-history view assembled from the existing baton stores, so baton debugging no longer needs to manually inspect each subsystem one at a time.
- Task settlement now honors explicit provenance markers such as `reasoning_commitment_id: ...`, `reasoning_assumption_id: ...`, `reasoning_falsifier_id: ...`, and `plan_node_id: ...` when they appear in task output or artifact summaries. Those reconciliations are applied in order rather than in parallel so one ledger transition cannot clobber another through a stale-snapshot write race.
- Task orchestration batons now carry an explicit provenance protocol plus a small set of active reasoning/workgraph IDs, so child-task prompts have a default path for echoing stable baton references in their final output instead of relying on ad hoc wording.
- Experimental server routes now expose `GET /experimental/batons/:sessionID` as a small read-only inspection surface over `SessionPrompt.inspectBatons(...)`.
- `RetrievalBaton.formatSystem(...)` remains intentionally unhooked from the default prompt path. Ordinary turns already receive curated semantic recall through session social memory, so wiring the raw generic formatter directly into the same path would currently duplicate recall and add prompt noise.

## What "baton" means in this fork

In this codebase, a baton is not one single abstraction. It is a family of continuity payloads that carry durable context from one turn, subsystem, or agent boundary to the next so downstream execution does not need to reconstruct intent, constraints, or recovery posture from scratch.

Some batons are explicit first-class data structures. Others are prompt blocks with baton language. A few are baton-adjacent state carriers that serve the same handoff purpose without being injected into prompts.

Important clarification: there is no first-class `PromptBaton` type in the current fork. "Prompt baton" is a useful mental label, but in code it currently means prompt-time baton blocks such as mission and reasoning-ledger context.

## Canonical Baton Inventory

| Baton / carrier | Producer | Consumer | Purpose | Primary code |
| --- | --- | --- | --- | --- |
| Mission baton | `SessionMission.materialize(...)` | Normal prompt assembly and compaction prompt assembly | Preserve durable user intent, constraints, and steering history across turns | `src/session/mission.ts`, `src/session/prompt.ts`, `src/session/compaction.ts` |
| Reasoning-ledger baton | `ReasoningLedger.materialize(...)` | Normal prompt assembly | Preserve commitments, assumptions, and falsifiers across turns | `src/session/reasoning-ledger.ts`, `src/session/prompt.ts` |
| Compaction reasoning snapshot | `collectReasoningLedgerLines(...)` plus ledger and mission inputs | Compaction prompt assembly | Preserve world-state deltas and active reasoning obligations through compaction | `src/session/compaction.ts` |
| Semantic retention baton | `materializeCompactionRetentionBaton(...)` | Compaction prompt assembly | Preserve the few retrieved facts that must survive context collapse | `src/session/compaction.ts` |
| Orchestration recall baton | `materializeTaskOrchestrationBaton(...)` | Child task launch prompt and task metadata | Carry proven patterns, expected artifact shape, and current execution-brief commitments into a spawned task | `src/tool/task.ts` |
| Recovery baton | `materializeTaskRecoveryBaton(...)` | Task watchdog retry path and detached-turn recovery | Re-ground a recovered task in world state, learned warnings, invalidation signals, and contingency actions | `src/tool/task.ts` |
| Retrieval baton substrate | `RetrievalBaton.usefulCandidates(...)`, `.compact(...)`, `.formatSystem(...)` | Specialized baton builders | Shared retrieval selection and formatting layer under compaction/task/workgraph baton builders | `src/retrieval/baton.ts` |
| Execution brief artifact | `plan.commit_execution_brief` path | Task orchestration baton, recovery baton, task metadata, task outcome memory | Persist a committed plan with checkpoints, invalidation signals, and contingency actions | `src/tool/plan.ts`, `src/session/execution-brief.ts`, `src/tool/task.ts` |
| Foreground baton state | `SessionForeground.accept/promote/touch/steer/settle(...)` | TUI/session routes, scheduler, experimental route | Preserve which session or turn currently owns the visible foreground and steer state | `src/session/foreground.ts`, `src/session/prompt.ts`, `src/server/routes/experimental.ts` |
| Workgraph digest / orchestration snapshot | `SessionWorkGraph.materialize(...)` | Compaction prompt assembly, tooling, routes | Preserve objective/lane/artifact/planning state; currently compaction-only as a prompt block | `src/session/workgraph.ts`, `src/session/compaction.ts` |

## Lifecycle Map

### 1. User ingress

The first continuity capture happens during prompt ingress.

- `SessionMission.recordIngress(...)` records the latest intent and constraints summary in `src/session/prompt.ts`.
- `recordReasoningLedgerSignals(...)` extracts user-authored reasoning cues and stores them into the reasoning ledger in `src/session/prompt.ts`.
- `SessionForeground.accept(...)` records the newest foreground claimant before the assistant responds in `src/session/prompt.ts`.

This gives the system three distinct carry-forward layers very early:

- mission / steering continuity
- reasoning / promise continuity
- UI / foreground continuity

### 2. Normal prompt assembly

The live assistant prompt currently gets baton-style context from:

- the mission baton in `src/session/prompt.ts`
- the reasoning-ledger baton in `src/session/prompt.ts`
- social memory, skills, and other context blocks

This means ordinary turns can inherit intent and reasoning state directly, but they do not currently receive a generic semantic recall baton or a direct execution-brief baton.

### 3. Task spawn

When `task(action="start")` launches a child session, the task layer builds a specialized orchestration baton in `src/tool/task.ts`.

That baton can include:

- retrieved analogs from prior task artifacts or assistant output
- expected artifact hints
- the latest committed execution brief
- checkpoints, invalidation signals, and contingency actions from that brief

This baton is prepended to the child task prompt rather than being globally injected into every turn.

### 4. Recovery

When a task is recovered after a detached-turn issue or watchdog-triggered retry, `materializeTaskRecoveryBaton(...)` builds a recovery brief in `src/tool/task.ts`.

That brief carries:

- the recovery trigger
- learned warnings and learned resolutions from retrieval
- execution-brief invalidation signals
- execution-brief contingency actions
- possible triggered invalidation signals inferred from the current failure context

This is the most explicitly "world-state checkpoint" baton in the current fork.

### 5. Compaction

Compaction assembles a different baton stack in `src/session/compaction.ts`.

It can include:

- mission baton
- compaction-specific reasoning snapshot
- semantic retention baton
- orchestration state snapshot from the workgraph

This means compaction is currently the richest baton composition surface in the codebase. It is explicitly trying to decide what survives, not just what guides the current turn.

### 6. Post-settlement feedback loops

After task settlement, the system feeds some baton-adjacent information back into memory surfaces:

- `persistExecutionBriefOutcomeMemory(...)` writes execution-brief outcome artifacts in `src/tool/task.ts`
- `reconcileReasoningLedgerOutcome(...)` tries to reconcile observed task outcomes back into the reasoning ledger in `src/tool/task.ts`
- retrieval feedback is written for orchestration and recovery runs in `src/tool/task.ts`

This is the beginning of a closed-loop baton system, but the loop is still partly heuristic.

## What Is Strong

- The baton idea is already present at multiple layers, not just as one retrieval trick.
- Mission and reasoning continuity are separated cleanly instead of being shoved into one blob.
- Task orchestration and recovery use baton payloads that are more operational than the normal prompt stack.
- Execution briefs are structured and already threaded into orchestration and recovery paths.
- Foreground baton state gives the TUI and scheduler a shared notion of visible ownership instead of relying only on transcript timing.
- Compaction is not just summarization; it explicitly preserves baton-worthy continuity.

## Findings

### 1. "Prompt baton" is terminology, not a first-class object

There is no canonical `PromptBaton` type or registry. The system has prompt-time baton blocks, but not one unified prompt baton abstraction.

Impact:

- debugging is harder because "prompt baton" can mean mission baton, reasoning-ledger baton, or a general baton-like block
- the baton set is harder to audit because the code lacks one declared contract for prompt-carried baton payloads

### 2. `RetrievalBaton.formatSystem(...)` is currently unhooked

`src/retrieval/baton.ts` exports a generic system-format semantic recall baton, but there are no consumers in the current source tree.

Impact:

- there is a reusable baton substrate that is not actually available as a normal prompt surface
- the fork has specialized baton builders, but no generic recall baton path for ordinary prompt continuity or ambiguity handling

This is not necessarily wrong, but it is dead or dormant capability right now.

### 3. Reasoning-ledger falsifier capture is structurally lossy

In `src/session/prompt.ts`, falsifiers recorded from user text choose `targetType` using this rule:

- if any assumptions were extracted, target `assumption`
- otherwise target `commitment`

That is a coarse fallback, not a real target match.

Impact:

- falsifiers can be attached to the wrong semantic category
- downstream reconciliation and future baton materialization may preserve incorrect break conditions

This is the clearest baton-related correctness bug in the current mapping.

### 4. Mission constraints are currently under-modeled

At ingress, `SessionMission.recordIngress(...)` is called with `constraintsSummary: intent.trim()` in `src/session/prompt.ts`.

Impact:

- mission focus and constraints are often duplicates of the same text
- the mission baton does not yet distinguish "what we want" from "what must not be violated"
- constraint-specific baton quality is weaker than it looks

### 5. Execution brief is not part of the normal prompt baton stack

The execution brief is well structured and is used in planning, task orchestration, and recovery. But it is not injected into the ordinary root/session prompt stack in `src/session/prompt.ts`.

Impact:

- the main live assistant can lose contact with the currently committed execution brief unless it is reintroduced indirectly through task flows or compaction
- planning commitments are strongest at task boundaries, weaker at normal conversational boundaries

This is a gap, not necessarily a bug.

### 6. Orchestration state snapshot is compaction-only as a prompt surface

`src/session/compaction.ts` includes an orchestration state snapshot block, but the normal prompt path does not.

Impact:

- active swarm topology and lane state are available during compaction handoff but not during routine assistant prompting
- some orchestration continuity depends on local runtime state instead of a durable baton-like prompt block

### 7. Task-to-ledger reconciliation is heuristic rather than linked

`reconcileReasoningLedgerOutcome(...)` in `src/tool/task.ts` matches settled task outcomes back to ledger entries by token overlap between observed result text and ledger statements.

Impact:

- false positives and false negatives are possible
- the reasoning-ledger baton is not using structured IDs or provenance links from spawned tasks back to the originating commitments or assumptions

This is a major architectural weakness for a system that wants baton continuity to be trustworthy.

### 8. Compaction heuristics may suppress some legitimate baton evidence

`src/session/compaction.ts` penalizes text containing `bug`, `debug`, `baton`, or `compaction` in `compactionTechnicalityScore(...)`, and explicit phrases like "caught the compaction baton" are treated as noise.

That makes sense for conversational junk, but it can also suppress technical baton discussion that is actually relevant to continuity.

Impact:

- baton-debugging conversations may be less likely to survive compaction cleanly
- continuity-critical meta-debug text can be treated as low-value chatter

This looks intentional but brittle.

### 9. Baton observability is fragmented

The fork has:

- mission storage
- reasoning-ledger storage
- foreground baton state
- execution ledger events
- workgraph artifacts
- retrieval feedback

But there is no single baton inspection surface that answers:

- which batons exist right now
- which turn or task consumed them
- when they were last refreshed
- whether they were derived, injected, or merely stored

Impact:

- architecture is stronger than its observability
- baton bugs are harder to trace than they need to be

### 10. Repo-level baton documentation infrastructure is thin

There is currently no `repo-index.md` at the repo root, and there was no existing baton architecture note before this audit.

Impact:

- baton knowledge is living mostly in code and memory, not in repo-facing docs
- recurring baton debugging is more likely to repeat the same mapping work

## System Weaknesses

The biggest system-level weakness is not "too few batons." It is that the baton family is asymmetrical.

- prompt-time batons are simple and durable
- task-time batons are richer and more operational
- compaction-time batons are the richest of all
- post-settlement reconciliation back into durable state is the weakest and most heuristic

In other words, baton creation is ahead of baton closure.

The second weakness is missing canonical structure. The fork has a baton philosophy, but not yet a baton protocol. Payloads vary by subsystem, naming is inconsistent, and there is no central "baton registry" contract describing fields like:

- baton kind
- source
- scope
- freshness
- linked artifact ids
- linked ledger ids
- intended consumers

The third weakness is that ordinary live prompting does not yet get the same rich continuity support that compaction and task orchestration get. The most operational baton state is concentrated at boundaries, not in the normal prompt loop.

## Should the system have more batons?

Yes, but selectively.

The fork does not need "more batons everywhere." It needs a few missing baton classes and better baton discipline.

High-value additions:

- A first-class execution-brief baton for normal prompt assembly.
- A linked reasoning-resolution baton or ledger-reference baton so tasks can reconcile by ID instead of lexical guesswork.
- A generic semantic recall baton for normal prompt assembly, but only under ambiguity, recovery, or long-lived continuation conditions.
- A baton registry / inspection surface for debugging and TUI observability.

Low-value additions:

- More baton variants that duplicate existing mission or recovery payloads without solving linkage or observability.

## Are the current batons being used well?

Mostly yes on the producer side.

- Mission baton is well placed.
- Reasoning-ledger baton is conceptually good and injected where it matters.
- Orchestration and recovery batons are practical and rich.
- Compaction baton logic is thoughtful and intentionally selective.

Where usage is weaker:

- mission constraints are not extracted distinctly enough
- execution brief is not used broadly enough
- retrieval baton substrate is not exposed generically
- reasoning outcomes are not reconciled with strong enough structure

## How to elevate the baton system further

### 1. Define a canonical baton contract

Introduce a small shared schema for baton metadata:

- `kind`
- `scope`
- `source`
- `producer`
- `consumers`
- `createdAt`
- `updatedAt`
- `linkedIDs`
- `summary`

Specialized baton payloads can still differ, but every baton would at least share inspectable metadata.

### 2. Promote execution brief into the normal prompt stack

Execution brief should be visible to the main assistant, not only to planning and spawned task flows.

The prompt stack should be able to say:

- here is the mission
- here is the reasoning ledger
- here is the currently committed execution brief

That would align root-turn execution with task-turn execution.

### 3. Replace lexical reconciliation with linked reconciliation

When tasks are spawned from an orchestration baton or execution brief, record provenance links to the relevant:

- commitment ids
- assumption ids
- falsifier ids
- execution brief artifact id

Then reconciliation can operate by explicit references first, lexical matching second.

### 4. Separate constraints from intent at ingress

Mission quality will improve if ingress extracts:

- objective
- constraints
- steering deltas

as distinct fields rather than copying `intent` into `constraintsSummary`.

### 5. Add a normal-turn semantic recall baton with strict gating

Do not inject generic retrieval recall into every prompt. That would bloat the stack.

Instead, inject a bounded semantic recall baton only when:

- a continuation is long-running
- there was recent recovery or failure
- the current turn is ambiguous
- baton-critical state changed since the last turn

### 6. Build a baton inspection route

Add one debugging route or tool that returns the live baton set for a root session:

- mission
- reasoning ledger
- execution brief
- foreground state
- orchestration/recovery baton summaries
- last consumers
- freshness / age

This would make baton bugs dramatically easier to diagnose.

## Suggested repair order

1. Fix falsifier targeting.
2. Add execution-brief baton to the normal prompt stack.
3. Add explicit provenance links so task settlement can reconcile ledger outcomes structurally.
4. Decide whether to activate the generic retrieval baton path for gated normal-turn recall.
5. Add baton observability and documentation cleanup.

## Quick reference

Key files:

- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/mission.ts`
- `packages/opencode/src/session/reasoning-ledger.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/retrieval/baton.ts`
- `packages/opencode/src/tool/task.ts`
- `packages/opencode/src/tool/plan.ts`
- `packages/opencode/src/session/execution-brief.ts`
- `packages/opencode/src/session/foreground.ts`
- `packages/opencode/src/session/workgraph.ts`
