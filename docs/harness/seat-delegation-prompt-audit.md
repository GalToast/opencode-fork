# Seat Delegation Prompt Audit

## Purpose

Audit the model-facing prompt stack against the seat-delegation benchmark and the recursive authority model.

This audit focuses on the prompts that actually shape agent behavior in normal session execution:

- provider/system prompts
- environment prompt
- instruction/AGENTS prompt blocks
- coordination reminder prompt

It does not focus on retrieval prompt routing, because the seat-delegation benchmark enters through fresh `SessionPrompt.prompt(...)` calls and does not primarily depend on retrieval recall.

## Benchmark Expectations

The seat-delegation benchmark is testing whether the seat agent can correctly choose among:

1. `stay_solo`
2. `split_parallel`
3. `delegate_bounded_worker`
4. `gather_more_context_first`

The expected policy shape is:

- `stay_solo` when the seam is tightly coupled, same-file, or critical-path
- `split_parallel` only when slices are genuinely independent
- `delegate_bounded_worker` when one sidecar can help without taking over the critical path
- `gather_more_context_first` when ownership, architecture, or evidence are still unclear

The authority docs also add an important constraint:

- recursive coordination is allowed
- authority remains hierarchical
- user authority stays rooted at the root seat agent
- workers may coordinate within scope, but should escalate material scope changes upward

## Prompt Stack

### 1. Provider Prompt

Alibaba-plan models in this benchmark receive:

- `packages/opencode/src/session/prompt/alibaba.txt`

This is selected in:

- `packages/opencode/src/session/system.ts`

### 2. Environment Prompt

The environment layer adds:

- runtime model id
- cwd
- repo status
- platform / shell
- date

This comes from:

- `packages/opencode/src/session/system.ts`

### 3. Instruction / AGENTS Prompt

Instruction blocks are injected from:

- `packages/opencode/src/session/instruction.ts`

These may include repo and global `AGENTS.md` content.

### 4. Coordination Reminder

For substantial build tasks whose text smells like coordination work, `SessionPrompt.insertReminders(...)` appends:

- `packages/opencode/src/session/prompt/coordination.txt`

This reminder is triggered by long task text containing signals like:

- `coordinate`
- `parallel`
- `delegate`
- `subagent`
- `orchestr`
- `multi-step`
- `dependency`

The seat-delegation benchmark scenarios clearly match this gate, so `coordination.txt` is likely highly influential in this benchmark.

## What Aligns Well

### Alibaba Prompt

`alibaba.txt` is broadly aligned with the desired architecture.

Strong matches:

- it emphasizes practical execution over ritual
- it explicitly prefers `task` for bounded delegation
- it prefers tracker / blackboard / jit for substantial work
- it tells the model to organize proactively
- it encourages skill-first behavior instead of blind reinvention

Why this helps:

- it supports `delegate_bounded_worker`
- it supports recursive local orchestration
- it fits the current runtime architecture instead of inventing a different planner

### Coordination Reminder

`coordination.txt` also has several strong alignments.

Strong matches:

- it treats `task` as the worker lifecycle surface
- it distinguishes tracker, blackboard, TodoWrite, and jit
- it encourages bounded prompts for delegated work
- it explicitly recommends polling and steering existing workers instead of spawning duplicates
- it gives concrete launch shapes instead of abstract orchestration language

Why this helps:

- it makes delegation operational rather than rhetorical
- it pushes the model toward the actual surfaces the harness provides

## Main Misalignments

### 1. The Prompt Stack Over-Emphasizes Coordination, But Under-Specifies Restraint

The current prompt stack is much stronger on:

- use coordination
- use task
- use tracker
- use blackboard
- use parallel lanes

Than it is on:

- when to stay solo
- when not to split
- when same-file or critical-path work should remain local
- when context building should precede delegation

This matters because the benchmark is not just testing whether the model knows delegation exists.
It is testing whether the model can avoid premature fragmentation.

Observed effect:

- earlier benchmark runs showed failures exactly in false-parallel and premature-delegation cases
- the system already teaches "how to coordinate"
- it teaches "when not to coordinate" less explicitly

### 2. `coordination.txt` Treats Parallel Lanes As A First-Class Move Without Enough Warning About Premature Fanout

