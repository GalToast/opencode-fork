# Qwen3 Retrieval Model Notes

This note captures what we know so far about the Qwen3 embedding and reranking models we want to wire into the harness.

## Confirmed Direction

- Qwen publishes an official `Qwen/Qwen3-Embedding-4B-GGUF` model on Hugging Face.
- The Qwen3 embedding/ranking family spans at least `0.6B`, `4B`, and `8B` sizes.
- The family is positioned for embedding and ranking/reranking tasks, including multilingual retrieval, cross-lingual retrieval, and code retrieval.
- We also found GGUF reranker conversions for the sizes we care about:
  - `Qwen3-Reranker-4B-GGUF`
  - `Qwen3-Reranker-0.6B-GGUF`
- We also confirmed the plain non-GGUF `Qwen/Qwen3-Embedding-0.6B` card exists, which is useful for specs and baseline behavior even if the harness runs GGUF locally.

## Why This Family Fits The Harness

- The size ladder is ideal for policy-driven retrieval:
  - `fast` -> `0.6B`
  - `quality` -> `4B`
- The family appears intentionally retrieval-oriented rather than generic text-generation repurposed as retrieval.
- The code-retrieval and multilingual emphasis is a strong fit for:
  - session memory
  - tool failures
  - diffs and patches
  - docs and notes
  - loaded skills
  - curated code slices

## Important Capability Notes

These models are attractive partly because they appear to support behavior shaping that is useful for harness retrieval.

### 1. Instruction-Tunable Behavior

- Qwen model cards/snippets indicate the embedding and reranking models support user-defined instructions.
- That means we should not treat them as fixed black boxes.
- We should expose prompt templates per retrieval workload, for example:
  - semantic recall of prior decisions
  - failure similarity search
  - code-fragment retrieval
  - task-pattern retrieval
  - doc lookup

Practical implication:

- Retrieval policy should store not just `model_id`, but also the instruction preset used.
- Different corpora may want different instructions even on the same model.

### 2. Output Size / Vector Definition Control

- The Qwen embedding cards mention flexible vector definitions across dimensions.
- We need to verify exact runtime support in the local stack we choose, but this is strategically important.

Why it matters:

- smaller vectors may reduce DB size, memory pressure, and search cost
- larger vectors may improve quality for harder retrieval workloads
- the harness can potentially choose vector size by policy rather than hard-coding one shape forever

Practical implication:

- `retrieval_policy` should include the requested output/vector dimensionality when available
- `retrieval_embedding` should record actual dimension count, not assume a global fixed dimension forever

### 3. Reranker Prompting Matters

- The reranker should not be treated as a dumb score-only box.
- If instructions are supported, we can tune reranking criteria toward harness objectives such as:
  - prior successful fix
  - likely relevant code module
  - similar failure and recovery
  - semantically central fact for prompt baton

Practical implication:

- reranker prompt presets should be explicit, versioned, and observable in `retrieval_run`

## Recommended Retrieval Policy Mapping

- `fast`
  - embedder: `Qwen3-Embedding-0.6B`
  - reranker: `Qwen3-Reranker-0.6B`
  - use for low-latency recall, broad task planning, and cheap background indexing
- `quality`
  - embedder: `Qwen3-Embedding-4B-GGUF`
  - reranker: `Qwen3-Reranker-4B-GGUF`
  - use for prompt baton selection, hard failure recovery, and final top-k reranking
- `auto`
  - embedder: `Qwen3-Embedding-0.6B`
  - reranker: `Qwen3-Reranker-0.6B`
  - use as the default matched lane on 6 GB laptop GPUs: keep always-on retrieval cheap and stable
- `fallback`
  - degrade from `4B` to `0.6B` cleanly rather than failing retrieval entirely

## Index Space Rule

- Treat each Qwen3 embedding size as its own index space.
- Do not embed a corpus with `0.6B` and query it with `4B`, or the reverse.
- Matching dimensions are not enough to prove compatibility, and these models do not even share the same default dimensions.
- The safe operational rule is simple:
  - `fast` index -> query with `fast` embedder
  - `quality` index -> query with `quality` embedder
  - rerankers may still operate on candidates from either lane

## Hardware-Aware Default

- On this laptop-class profile, CUDA should be the default local runtime.
- A single `4B` Qwen retrieval service is viable on the RTX 4050 laptop GPU.
- Keeping both `4B` embedding and `4B` reranking services hot at the same time is likely too expensive or brittle on a 6 GB VRAM envelope.
- That makes the matched `0.6B` lane the best default:
  - retrieve with `0.6B`
  - rerank with `0.6B`

## Harness Design Consequences

We should build the retrieval layer assuming model behavior is policy-shaped, not static.

That means the harness should store:

- embedder model id
- reranker model id
- instruction preset id or literal instruction
- vector dimension/output-size setting if used
- chunking strategy version
- ranking policy version
- latency and failure details

This makes retrieval observable and lets us compare:

- `0.6B` vs `4B`
- different instruction presets
- different vector sizes
- different reranking prompts
- different baton compression rules

## Suggested Preset Families

Initial instruction presets we should support:

- `memory.decision`
  - retrieve prior decisions, constraints, and preferences
- `memory.failure`
  - retrieve similar failures, regressions, and recoveries
- `memory.task_pattern`
  - retrieve similar work episodes and successful decompositions
- `memory.file`
  - retrieve likely relevant docs/files/modules
- `memory.code`
  - retrieve curated code slices and symbol-adjacent chunks
- `memory.compaction`
  - score semantically central facts for retention during compaction

## Open Questions To Verify

- exact local runtime path for the GGUF rerankers we want to use
- exact output-dimension controls exposed by the local inference stack
- best instruction wording for:
  - code retrieval
  - task-pattern retrieval
  - failure recovery retrieval
- best vector size tradeoff for:
  - session text
  - docs
  - diffs
  - code slices
- whether reranker throughput is good enough for default `quality` baton selection on every turn

## Immediate Implementation Guidance

- Do not hard-code a single vector dimension if the model/runtime can vary it.
- Do not hide instruction prompts inside ad hoc code paths; make them policy/config driven.
- Do not only store final scores; log the instruction preset and model pair used for each retrieval run.
- Start with explicit retrieval and observable policy switching before spreading the semantic layer everywhere.
