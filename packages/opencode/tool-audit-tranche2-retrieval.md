# Tranche 2 Retrieval Audit - 2026-03-29

## Scope

This tranche covers the retrieval/context surface:

- `read`
- `grep`
- `structural_read`
- `codetree`
- `dependency_explorer`
- `recall`
- `retrieval_status`

## Audit Matrix

| Tool family | Registry status | Prompt training status | Tool-description quality | Focused test coverage | Initial risk read |
| --- | --- | --- | --- | --- | --- |
| `read` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Strong in [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt), [anthropic.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic.txt), [anthropic-20250930.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic-20250930.txt), and [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) | Strong. [read.txt](C:/Users/HP/repos/opencode/packages/opencode/src/tool/read.txt) explains exact-file fit, offsets, directory paging, attachments, and when to prefer `grep`, `glob`, or `list` | Strong: [read.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/read.test.ts) and [read-offset.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/read-offset.test.ts) | Medium. Broad surface with attachments, offsets, permission checks, and LSP warm-up side effects |
| `grep` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Strong. Taught as the normal content-search path in the major provider prompts | Strong. [grep.txt](C:/Users/HP/repos/opencode/packages/opencode/src/tool/grep.txt) covers when to use it, Windows preference, and when Task is the better open-ended search lane | Strong: [grep.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/grep.test.ts) and [grep-sorting.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/grep-sorting.test.ts) | Low to medium. Main risk is truncation/sorting behavior drifting from what prompts imply |
| `structural_read` | Builtin indirectly through [mecha.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/mecha.ts) and present in [registry.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/registry.test.ts) | Good in provider prompts (`anthropic*`, `gemini`), but not emphasized in the Codex header the way `codetree` is | Medium. The description in [mecha.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/mecha.ts) is clear, but it lives inside a bundled tool file and had no direct focused tests before this tranche | Direct coverage added in [structural-read.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/structural-read.test.ts) | Medium. High training importance with previously missing direct contract coverage |
| `codetree` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Strong in [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt); lighter explicit provider-prompt reinforcement than `structural_read` | Medium to strong. Inline description in [codetree.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/codetree.ts) is concise and task-shaped | Direct coverage in [codetree.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/codetree.test.ts) | Low to medium. Small surface, but prompt emphasis is slightly asymmetric across provider families |
| `dependency_explorer` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Prompt-light. It is better represented in role preferences than in top-level provider guidance | Medium. Inline description in [dependency_explorer.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/dependency_explorer.ts) explains the actions, but examples and routing guidance are sparse | Direct coverage in [dependency_explorer.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/dependency_explorer.test.ts) | Medium. Useful tool with modest training and a tendency for test pollution when mocked too broadly |
| `recall` / `retrieval_status` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Strong in [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt), [anthropic.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic.txt), [anthropic-20250930.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic-20250930.txt), and [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) | Strong. [recall.txt](C:/Users/HP/repos/opencode/packages/opencode/src/tool/recall.txt) and [retrieval_status.txt](C:/Users/HP/repos/opencode/packages/opencode/src/tool/retrieval_status.txt) clearly separate semantic recall from diagnostics/status inspection | Strong: [recall.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/recall.test.ts) plus prompt-contract coverage in [system-prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/system-prompt.test.ts) | Medium. Retrieval itself is healthy, but mixed-suite runs can be invalidated by unrelated test-time LSP mocking if isolation is careless |

## Initial observations

- `read` and `grep` are the healthiest retrieval-era basics: they are strongly taught, well documented, and have direct focused tests.
- The structural survey story is split across two tools:
  - `codetree` is the most explicitly taught in the Codex header.
  - `structural_read` is the most explicitly taught in provider prompts.
- `dependency_explorer` is useful but under-taught relative to its value; agents are more likely to learn it through role metadata than through top-level prompt routing.
- `recall` and `retrieval_status` already had strong focused coverage and the prompt layer is aligned with the current intended routing.

## Audit progress

- `read` is now hardened against partial LSP surfaces in [read.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/read.ts):
  - LSP warm-up is best-effort instead of unconditional
  - this removes a real crash path during tests and in partial/mock runtimes
- `structural_read` now uses the same best-effort LSP warm-up discipline in [structural-read.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/structural-read.ts).
- `dependency_explorer` focused coverage was corrected in [dependency_explorer.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/dependency_explorer.test.ts):
  - the test now spies only on `LSP.workspaceSymbol(...)`
  - it no longer replaces the entire LSP module and poisons later retrieval/plugin tests
- Direct `structural_read` coverage was added in [structural-read.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/structural-read.test.ts):
  - outline mode from document symbols
  - clean fallback when `touchFile` is unavailable
- The env-permission matrix in [read.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/read.test.ts) now has an explicit timeout budget so Windows startup jitter does not create false negatives.

## Current tranche status

- Green:
  - [read.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/read.test.ts)
  - [read-offset.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/read-offset.test.ts)
  - [grep.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/grep.test.ts)
  - [grep-sorting.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/grep-sorting.test.ts)
  - [codetree.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/codetree.test.ts)
  - [dependency_explorer.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/dependency_explorer.test.ts)
  - [structural-read.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/structural-read.test.ts)
  - [recall.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/recall.test.ts)
  - [system-prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/system-prompt.test.ts)
  - targeted registry presence check for `structural_read` in [registry.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/registry.test.ts)

## Final tranche note

- Tranche 2 exposed one real runtime issue and one real test-contract issue:
  - Runtime: `read` assumed `LSP.touchFile(...)` always existed, which is not true in partial or mocked LSP surfaces.
  - Test contract: `dependency_explorer.test.ts` mocked the whole LSP module, which polluted later `recall` runs and produced false retrieval failures.
- Both are now fixed without weakening the actual tool contracts.
- No provider prompt changes were necessary in this tranche; the remaining prompt issue is emphasis balance, not outright drift.

## Residual risks

- `structural_read` and `codetree` still overlap conceptually, and the prompt layer does not teach that relationship consistently across provider families.
- `dependency_explorer` is still underrepresented in top-level tool-routing guidance compared with how useful it is for cross-file exploration.
- Some registry/custom-tool tests remain timeout-sensitive on this Windows environment, but that is adjacent to this tranche rather than a retrieval-surface runtime bug.

## Verification commands used

1. `bun test test/tool/read.test.ts test/tool/read-offset.test.ts test/tool/grep.test.ts test/tool/grep-sorting.test.ts test/tool/codetree.test.ts test/tool/dependency_explorer.test.ts test/tool/structural-read.test.ts test/tool/recall.test.ts test/session/system-prompt.test.ts`
2. `bun test test/tool/registry.test.ts -t "includes tracker tools in the builtin registry"`