Problematic language:

- "`task` for bounded delegation, parallel lanes, and worker lifecycle"
- "Use `task` for bounded delegation or parallel lanes"
- "Prefer background execution for side work"

These are not wrong.
But they do not explicitly distinguish:

- bounded sidecar help
- broad parallel fragmentation
- context-first investigation

The benchmark suggests those distinctions matter a lot.

### 3. The Prompt Stack Does Not Explicitly Teach The Delegation Ladder

The authority model now says every branch should reason across:

1. `stay_solo`
2. `delegate_bounded_worker`
3. `coordinate_multi_worker`

And sometimes:

4. `gather_more_context_first`

But the current prompts do not teach this ladder directly.

Instead, they mainly teach tool choice and workflow surfaces.

That means the model learns:

- which tool to use once it decides to coordinate

More strongly than:

- how to choose the right coordination mode in the first place

### 4. The Prompt Stack Does Not Explicitly Encode Authority Boundaries

The authority docs now clearly distinguish:

- execution authority
- scope authority
- user authority

But the main model-facing prompts do not say this plainly.

What is missing:

- workers may coordinate recursively within scope
- workers should escalate material scope changes upward
- root user authority remains rooted at the seat agent

Without that, the model has orchestration guidance but not a crisp authority model.

### 5. Instruction / AGENTS Material Likely Over-Indexes On Parallel Spawn Readiness

The repo instruction layer contains strong language around:

- launching background lanes
- using `wait_for_result: false`
- true parallel work

That guidance is valuable operationally, but it can bias the session toward:

- "parallelize if possible"

Instead of:

- "choose among solo, bounded delegation, multi-worker coordination, or context-first investigation"

The issue is not that the instruction is wrong.
The issue is that it is asymmetric.

## Prompt Audit Conclusion

The current prompt stack is good at teaching:

- what coordination tools exist
- how to use them
- that bounded delegation is legitimate

It is less good at teaching:

- when not to fragment work
- when to gather context first
- the explicit delegation ladder
- the recursive authority model

In short:

- the prompts are tool-accurate
- the prompts are workflow-helpful
- the prompts are still slightly under-specified on delegation judgment policy

## Recommended Tightening

### 1. Add An Explicit Delegation Judgment Ladder To `coordination.txt`

Recommended addition:

- prefer `stay_solo` for tightly coupled, same-file, or critical-path work
- prefer `delegate_bounded_worker` when one sidecar can help without taking over the critical path
- prefer `coordinate_multi_worker` only when the work has genuinely independent slices
- prefer `gather_more_context_first` when ownership, evidence, or architecture are still unclear

This should be framed as a judgment rule, not a tool rule.

### 2. Add A “Do Not Fragment Yet” Clause

Recommended addition:

- do not split work just because it sounds multi-step
- do not fan out before identifying the blocking seam
- do not parallelize same-file dependent edits
- do not delegate the critical-path blocker unless there is a strong reason

This directly targets the benchmark trap cases.

### 3. Add A Short Authority Boundary Clause

Recommended addition:

- any branch may coordinate within its delegated scope
- material scope changes should escalate upward
- final user-facing authority stays at the root seat agent

This would align the session prompt with the authority docs.

### 4. Soften “Parallel Lanes” Language So It Is Conditional

Suggested shift:

From:

- use `task` for bounded delegation or parallel lanes

Toward:

- use `task` for bounded delegation by default
- use broader parallel lanes only when slices are cleanly independent

### 5. Keep Operational Tool Guidance, But Rebalance It With Judgment Guidance

Do not remove:

- tracker
- blackboard
- task
- jit
- skill-first

But prepend a brief judgment layer before the operational matrix so the model first decides:

- whether to stay local
- whether to gather context
- whether one sidecar is enough
- whether broad coordination is actually justified

## Recommended Next Step

Tighten `packages/opencode/src/session/prompt/coordination.txt` first.

That file is:

- directly relevant to the benchmark
- appended conditionally for coordination-shaped tasks
- much smaller and safer to iterate than the full provider prompt

After that:

1. rerun the seat-delegation matrix
2. compare `decision_lift` and `contract_lift`
3. only then decide whether `alibaba.txt` also needs delegation-policy tightening

