# Harness Benchmark Roadmap

## Purpose

This roadmap defines how harness benchmarks should evolve.

The goal is not to build the most realistic benchmark in the abstract.
The goal is to improve the harness.

That means each benchmark should help answer:

- does the harness outperform a simpler baseline
- where does it outperform
- which layer produced the win
- what harness change should come next

## Operating Loop

Use this loop for every benchmark family:

1. Build a benchmark around a real harness seam.
2. Run baseline vs harness.
3. Improve the harness until that benchmark mostly saturates.
4. Keep the benchmark as a regression suite.
5. Graduate to the next unsolved seam.

Benchmark realism matters, but only insofar as it helps us tune the harness.
If a benchmark is hard but does not create useful harness-vs-baseline divergence, it is not doing enough work for us.

## What The Current Fork Already Covers

### 1. Retrieval Substrate Integrity

Code:

- `packages/opencode/src/harness/retrieval-substrate-benchmark.ts`
- `packages/opencode/test/harness/retrieval-substrate-benchmark.test.ts`

Current coverage:

- embedding identity by lane
- provider vs fallback ranking parity
- feedback scope isolation
- truthful degraded observability

What this benchmark is good for:

- catching broken substrate invariants
- validating cache identity and fallback parity
- preventing silent scope leakage

Current limitation:

- only 4 scenarios
- does not yet probe stale-vector invalidation, negative-index behavior, or broader indexing drift

### 2. Retrieval Quality

Code:

- `packages/opencode/src/harness/retrieval-quality-benchmark.ts`
- `packages/opencode/src/harness/retrieval-quality-real-cases.ts`
- `packages/opencode/test/harness/retrieval-quality-benchmark.test.ts`

Current coverage:

- decision retrieval
- recovery retrieval
- task-pattern retrieval
- file-locator retrieval
- compaction retention retrieval

What this benchmark is good for:

- comparing retrieval prompt presets and literal/hybrid/routed variants
- measuring top-1, top-3, and MRR
- checking whether routed retrieval outperforms static default pairings

Current limitation:

- still mostly synthetic candidate construction
- live traces are only partially promoted into the benchmark
- does not isolate router accuracy from final retrieval quality

### 3. Semantic Lift

Code:

- `packages/opencode/src/harness/semantic-benchmark.ts`
- `packages/opencode/src/harness/semantic-quality-benchmark.ts`
- `packages/opencode/test/harness/semantic-benchmark.test.ts`
- `packages/opencode/test/harness/semantic-quality-benchmark.test.ts`

Current coverage:

- routing
- planning
- recovery
- coding posture
- exact-output discipline

What this benchmark is good for:

- testing whether semantic context changes the model's decision
- distinguishing reasoning lift from exact-output cleanup

Current limitation:

- mostly prompt-local evals
- not yet explicitly tied to live retrieval traces or tool-use outcomes

### 4. Delegation Judgment

Code:

- `packages/opencode/src/harness/seat-delegation-benchmark.ts`
- `packages/opencode/test/harness/seat-delegation-benchmark.test.ts`
- `docs/harness/seat-delegation-prompt-audit.md`

Current coverage:

- `stay_solo`
- `delegate_bounded_worker`
- `split_parallel`
- `gather_more_context_first`

What this benchmark is good for:

- downstream harness behavior
- authority-boundary judgment
- exact-output enum discipline

Current limitation:

- only one downstream behavior family
- not a general tool-use or task-completion benchmark

### 5. Confidence Research

Code:

- `packages/opencode/src/harness/confidence.ts`
- `packages/opencode/test/harness/confidence.test.ts`

Current coverage:

- healer-lane routing for structured confidence research
- exact-output-safe proposal refinement

What this benchmark is good for:

- verifying that confidence promotion machinery uses the intended harness lane

Current limitation:

- much lighter than the other benchmark families
- does not yet measure confidence quality against historical outcomes

## What We Should Add

### Priority 1: Live Trace Replay

Why:

- this is the cleanest path from synthetic evals to real use
- the fork already logs retrieval traces and can extract them
- it lets us measure whether current routing and retrieval policy choices preserve or improve live behavior

First step:

- benchmark replay over captured retrieval traces
- score routed-intent agreement and instruction alignment against live traces

Later expansion:

- score recovered top document against the live winning document
- score downstream task outcomes once traces include stronger labels

Live trace collection rules:

- keep retrieval tracing enabled during normal harness work when we are actively tuning the substrate
- preferentially harvest traces with low routing confidence or dual-intent blends
- preferentially harvest traces where the top candidate margin is tight
- preferentially harvest traces where user phrasing is short, messy, or ambiguous
- use those traces to grow replay fixtures before adding more synthetic benchmark families

