# Tranche 1 Coordination Audit - 2026-03-29

## Scope

This tranche covers the coordination surface:

- `task`
- `tracker_*`
- `blackboard` / `blackboard_*`
- `todoread` / `todowrite`

## Audit Matrix

| Tool family | Registry status | Prompt training status | Tool-description quality | Focused test coverage | Initial risk read |
| --- | --- | --- | --- | --- | --- |
| `task` | Builtin and core coordination surface via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Strongly taught in [anthropic.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic.txt), [anthropic-20250930.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic-20250930.txt), and indirectly in [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt) / [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) | Strong. [task.txt](C:/Users/HP/repos/opencode/packages/opencode/src/tool/task.txt) clearly explains actions, when not to use it, background launches, and coordination chooser guidance | Strong: [task-description.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-description.test.ts), [task-dependencies.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-dependencies.test.ts), [task-lane.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-lane.test.ts), [task-mailbox-smoke.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-mailbox-smoke.test.ts), [task-provenance.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-provenance.test.ts), [task-wait-settlement.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-wait-settlement.test.ts) | Medium. Large surface; likely failures are more about routing contracts / timeout budgets than missing behavior |
| `tracker_*` | Builtin and registered as a full DAG family via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Moderately taught. Prompts mention tracker as the preferred durable dependency graph, but not the individual verbs | Medium. Individual tool descriptions in [tracker.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/tracker.ts) are clear enough for direct use, but the family could use one higher-level training pass in prompts if models misuse tracker as lightweight todos | Moderate: [tracker.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/tracker.test.ts) and overlap through task/tracker integration tests | Medium. Likely prompt gap more than runtime gap |
| `blackboard` / raw verbs | Builtin and registered as both high-level and raw mutation surfaces via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Good in prompts. `blackboard` is explicitly taught as the shared findings/blockers/ownership tool, with raw verbs reserved for low-level state control | Strong. [blackboard.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/blackboard.ts) has a clean split between high-level coordination moves and raw primitives | Strong: [blackboard.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/blackboard.test.ts) | Low to medium. Main risk is prompt drift if models overuse raw verbs |
| `todoread` / `todowrite` | Builtin and registered via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | Strong in prompts. Todo continuity and “lighter checklist, not graph” guidance is present across Codex, Anthropic, and Gemini prompt files | Mixed. [todo.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/todo.ts) is small and understandable, but the family relies heavily on prompt training rather than rich tool-local guidance | No obvious focused `todo`-named test file in `test/tool/` from the initial scan | Medium. Behavior is simple, but missing direct coverage is a real gap |

## Initial observations

- `task` is the most fully specified coordination tool in both prompt training and tool-local documentation.
- `tracker_*` is positioned correctly in prompts, but the model mostly learns the family as “use tracker for bigger DAG-shaped work” rather than “here is how the verbs fit together.”
- `blackboard` looks healthiest as a training surface because the prompts and tool split are aligned: high-level wrapper first, raw verbs only when needed.
- `todo` is probably under-tested rather than under-designed. The implementation is small, but it should still have focused coverage because it is taught prominently in provider prompts.

## Audit progress

- `task` dependency coverage is now green after tightening the dependency test fixture:
  - switched the dependency suite onto a real model fixture instead of `test/test`
  - explicitly settled or canceled background tasks that were leaking across test cleanup
  - raised the timeout only for the one intentionally slower dependency-status case
- `todo` now has direct focused coverage in [todo.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/todo.test.ts):
  - empty-list reads
  - write/read round-trip
  - root-session scoping across child sessions
  - clearing behavior
  - permission ask path
- `tracker` preview metadata was verified and one stale expectation was corrected:
  - preview metadata now asserts `metadata.tasks` instead of the older `metadata.seededTasks`

## Current tranche status

- Green:
  - [todo.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/todo.test.ts)
  - [tracker.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/tracker.test.ts)
  - [blackboard.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/blackboard.test.ts)
  - [task-description.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-description.test.ts)
  - [task-dependencies.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-dependencies.test.ts)
  - [task-lane.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-lane.test.ts)
  - [task-mailbox-smoke.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-mailbox-smoke.test.ts)
  - [task-provenance.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-provenance.test.ts)
  - [task-wait-settlement.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/task-wait-settlement.test.ts)

## Final tranche note

- Tranche 1 exposed a real runtime race in the `task` wait path: terminal execution-ledger events could resolve waits before `settleTerminalJob()` had finished downstream failure/completion side effects.
- The fix adds a lightweight terminal-settlement guard in [task.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/task.ts) so `wait` does not treat a terminal execution event as fully settled while terminal settlement is still in flight.
- After that change, the previously failing failed-task mailbox case now passes without weakening the assertion.

## Verification plan for this tranche

1. Run focused existing suites:
   - `bun test test/tool/task-description.test.ts test/tool/task-dependencies.test.ts test/tool/task-lane.test.ts test/tool/task-mailbox-smoke.test.ts test/tool/task-provenance.test.ts test/tool/task-wait-settlement.test.ts`
   - `bun test test/tool/tracker.test.ts`
   - `bun test test/tool/blackboard.test.ts`
2. If green, add direct focused `todo` tests for:
   - write/read round-trip
   - overwrite behavior
   - empty list handling
   - permission ask path
3. If any suite fails:
   - fix real runtime bugs first
   - then fix stale expectations
   - only then adjust prompts if the failure exposes training drift rather than implementation issues

## Expected outputs of this tranche

- one clean status on the coordination tool family
- direct `todo` coverage if the current gap is confirmed
- any prompt refinements needed for tracker-vs-todo or blackboard wrapper-vs-raw usage