## Addendum: Harder Suite Results

After the provider-level ladder landed in `alibaba.txt`, the original 8-scenario seat-delegation lane saturated and stopped distinguishing baseline from semantic behavior.

The upgraded suite expanded to 12 scenarios by adding four harder policy seams:

- `recursive_subsystem_owner`
- `locked_root_cause_clean_parallel`
- `scope_escalation_discovery`
- `shared_approval_gate`

It also removed giveaway wording from the bounded-worker scenarios so the benchmark would test judgment instead of keyword overlap.

### What The Live Results Showed

Across the completed live runs, the strongest separator was:

- `shared_approval_gate`

Why it mattered:

- several models collapsed unresolved approval/policy dependence into `stay_solo`
- stronger models held `gather_more_context_first`
- the miss is about authority and success-criteria grounding, not tool fluency

The second strongest separator was:

- `scope_escalation_discovery`

Why it mattered:

- it exposes whether the model recognizes material scope expansion as a re-grounding problem instead of a local execution choice
- some models answered with a local execution mode (`stay_solo`) or invented an escalation label instead of choosing the benchmark enum that best represents “pause and re-ground”

Additional useful separators:

- `one_sidecar_better_than_two_workers`
- `independent_ui_and_docs`

Why they mattered:

- `one_sidecar_better_than_two_workers` catches models that over-collapse bounded delegation into `stay_solo`
- `independent_ui_and_docs` catches models that over-collapse true parallel work into `delegate_bounded_worker`

Less diagnostic on the current suite:

- `single_seam_hotfix`
- `shared_file_false_parallel`
- `architecture_uncertainty`
- `delegate_before_context_trap`
- `critical_path_dependency`
- `recursive_subsystem_owner`
- `locked_root_cause_clean_parallel`

These still matter for coverage, but several stronger models now clear them routinely.

### Pool-Level Summary

Alibaba pool:

- `qwen3.5-plus` stayed saturated at `100%`
- `MiniMax-M2.5` stayed mixed but flat at `92%`
- `kimi-k2.5` and `glm-5` both fell to `83%` on the harder suite, with the misses concentrated in `scope_escalation_discovery` and `shared_approval_gate`

`opencode-free` pool:

- `nemotron-3-super-free` stayed saturated at `100%`
- `mimo-v2-pro-free` improved from `67%` to `83%`, making it the clearest positive-lift model on the harder suite
- `minimax-m2.5-free` and `big-pickle` both fell to `83%`
- `mimo-v2-omni-free` timed out before finishing the full suite

## Recommended Next Benchmark Revision

Keep these scenarios as core anchors:

- `shared_approval_gate`
- `scope_escalation_discovery`
- `one_sidecar_better_than_two_workers`
- `independent_ui_and_docs`

Recommended next additions or refinements:

### 1. Split Approval-Vs-Scope Ambiguity More Cleanly

Add one case where:

- scope is already known
- write sets are already known
- the only blocker is one unresolved root policy choice

This would isolate the “shared approval gate” behavior from broader architecture uncertainty.

### 2. Add A Recursive-Bounded Case With A False Parallel Temptation

Add one case where:

- a bounded subsystem owner is correct
- there is obvious temptation to top-level parallelize two slices
- the better move is still one delegated local seat who may recurse internally

This would test whether the model can distinguish “recursive bounded ownership” from “top-level split now.”

### 3. Add A Contract-Diagnostic Companion For Invented Escalation Labels

The current suite mostly surfaces true decision misses.
But `scope_escalation_discovery` also exposed one useful failure mode:

- the model invents a better-sounding escalation label instead of choosing the allowed enum

Keep the current exact-output contract, but consider one explicit scorer-side note or companion report for:

- “semantic concept right, benchmark enum wrong”

That would keep the benchmark strict while making this failure mode easier to track separately from generic wrong decisions.

### 4. Consider Rotating Out One Saturated Easy Solo Case

If the suite needs one more hard case without getting much longer, the best removal candidates are:

- `single_seam_hotfix`
- `shared_file_false_parallel`

Only do this if coverage pressure matters, because these still serve as useful sanity anchors.