Useful helper commands:

- `bun run retrieval:trace:ambiguous`
- `bun run retrieval:trace:capture:ambiguous`

### Priority 2: Intent Router Benchmark

Target:

- `packages/opencode/src/retrieval/prompt.ts`

Why:

- router quality is currently inferred indirectly
- we need a dedicated benchmark for primary intent, secondary intent, confidence, and wrong-route cost

Success criteria:

- high primary-intent accuracy
- useful low-confidence dual-intent behavior
- better router agreement on real traces than static baseline presets

Current read:

- `packages/opencode/src/harness/retrieval-intent-router-benchmark.ts`
- `packages/opencode/script/benchmark-harness-retrieval-intent-router.ts`

The first mixed-corpus pass uses five clean single-intent retrieval cases plus six real ambiguous replay cases. On that 11-scenario suite, a simple primary-only classifier and the full auto intent router both hit `100%` primary-intent accuracy, but the divergence shows up exactly where it should: the primary-only classifier lands at `45%` exact-route accuracy while the auto intent router reaches `91%` on exact route, secondary intent, confidence, and strategy. That means the router benchmark is now doing useful work for the harness: it is not telling us “can the system name the obvious primary category,” it is telling us whether the harness preserves uncertainty and dual-intent structure well enough to influence downstream retrieval behavior.

### Priority 3: Hybrid Ranker Ablation Benchmark

Target:

- `packages/opencode/src/retrieval/search.ts`

Why:

- we need to know what is actually causing wins
- otherwise embeddings, reranking, feedback priors, and outcome priors stay mixed together

Required ablations:

- lexical only
- semantic only
- rerank only
- hybrid current
- hybrid without feedback score
- hybrid without outcome score

Current read:

- `packages/opencode/src/harness/retrieval-trace-ranker-ablation-benchmark.ts`
- `packages/opencode/script/benchmark-harness-retrieval-trace-ranker-ablation.ts`

The first live replay ablation pass showed something important: on the current 14-scenario combined replay corpus, `retrieval_base` and all production hybrid variants already preserve the captured winner at `100%` top-document replay accuracy. The weaker paths are the lexical-only replay and the custom intent-aware replay heuristic. That means the current `77%` ceiling in the older replay lane is not evidence that the production hybrid blend is broken; it is evidence that the benchmark's custom replay-scoring layer is stricter or drifted relative to the production ranking path.

Implication:

- keep the ablation lane as the source of truth for “is the hybrid blend the problem”
- treat future winner-preservation work as candidate-generation / corpus / replay-heuristic work unless the ablation lane stops saturating

### Priority 4: Retrieval-To-Tool-Use Benchmark

Why:

- improving retrieval only matters if it changes what the agent does
- tool choice and inspect-first behavior are core harness responsibilities

Coverage to add:

- read first vs edit too early
- one tool vs too many tools
- correct tool family
- no-tool-needed restraint
- context gathering before delegation

Current read:

- `packages/opencode/src/harness/retrieval-tool-use-benchmark.ts`
- `packages/opencode/script/benchmark-harness-retrieval-tool-use.ts`

The tool-use lane now has built-in per-scenario observability (`scenario_start`, baseline/semantic completion, and final score) plus timeout-safe scoring so a single slow prompt no longer aborts the whole suite. The first observed live pass on `alibaba-coding-plan/glm-5` with a 15s prompt cap came back flat at `60% -> 60%` over five scenarios, which exposed two timeout-heavy seams:

- `inspect_before_edit_same_file`
- `one_targeted_read_not_tool_sweep`

After tightening those two prompts to be more literal and less invitation-to-ruminate, the same live run on `glm-5` became a real downstream harness win:

- baseline: `80%` (`4/5`)
- semantic: `100%` (`5/5`)
- `decision_lift = +1`
- profile: `strong_tool_judgment_strong_control`

The semantic side specifically rescued:

- `inspect_before_edit_same_file`

- `no_tool_for_policy_recall`
- `prefer_local_repo_over_webfetch`
- `bounded_edit_not_broad_refactor`

all pass cleanly on both baseline and semantic prompts, and `one_targeted_read_not_tool_sweep` now also clears on both sides under the same cap. Interpretation: this lane is now doing useful downstream work for the harness. Retrieval context is measurably improving tool-choice behavior, even though the remaining baseline miss still presents as a timeout rather than a wrong-but-fast answer.

### Priority 5: Retrieval-To-Outcome Benchmark

Why:

