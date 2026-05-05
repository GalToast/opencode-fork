# Semantic Substrate Checklist

This turns `docs/semantic-substrate-plan.md` into a concrete execution checklist.

## Phase 1: Foundation

- [ ] Add retrieval tables:
  - [ ] `retrieval_document`
  - [ ] `retrieval_chunk`
  - [ ] `retrieval_embedding`
  - [ ] `retrieval_run`
  - [ ] `retrieval_feedback`
  - [ ] `retrieval_policy`
- [ ] Add DB wiring near `packages/opencode/src/storage/db.ts`
- [ ] Add SQL definitions near `packages/opencode/src/session/session.sql.ts`
- [ ] Add retrieval service module under `packages/opencode/src/retrieval/`
- [ ] Add chunker, indexer, search, rerank, baton, and policy modules
- [ ] Add policy config for:
  - [ ] `fast`
  - [ ] `quality`
  - [ ] `auto`
  - [ ] `fallback`
- [ ] Record model ids, instruction presets, vector dimensions, and provenance in `retrieval_run`

## Phase 2: Explicit Capability

- [ ] Add `recall` tool
- [ ] Add `index_status` tool
- [ ] Add `index_refresh` tool
- [ ] Add `related_sessions` tool
- [ ] Add `related_failures` tool
- [ ] Add `related_files` tool
- [ ] Register tools in `packages/opencode/src/tool/registry.ts`

## Phase 3: First Corpora

- [ ] Index session user messages
- [ ] Index assistant final outputs
- [ ] Index tool failures
- [ ] Index diffs and patches
- [ ] Index task/workgraph summaries
- [ ] Index loaded skills
- [ ] Index repo docs and notes
- [ ] Index curated code slices
- [ ] Avoid full naive codebase indexing initially

## Phase 4: Prompt Baton

- [ ] Add retrieval usefulness detector before prompt assembly
- [ ] Add retrieval hook near `packages/opencode/src/session/prompt.ts`
- [ ] Use prefilter -> embed search -> rerank -> baton
- [ ] Inject max 1-4 baton items only
- [ ] Keep baton formats compact:
  - [ ] prior decision
  - [ ] similar failure and fix
  - [ ] relevant file/module
  - [ ] successful task pattern

## Phase 5: Planning And Recovery

- [ ] Add retrieval hooks during task/subagent planning
- [ ] Add retrieval hooks during failure/interruption recovery
- [ ] Add task-episode memory support
- [ ] Add outcome weighting inputs from successful vs failed runs

## Phase 6: Adaptive Intelligence

- [ ] Model routing by prior successful analogs
- [ ] Tool routing by prior successful analogs
- [ ] Subagent specialization hints from retrieval
- [ ] Semantically aware compaction
- [ ] Memory resurfacing after stalls
- [ ] Negative-memory support for similar-but-wrong paths

## Phase 7: Measurement

- [ ] Log retrieval latency and candidate counts
- [ ] Log prefilter, embedding, rerank, and baton stages
- [ ] Record explicit/implicit feedback
- [ ] Track success/failure/revert associations
- [ ] Compare `0.6B` vs `4B` lanes
- [ ] Compare instruction presets
- [ ] Compare vector sizes if supported

## Qwen3-Specific Work

- [ ] Confirm local runtime support for `Qwen3-Embedding-4B-GGUF`
- [ ] Confirm local runtime support for `Qwen3-Reranker-4B-GGUF`
- [ ] Confirm local runtime support for `Qwen3-Embedding-0.6B`
- [ ] Confirm local runtime support for `Qwen3-Reranker-0.6B`
- [ ] Expose instruction presets for embedding and reranking
- [ ] Expose output/vector-size settings if supported
- [ ] Store actual vector dimensions in `retrieval_embedding`

## Friction Watch

- [ ] Watch task lifecycle reliability during long retrieval-related work
- [ ] Watch subagent type/model flexibility
- [ ] Watch compaction provenance continuity
- [ ] Watch test-harness stability around orchestration flows
