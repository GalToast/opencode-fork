# Tranche 3 Mutation Audit - 2026-03-29

## Scope

This tranche covers the mutation surface:

- `write`
- `edit`
- `multiedit`
- `search_replace`
- `apply_patch`

## Audit Matrix

| Tool family | Registry status | Prompt training status | Tool-description quality | Focused test coverage | Initial risk read |
| --- | --- | --- | --- | --- | --- |
| `write` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Strong in [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt) and [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt); implicitly aligned with provider prompts that teach edit-vs-create routing | Strong in [write.txt](C:/Users/HP/repos/opencode/packages/opencode/src/tool/write.txt): overwrite behavior, read-before-overwrite rule, and new-file discipline are explicit | Strong in [write.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/write.test.ts) | Medium. High-frequency tool with overwrite semantics, FileTime constraints, and LSP side effects |
| `edit` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Strong in [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt), [anthropic.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic.txt), [anthropic-20250930.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic-20250930.txt), and [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) | Strong in [edit.txt](C:/Users/HP/repos/opencode/packages/opencode/src/tool/edit.txt): read-first requirement, exact-match failure modes, and `replaceAll` guidance are clear | Strong in [edit.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/edit.test.ts) | Medium. Broad replacement heuristics plus FileTime and diagnostics behavior make it easy for stale tests to hide regressions |
| `multiedit` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Good. Explicitly taught in [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt), [anthropic.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic.txt), [anthropic-20250930.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic-20250930.txt), and [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) as the preferred same-file batch edit path | Medium to strong in [multiedit.txt](C:/Users/HP/repos/opencode/packages/opencode/src/tool/multiedit.txt), but it initially overpromised atomicity relative to the implementation | Direct coverage added in [multiedit.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/multiedit.test.ts) | High before the fix. The contract claimed atomic sequential edits, but the old implementation committed partial changes through repeated `edit` calls |
| `search_replace` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Good in [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt); prompt emphasis is lighter in the provider-specific files | Medium. [search_replace.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/search_replace.ts) has a solid inline description, but it is terser than the `.txt`-backed tools and leaves more judgment to prompt training | Direct coverage in [search_replace.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/search_replace.test.ts) | Medium. Bulk regex mutation is powerful, but contract coverage was still fairly narrow before this pass |
| `apply_patch` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Strong in [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt); prompt layer correctly frames it as the preferred single-file patch editor | Strong in [apply_patch.txt](C:/Users/HP/repos/opencode/packages/opencode/src/tool/apply_patch.txt): patch envelope, headers, and plus-line requirements are explicit | Strong in [apply_patch.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/apply_patch.test.ts) | Medium. Rich parser/verification surface with Windows timing sensitivity and post-apply LSP hooks |

## Initial observations

- The mutation prompts were mostly already aligned with the intended routing:
  - prefer `apply_patch` for normal single-file patch edits
  - prefer `multiedit` over repeated `edit` calls in the same file
  - prefer `search_replace` for broad refactors
- The main hidden risk was not prompt drift. It was contract drift inside `multiedit`, where the description promised atomic edits but the implementation delegated to repeated `edit` executions and could leave partial writes behind.
- `write` and `apply_patch` had the same partial-LSP fragility pattern we already fixed in other tranches: both assumed the full LSP surface existed after mutation.

## Audit progress

- `multiedit` is now truly atomic in [multiedit.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/multiedit.ts):
  - all replacements are applied in-memory first
  - permission is requested once against the aggregate diff
  - the file is written once
  - if any replacement fails, nothing is committed
- `multiedit` now emits mutation metadata in the same family shape as the other mutation tools:
  - file diff stats
  - diagnostics
  - mutation summary
- `write` is now hardened in [write.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/write.ts):
  - `LSP.touchFile(...)` is best-effort
  - diagnostics collection falls back cleanly when the LSP surface is partial or mocked
- `apply_patch` now uses the same best-effort LSP discipline in [apply_patch.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/apply_patch.ts).
- Direct focused coverage was added or expanded:
  - [multiedit.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/multiedit.test.ts) now covers sequential same-file edits and rollback on later failure
  - [write.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/write.test.ts) now covers partial-LSP resilience
  - [apply_patch.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/apply_patch.test.ts) now covers partial-LSP resilience
- Two existing Windows-sensitive tests were given explicit budgets instead of weaker assertions:
  - [edit.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/edit.test.ts)
  - [apply_patch.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/apply_patch.test.ts)

## Current tranche status

- Green:
  - [multiedit.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/multiedit.test.ts)
  - [write.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/write.test.ts)
  - [edit.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/edit.test.ts)
  - [search_replace.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/search_replace.test.ts)
  - [apply_patch.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/apply_patch.test.ts)
  - [system-prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/system-prompt.test.ts)

## Final tranche note

- Tranche 3 exposed one real product bug and one recurring resilience gap:
  - Product bug: `multiedit` was not atomic despite teaching models that it was.
  - Resilience gap: `write` and `apply_patch` still assumed a complete LSP surface after mutation.
- Both are now fixed without weakening the mutation contracts or watering down the focused assertions.
- No prompt text changes were needed in this tranche; the prompt layer was already teaching the intended routing closely enough.

## Residual risks

- `search_replace` still has lighter focused coverage than the other mutation tools relative to how destructive a broad regex refactor can be.
- `multiedit` now behaves atomically, but its title/output shape is still closer to `edit` than to a richer batch-operation report; that is acceptable for now, but could be revisited if the UI starts depending on more batch-specific metadata.
- A few mutation tests remain slow enough on this Windows environment that they need explicit timeout budgets to avoid false negatives during heavier slices.

## Verification commands used

1. `bun test test/tool/write.test.ts test/tool/edit.test.ts test/tool/search_replace.test.ts test/tool/apply_patch.test.ts test/session/system-prompt.test.ts`
2. `bun test test/tool/multiedit.test.ts test/tool/write.test.ts test/tool/edit.test.ts test/tool/search_replace.test.ts test/tool/apply_patch.test.ts test/session/system-prompt.test.ts`