- this closes the loop from substrate quality to actual harness performance

Coverage to add:

- seat-delegation lift attributable to retrieval
- confidence research quality
- exact-output under context pressure
- multi-turn recovery and replanning

Current read:

- `packages/opencode/src/harness/retrieval-outcome-benchmark.ts`
- `packages/opencode/script/benchmark-harness-retrieval-outcome.ts`

This lane now exists and mirrors the tool-use benchmark shape: exact-enum baseline vs semantic outcome choices, timeout-safe scoring, and built-in per-scenario observability. The first scenario family focuses on whether retrieval changes the actual next move:

- answer directly from current evidence
- rerun a narrow check after one failure
- escalate scope when the write set widens
- gather context before a cross-cutting decision
- ship a bounded patch after a verified seam fix

The first observed live pass on `alibaba-coding-plan/glm-5` became genuinely useful after tightening the `answer_directly_from_live_findings` scenario to be more concrete and less invitation-to-ruminate. With `HARNESS_BENCH_PROMPT_TIMEOUT_MS=15000`, the lane now shows real downstream harness lift:

- baseline: `60%` (`3/5`)
- semantic: `100%` (`5/5`)
- `decision_lift = +2`
- profile: `strong_outcome_gain_strong_control`

The lift came from two previously broken rows:

- `answer_directly_from_live_findings`
- `escalate_scope_after_new_write_set`

In both cases the semantic condition answered correctly while the baseline exhausted the timeout budget. Interpretation: this lane is now doing the kind of work we want from a harness benchmark. Retrieval context is not just cleaning up output format or route nuance; it is changing the actual next-step decision quality in a measurable way.

### Priority 6: Retrieval-To-Multi-Turn-Recovery Benchmark

Why:

- recovery is one of the clearest places where retrieval should pay rent
- the user often keeps us in the same thread while the state changes underneath us
- we need to know whether semantic context improves replanning after timeouts, corrections, widened scope, and evidence conflicts

Current read:

- `packages/opencode/src/harness/retrieval-multiturn-recovery-benchmark.ts`
- `packages/opencode/script/benchmark-harness-retrieval-multiturn-recovery.ts`

This lane mirrors the same exact-enum, timeout-safe, observable format as tool-use and outcome, but focuses specifically on recovery and continuation:

- retry narrowly after one timeout
- replan after user correction
- escalate when new evidence widens scope
- resume from verified partial progress
- re-ground when evidence sources conflict

The first observed live pass on `alibaba-coding-plan/glm-5` with `HARNESS_BENCH_PROMPT_TIMEOUT_MS=15000` already shows useful downstream lift:

- baseline: `80%` (`4/5`)
- semantic: `100%` (`5/5`)
- `decision_lift = +1`
- profile: `strong_recovery_gain_strong_control`

The semantic side specifically rescued:

- `timeout_then_narrow_retry`

while the other four scenarios passed on both sides. Interpretation: this is a valid new frontier lane. Retrieval context is helping the harness recover from multi-turn timeout/replanning situations rather than merely preserving formatting.

### Priority 7: Broader Substrate Integrity

Extend the existing substrate benchmark to cover:

- stale embedding invalidation after instruction changes
- mixed-policy cache contamination
- negative-index isolation
- source-type scope regressions
- truthful observed-runtime vs requested-policy reporting

## How To Decide A Benchmark Is Saturated

A benchmark family is saturated enough to demote from frontier status when:

- the preferred harness configuration wins consistently across model pools
- further prompt or router tweaks stop producing meaningful lift
- remaining misses stop pointing to concrete harness changes
- the suite still serves as a useful regression guard

When that happens:

- keep it
- stop polishing it as the frontier
- move to the next benchmark seam

## Current Recommended Order

1. Live trace replay
2. Confidence-quality outcome benchmarking
3. Broader substrate integrity expansion
4. Expand real-trace coverage for winner-preservation and downstream replay

Intent router and hybrid ranker ablation stay in the stack as active diagnostic lanes. Retrieval-to-tool-use, retrieval-to-outcome, and retrieval-to-multi-turn-recovery now also move into active regression status after showing positive downstream lift on `glm-5`. The current unsolved frontier is confidence-quality benchmarking and then broader confidence/history-grounded replay.

### Priority 7: Retrieval-To-Confidence-Quality Benchmark

Why:

- retrieval should help the harness decide when a proposal is truly mature enough to trust
- confidence promotion is where vague judgment can quietly waste a lot of work
- this is the clearest downstream seam after tool-use, outcome, and recovery

Current read:

