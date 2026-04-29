# Semantic Substrate Plan

We should treat embeddings + reranking as a harness substrate, not a side feature.

If we do it right, it upgrades memory, context efficiency, planning, routing, recovery, and overall effective intelligence.

## MVP Shape

- local retrieval service inside the fork
- dual Qwen3 model-set support
- explicit `recall` tool first
- hybrid retrieval: metadata/text prefilter -> embedding search -> rerank
- tiny prompt baton, never giant chunk dumps
- full observability in DB

## Model Policy

- `fast` -> `Qwen3-Embedding-0.6B` + `Qwen3-Reranker-0.6B`
- `quality` -> `Qwen3-Embedding-4B-GGUF` + `Qwen3-Reranker-4B-GGUF`
- `auto` -> `Qwen3-Embedding-0.6B` + `Qwen3-Reranker-0.6B` on 6 GB laptop GPUs
- `fallback` -> degrade gracefully if preferred lane fails

Design rule:

- use matched embedder/reranker pairs when possible
- treat each embedding model size as its own index space
- do not query a `fast` index with a `quality` embedder, or the reverse
- keep batch settings tunable
- store which policy and concrete models were used for every retrieval run

## Schema

I would start with the exact family you proposed.

- `retrieval_document`
  - canonical source unit: session message, assistant output, diff, skill load, doc, task artifact, curated code slice
- `retrieval_chunk`
  - chunk text, offsets, chunk kind, source subtype, fingerprint
- `retrieval_embedding`
  - vector metadata, model id, dimensions, embedding hash/version
- `retrieval_run`
  - query text, policy, selected models, latency, prefilter counts, rerank counts, final picks
- `retrieval_feedback`
  - explicit and implicit outcomes: useful, ignored, misleading, successful follow-through, dead end
- `retrieval_policy`
  - current routing/config snapshot for `fast`/`quality`/`auto`/`fallback`

Extra fields I would strongly add:

- `outcome_score`
- `negative_signal`
- `success_count`
- `failure_count`
- `last_used_at`
- `provenance_json`

## Initial Corpora

Do not naively index the entire repo first.

Start with:

- session user text
- assistant final outputs
- tool failures
- diffs and patches
- task/workgraph summaries
- loaded skills
- repo docs / notes / design docs
- selected high-value code slices

Later:

- curated symbol-level code chunks
- task episode memory
- cross-session decision memory
- negative memory shards

## Retrieval Pipeline

1. normalize query
2. metadata prefilter
   - project/session/tool/error/type/source/date constraints
3. lexical cheap pass
   - fingerprints, exact ids, file names, symbols, keywords
4. embedding candidate search
5. rerank top N with matched reranker
6. outcome weighting
7. compress to baton
8. log everything in `retrieval_run`

## Prompt Baton

Inject only tiny structured memory.

Good baton:

- prior decision
- similar failure and fix
- relevant file/module
- successful task pattern
- warning about similar wrong path

Bad baton:

- raw top-10 chunks
- giant transcript dumps
- unscreened code blobs

So prompt injection should look like:

- max 1-4 retrieved items
- each item 1-3 lines
- confidence gated
- only before prompt assembly when retrieval is actually useful

## Best Insertion Points

- before prompt assembly in `packages/opencode/src/session/prompt.ts`
- during task/subagent planning in `packages/opencode/src/tool/task.ts` or adjacent planner flow
- during recovery after interruption/failure
- during compaction scoring so semantically central facts survive

## Service Layout

I would place it near session/storage infra.

Suggested modules:

- `packages/opencode/src/retrieval/service.ts`
- `packages/opencode/src/retrieval/indexer.ts`
- `packages/opencode/src/retrieval/chunker.ts`
- `packages/opencode/src/retrieval/policy.ts`
- `packages/opencode/src/retrieval/search.ts`
- `packages/opencode/src/retrieval/rerank.ts`
- `packages/opencode/src/retrieval/baton.ts`
- `packages/opencode/src/retrieval/providers/*`
- SQL defs near `packages/opencode/src/session/session.sql.ts`
- DB wiring near `packages/opencode/src/storage/db.ts`

## First-Class Tools

Phase 2 tools:

- `recall`
- `index_status`
- `index_refresh`
- `related_sessions`
- `related_failures`
- `related_files`

Important rule:

- retrieval should be intentional and inspectable
- the model asks for it or the harness explicitly decides to use it and records why

## Where We Get Real Intelligence Gains

This is where the harness starts becoming unusual.

- `planning memory`
  - retrieve similar successful decompositions before spawning workers
- `failure recovery`
  - surface analogous stuck states and recoveries
- `context compaction`
  - preserve semantically central facts, constraints, and unresolved blockers rather than summarizing chronologically
- `tool routing`
  - suggest tools based on similar successful prior episodes
- `model routing`
  - select model lane from similar successful task patterns
- `negative memory`
  - warn about prior attractive but wrong approaches
- `outcome-weighted memory`
  - successful memories rank up; reverted/dead-end memories rank down

## High-Upside Experiments

After observability is solid:

- semantic workgraph embeddings
- agent memory shards per subagent type
- cross-session latent baton at session start
- retrieval-conditioned steer behavior
- semantic interruption recovery
- automatic best next tool/model/subagent recommendations

## Implementation Order

1. schema + retrieval service
2. explicit `recall` tool
3. dual model-set config + policy switching
4. hybrid retrieval + dedicated reranker
5. tiny prompt baton injection
6. task/subagent memory retrieval
7. outcome-weighted ranking
8. adaptive routing
9. weird/god-tier experiments

## What I Would Build First

If we want the strongest MVP with minimal chaos:

- retrieval schema
- local indexer for session text, failures, diffs, docs
- policy-configured dual model support
- `recall` tool
- reranker-backed retrieval
- compact baton injection before prompt assembly

## Harness Friction To Keep Watching

While building this, keep an eye on:

- task lifecycle follow-up reliability
- subagent type/model flexibility
- compaction provenance continuity
- test harness stability around orchestration flows
