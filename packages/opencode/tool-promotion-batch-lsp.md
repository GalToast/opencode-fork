# Batch and LSP Promotion Criteria

## Goal

Define and track the evidence needed to promote `batch` and `lsp` from flagged expert surfaces to broadly exposed builtin tools.

## Current status

### `batch`

What is now true:

- direct contract coverage exists in [batch.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/batch.test.ts)
- nested batch calls are rejected
- multiple mutation tools in a single batch are rejected
- same-target mutate-plus-inspect batches are rejected

Why this is still not promotion-ready:

- prompt teaching is still minimal to nonexistent
- the guardrails catch only obvious ordering hazards, not all stateful dependency mistakes
- there is still no model-choice evidence showing that default exposure improves outcomes more than it increases misuse

### `lsp`

What is now true:

- direct contract coverage exists in [lsp.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/lsp.test.ts)
- permission gating is pinned
- unavailable-server and empty-result paths now include actionable fallback guidance

Why this is still not promotion-ready:

- real usefulness still depends on local server availability and filetype configuration
- prompt teaching is still light
- we do not yet have confidence data for the common environments where users would expect it to work

## Promotion checklist

Promotion should require all of the following.

### 1. Product guardrails

#### `batch`

- keep the current multiple-mutation rejection unless a stronger sequencing model is implemented
- add at least one more guard for broad stateful categories if misuse shows up in practice
- preserve fast-path behavior for independent read-only batches

#### `lsp`

- preserve clear fallback guidance on no-server and no-result paths
- make sure unsupported environments fail with a useful next move, not only a raw availability error

### 2. Focused test evidence

#### `batch`

- direct suite proves safe rejection of obvious dependent batches
- direct suite proves healthy behavior for independent read-only batches
- any future relaxation of guardrails must come with replacement tests

#### `lsp`

- direct suite proves permission gate, success path, and graceful fallback
- at least one additional environment-facing slice should validate common filetype/server readiness behavior

Status:

- done with [index.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/lsp/index.test.ts) plus [lsp.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/lsp.test.ts)

### 3. Prompt-layer readiness

- top-level provider prompts should teach when `batch` is appropriate and when it is not
- top-level provider prompts should frame `lsp` as optional code-intelligence help, not as a guaranteed baseline capability
- prompt text should mention the preferred fallbacks for `lsp`

Status:

- done for the current live prompt surfaces in [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt), [anthropic.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic.txt), [anthropic-20250930.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic-20250930.txt), and [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt)
- pinned by [system-prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/system-prompt.test.ts)

### 4. Adversarial proof

- run a small prompt-routing sweep with intentionally tricky cases:
  - dependent mutation batches
  - same-target read-after-edit requests
  - `lsp` requests on unsupported filetypes
  - `lsp` requests where `structural_read` or `grep` would be the better choice
- promotion should wait until the models choose the right surface reliably enough without hand-holding

Status:

- the harness now includes direct adversarial `batch` / `lsp` routing scenarios in [prompt-tuning-benchmark.ts](C:/Users/HP/repos/opencode/packages/opencode/src/harness/prompt-tuning-benchmark.ts), pinned by [prompt-tuning-benchmark.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/harness/prompt-tuning-benchmark.test.ts)
- live non-OpenAI prompt-benchmark runs now show the targeted routing behavior on tested models:
  - `glm-5`: 12/12 strict, including 6/6 `tool_selection`
  - `kimi-k2.5`: 12/12 strict, including 6/6 `tool_selection`
  - `big-pickle`: 12/12 strict, including 6/6 `tool_selection`
  - `MiniMax-M2.5`: 11/12 strict overall, but still 6/6 `tool_selection`; the only miss was the unrelated `response_contract_exact_enum` case
  - `qwen3.5-plus`: 12/12 strict in isolated rerun, including 6/6 `tool_selection`
- the earlier sqlite contention fault line was in the Mecha/codegraph kv store, not in prompt routing. [sqlite-kv.ts](C:/Users/HP/repos/opencode/packages/opencode/src/mecha/sqlite-kv.ts) now enables WAL plus `busy_timeout`, pinned by [sqlite-kv.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/mecha/sqlite-kv.test.ts)
- post-fix parallel rerun no longer crashed with `database is locked`; `qwen3.5-plus` still showed one unrelated `execution_discipline` miss in that concurrent run, but it stayed 6/6 on `tool_selection`

## Recommendation

Current recommendation:

- `batch`: promoted in [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts)
- `lsp`: promoted in [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts)

If the bar is "no meaningful caveats before flipping flags in [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts)", the remaining caveat is no longer storage instability; it is only whether unrelated benchmark-category variance should block a tool-selection promotion decision.

Next promotion-oriented work:

1. Watch for real misuse now that both tools are exposed by default, especially stateful `batch` requests and environment-dependent `lsp` expectations.
2. If desired, tighten the unrelated `execution_discipline` / `response_contract` prompt-benchmark cases separately; they are no longer the blocker for these two tools.

## Promotion outcome

- builtin registry now exposes both tools by default in [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts)
- default exposure is pinned by [registry.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/registry.test.ts)
- behavior and fallback contracts remain covered by [batch.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/batch.test.ts), [lsp.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/lsp.test.ts), and [index.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/lsp/index.test.ts)