- `packages/opencode/src/harness/retrieval-confidence-quality-benchmark.ts`
- `packages/opencode/script/benchmark-harness-retrieval-confidence-quality.ts`

This lane asks whether retrieval improves confidence actions across five focused seams:

- promote after narrow verified evidence
- narrow when scope is too broad
- keep confidence flat on mixed evidence
- promote after a retry clarified the seam
- defer when conflicting evidence undermines the rationale

The first observed live pass on `alibaba-coding-plan/glm-5` with `HARNESS_BENCH_PROMPT_TIMEOUT_MS=15000` was immediately useful:

- baseline: `80%` (`4/5`)
- semantic: `100%` (`5/5`)
- `decision_lift = +1`
- profile: `strong_confidence_gain_strong_control`

The semantic side specifically rescued:

- `promote_after_narrow_verified_evidence`

while the other four scenarios passed on both sides. After a small prompt cleanup that made the promotion row more literal ("the proposal is narrow, the source files are present, and the evidence now clearly supports the fix"), the live result stayed stable in the useful direction: baseline still timed out on that row, while semantic answered `promote_confidence` inside the cap. Interpretation: this is a real new harness frontier, and retrieval is helping the model distinguish when confidence should rise versus when it should merely stay flat or narrow scope.

## Immediate Next Move

Use the live replay + ranker ablation pair together.

The replay lane tells us where harness-vs-baseline behavior still diverges on live-style traces.
The ablation lane tells us whether those misses come from the production hybrid ranking blend or from everything around it.

On the current corpus, the next strongest harness move is therefore not more hybrid-weight tweaking.
It is to expand live traces and downstream evals so we can measure:

- synthetic retrieval quality
- real user phrasing
- harness-vs-baseline divergence
- future downstream tool-use and task-outcome effects

## Immediate Live-History Bridge

The next concrete bridge from synthetic downstream lanes to real harness history is recovery/confidence episode harvesting.

Code:

- `packages/opencode/src/harness/recovery-confidence-case-extractor.ts`
- `packages/opencode/script/extract-harness-recovery-confidence-cases.ts`
- `packages/opencode/test/harness/recovery-confidence-case-extractor.test.ts`

Useful helper command:

- `bun run benchmark:harness:recovery-confidence:extract`

Extraction rule:

- read `state.json` and `observations.jsonl` from the current harness runtime
- group events by `proposalID`
- classify replay-worthy real episodes into:
  - confidence promotion
  - confidence retry
  - confidence failure
  - timeout retry
  - scope deferral
  - resume after partial progress
  - evidence re-grounding
- emit observability first:
  - observation count
  - proposal group count
  - candidate count
  - by-family counts
  - by-category counts

Why this matters:

- it gives us a repeatable path for promoting real harness behavior into replay fixtures
- it keeps the next frontier grounded in actual confidence/recovery history rather than more invented prompt seams
- it tells us immediately whether a given checkout has enough live history to justify replay work

Current limitation:

- some local checkouts still have no persisted `.opencode/runtime/harness/observations.jsonl`
- when that happens the extractor should return zero candidates cleanly, then become useful as soon as the next live harness run populates those files

## Next Missing Seam: Parallel Tool Calling

Why:

- same-agent parallel reads are often a real speed win
- same-agent parallel edits are usually a safety trap unless the work is truly independent
- mixed tool families like local file reads plus log/grep checks can be good in parallel when both are read-only and ungated

Code:

- `packages/opencode/src/harness/retrieval-parallel-tool-calling-benchmark.ts`
- `packages/opencode/script/benchmark-harness-retrieval-parallel-tool-calling.ts`
- `packages/opencode/test/harness/retrieval-parallel-tool-calling-benchmark.test.ts`

Useful helper command:

- `bun run benchmark:harness:retrieval-parallel-tool-calling`

What this lane measures:

- `parallel_now` for cleanly independent same-agent read fanout
- `parallel_after_context` when one blocker read determines whether later fanout is needed
- `stay_serial` when edits or dependent changes should not be parallelized
- `gather_more_context_first` when scope is still unresolved and any fanout would be premature

Current first read:

- under `HARNESS_BENCH_PROMPT_TIMEOUT_MS=15000` on `alibaba-coding-plan/glm-5`, mixed read/search fanout and serial edit discipline are already visible on the semantic side
- the model still over-parallelizes blocker-read and unresolved-scope cases
- strict accuracy is currently flattened by exact-token drift, so the runner now prints both strict and loose accuracy

Interpretation:

- mixed parallel tool calls are good when they are read-only and genuinely independent
- the harder unsolved seam is knowing when not to parallelize yet
