# Tranche 4 Planning Memory Capability Audit - 2026-03-29

## Scope

This tranche covers the planning and lightweight memory-routing surface:

- `plan`
- `capability`
- `skill`
- prompt/system glue that teaches when those tools should be used instead of direct execution

## Audit Matrix

| Tool family | Registry status | Capability gating | Prompt training status | Tool-description quality | Focused test coverage | Initial risk read |
| --- | --- | --- | --- | --- | --- | --- |
| `plan` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts), implemented as the multi-tool family in [plan.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/plan.ts) | Mixed. Legacy capability-family coverage exists for `question`, `enter_plan_mode`, and `exit_plan_mode` in [runtime.ts](C:/Users/HP/repos/opencode/packages/opencode/src/capability/runtime.ts), while the newer topology and execution-brief tools are registered separately | Mixed but mostly acceptable. [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt) stays execution-first, while [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) is still noticeably more plan-forward than the other provider prompts | Strong in [plan.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/plan.ts), with explicit lifecycle and artifact language for each planning primitive | Strong in [plan.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/plan.test.ts) | Medium. Large surface, multiple planning modes, and prompt divergence create over-planning risk even with green tests |
| `capability` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts), implemented in [capability.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/capability.ts) | Core-visible through [runtime.ts](C:/Users/HP/repos/opencode/packages/opencode/src/capability/runtime.ts); no expansion needed to use the tool itself | Strong in [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt), [anthropic.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic.txt), [anthropic-20250930.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic-20250930.txt), and [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) | Strong in [capability.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/capability.ts): use-when-missing, scope semantics, and non-goals are spelled out clearly | Direct coverage in [capability.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/capability.test.ts) | Medium before this pass. Scope semantics around turn-vs-session behavior were under-tested and hiding a real masking bug |
| `skill` | Builtin via [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts), implemented in [skill.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/skill.ts) | Core-visible as a tool; the separate `skills` prompt-context family only controls DAG-linked skill references, not direct skill loading | Mixed. The tool description is strong, and prompt injection coverage exists in [prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/prompt.test.ts), but top-level provider prompts teach skill usage less directly than capability usage | Strong in [skill.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/skill.ts): discovery, query-first usage, loaded content contract, and “check for an obvious skill before planning from scratch” are all explicit | Good direct coverage in [skill.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/skill.test.ts) plus routing coverage in [skill-routing.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/skill-routing.test.ts) | Medium. Runtime is fairly healthy, but a lot of the important contract lived in description text or indirect prompt tests before this pass |

## Initial observations

- `plan` was not the tranche's runtime problem. Its focused tests were already strong, and the implementation matched its intended lifecycle well enough for this pass.
- `capability` had the clearest hidden contract gap:
  - `scope="turn"` is documented as a temporary change for the current turn
  - but `action="disable"` did not actually mask session-enabled capabilities during that turn
- `skill` was mostly healthy in implementation, but it lacked a direct regression proving the tracker/DAG promise:
  - create task with `requiredSkills`
  - load skill in the same session
  - task automatically unblocks
- Prompt drift exists, but it is nuanced:
  - the provider prompts consistently teach restraint for `capability`
  - `skill` is taught more by the tool description and prompt injection surfaces than by top-level provider routing bullets
  - [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) still carries more planning pressure than the other providers, especially in its plan/propose/approval language

## Audit progress

- Fixed a real turn-scoped masking bug in [runtime.ts](C:/Users/HP/repos/opencode/packages/opencode/src/capability/runtime.ts):
  - turn-scoped `disable` now temporarily masks session-enabled tools, MCP access, and prompt-context families instead of acting like a no-op against session state
  - turn-scoped `reset` now cleanly restores the underlying session-visible surface after that temporary mask is removed
- Tightened capability inspection fidelity in [capability.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/capability.ts):
  - `list` now reports the visible current capability surface instead of leaking hidden-but-connected browser MCP clients into the inspectable/sample output
- Expanded direct contract coverage in [capability.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/capability.test.ts):
  - turn-scoped disable masks a session-enabled client
  - turn reset restores the client
  - `list` no longer advertises hidden browser MCP tooling while that temporary mask is active
- Expanded direct contract coverage in [skill.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/skill.test.ts):
  - loading a skill now directly proves tracker unblocking for a task waiting on `requiredSkills`
- Kept prompt edits out of this tranche:
  - there is real prompt-style divergence, especially in [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt)
  - but I did not find a strong enough implementation-vs-training contradiction to justify a prompt rewrite during this pass

## Current tranche status

- Green:
  - [plan.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/plan.test.ts)
  - [capability.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/capability.test.ts)
  - [skill.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/skill.test.ts)
  - [skill-routing.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/skill-routing.test.ts)
  - [system-prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/system-prompt.test.ts)

## Final tranche note

- Tranche 4 closed with one real runtime bug and two contract-tightening wins:
  - Runtime bug: turn-scoped `capability disable` did not actually hide session-enabled capability surface for the current turn
  - Contract win: capability inspection now reflects visible surface, not transport-level connection state
  - Contract win: skill loading now has direct focused proof that it unblocks tracker tasks waiting on `requiredSkills`
- `plan` remains the most judgment-heavy part of this tranche, but its current risk is mostly prompt-shaping and future surface complexity, not immediate runtime breakage.
- No live model tests were used in this tranche. Validation stayed on focused local test suites only.

## Residual risks

- [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) still teaches a more plan-forward operating posture than the other providers, which could encourage unnecessary planner loops even though the current focused tests stay green.
- The capability-family taxonomy in [runtime.ts](C:/Users/HP/repos/opencode/packages/opencode/src/capability/runtime.ts) still reflects the older planning surface more than the newer topology/brief tools, which is worth revisiting in the later registry/composition tranche.
- [skill-routing.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/skill-routing.test.ts) still leans more toward ranking behavior than end-to-end prompt-routing behavior; that is acceptable for now because [skill.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/skill.test.ts) and [prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/prompt.test.ts) cover more of the real contract, but the split is still uneven.

## Verification commands used

1. `bun test test/tool/plan.test.ts test/tool/capability.test.ts test/tool/skill.test.ts test/tool/skill-routing.test.ts test/session/system-prompt.test.ts`
