# Semantic Substrate Invariants

This note records the retrieval substrate rules that are currently implemented in the fork.

It is intentionally narrower than `docs/semantic-substrate-plan.md` and more concrete than `docs/qwen3-retrieval-model-notes.md`.

## Retrieval Identity

- Chunk embeddings are cached by semantic embedding identity, not just by chunk and model name.
- The effective cache identity includes:
  - embedding `indexSpace`
  - embedder provider id
  - embedder model id
  - instruction preset
  - literal instruction
  - requested dimensions
  - output type
- Changing any of those fields must produce a new embedding record instead of silently reusing an older vector.
- Matching dimensions alone are not treated as proof of compatibility.

## Index Spaces

- Each embedding lane is treated as its own index space.
- `fast`, `quality`, and mixed-lane retrieval must not silently share chunk embeddings when their embedding semantics differ.
- Rerankers may operate across candidates gathered from a different retrieval lane, but the underlying chunk embeddings must still respect their own embedding identity.

## Ranking

- Final candidate ordering uses hybrid ranking, not raw reranker score alone.
- Ranking combines:
  - lexical retrieval score
  - rerank score
  - outcome score
  - feedback score
- Feedback and outcome signals are allowed to materially change the final order; they are not limited to tie-breaks.

## Feedback Scope

- Feedback priors are scoped to the active retrieval scope.
- `session_only` searches only inherit feedback from that session.
- `session_family_only` searches only inherit feedback from the supplied family sessions.
- `project_with_family_preference` currently uses the preferred family scope for biasing instead of leaking unrelated project sessions into the prior.
- `project_only` is the only mode that intentionally uses project-wide feedback.

## Provider And Fallback Consistency

- Provider rerank and synthetic fallback rerank go through the same score-shaping path.
- Synthetic cosine similarity normalizes both query and candidate vectors before scoring.
- Endpoint degradation is still a quality concern, but it should no longer arbitrarily switch to a different ranking formula.

## Observability

- Retrieval runs record both requested policy models and observed runtime models.
- Run metadata should surface:
  - query embedding source
  - rerank source
  - observed provider/model ids
  - fallback reason
  - original error when present
  - feedback bias summary
  - feedback bias scope
- User-facing retrieval diagnostics should stay quiet during healthy provider execution and become explicit when the substrate degrades to fallback mode.

## Compaction Baton

- Semantic compaction should accept short queries when they carry real technical or constraint signal.
- Short file names, symbols, identifiers, and terse operational constraints are valid retention queries.
- Short low-signal chatter should still be excluded.
- The compaction baton should optimize for durable constraints and technically meaningful anchors, not conversational filler.

## Verification Anchors

The current invariants are covered most directly by:

- `test/retrieval/adapter.test.ts`
- `test/retrieval/runtime.test.ts`
- `test/retrieval/policy.test.ts`
- `test/tool/recall.test.ts`
- `test/session/compaction.test.ts`
