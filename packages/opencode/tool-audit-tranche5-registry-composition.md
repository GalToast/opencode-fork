# Tranche 5 Registry Composition Audit - 2026-03-29

## Scope

This tranche covers the registry/composition surface:

- tool registration correctness
- capability exposure correctness
- compacted tool-description fidelity
- provider-specific prompt divergence

## Audit Matrix

| Area | Primary files | Focused test coverage | Initial risk read |
| --- | --- | --- | --- |
| Registry truth | [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) | [registry.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/registry.test.ts) | Medium. The builtin list is broad and still mixes legacy and newer tool families behind feature flags |
| Capability exposure correctness | [runtime.ts](C:/Users/HP/repos/opencode/packages/opencode/src/capability/runtime.ts), [capability.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/capability.ts), [prompt.ts](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt.ts) | [capability.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/capability.test.ts), [prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/prompt.test.ts) | High before this pass. Capability-family expansion was drifting behind the real modern planning surface |
| Compacted description fidelity | [prompt.ts](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt.ts) | [prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/prompt.test.ts) | Medium. Safe routing depends heavily on descriptions, so over-trimming can silently change model behavior |
| Provider prompt divergence | [system.ts](C:/Users/HP/repos/opencode/packages/opencode/src/session/system.ts), [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt), [anthropic.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic.txt), [anthropic-20250930.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic-20250930.txt), [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) | [system.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/system.test.ts), [system-prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/system-prompt.test.ts) | Medium. Prompt routing is mostly coherent, but provider tone and execution posture still vary enough to create behavioral skew |

## Initial observations

- The registry itself is in decent shape:
  - builtin registration is explicit and easy to audit in [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts)
  - focused registry tests already covered custom tool discovery, websearch/codesearch gating, and several modern builtin IDs
- The real tranche bug was in composition, not bare registration:
  - the capability runtime's `planning` family still only mapped to `question`, `enter_plan_mode`, and `exit_plan_mode`
  - but the registered planning surface had already expanded to include `planning_topology_preview`, `planning_topology_compare`, `planning_topology_select`, `planning_topology_outcome`, and `planning_execution_brief_commit`
  - result: asking `capability` to enable `planning` did not actually expose the modern planning family the way the surface implied
- Prompt compaction looks acceptable for now:
  - [prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/prompt.test.ts) still proves usage/example sections are trimmed and lead sentences are preserved
  - I did not find a focused regression where compaction was dropping the actual safety-critical routing sentence for the audited tools
- Provider divergence is real but mostly stylistic and behavioral rather than contradictory:
  - [codex_header.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/codex_header.txt) remains execution-first
  - [anthropic.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic.txt) and [anthropic-20250930.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/anthropic-20250930.txt) are fairly aligned with the modern coordination/tool-routing surface
  - [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) is still more plan-forward than the others

## Audit progress

- Fixed the stale capability-family mapping in [runtime.ts](C:/Users/HP/repos/opencode/packages/opencode/src/capability/runtime.ts):
  - `planning` now expands to the legacy trio plus the newer topology and execution-brief planning tools
- Updated the capability tool description in [capability.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/capability.ts):
  - the documented `planning` family now matches the actual modern family shape instead of teaching only the older surface
- Added a direct composition regression in [capability.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/capability.test.ts):
  - enabling `planning` now proves that the runtime family contains the topology and execution-brief planning tools
- Re-verified the surrounding composition surface without broadening the test slice:
  - registry discovery still passes
  - capability broker behavior still passes
  - prompt compaction tests still pass
  - system/provider prompt routing tests still pass

## Current tranche status

- Green:
  - [registry.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/registry.test.ts)
  - [capability.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/tool/capability.test.ts)
  - [system.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/system.test.ts)
  - [system-prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/system-prompt.test.ts)
  - targeted composition cases in [prompt.test.ts](C:/Users/HP/repos/opencode/packages/opencode/test/session/prompt.test.ts)

## Final tranche note

- Tranche 5 found one real registry/composition bug:
  - the capability-family taxonomy for `planning` had drifted behind the actual registered tool surface
- That mismatch is now fixed at both layers that matter:
  - runtime family expansion in [runtime.ts](C:/Users/HP/repos/opencode/packages/opencode/src/capability/runtime.ts)
  - user/model-facing family description in [capability.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/capability.ts)
- I did not make prompt text changes in this tranche:
  - the provider prompts are not perfectly uniform
  - but I did not find a sharp enough contradiction to justify editing them during this pass
- No live model tests were used here either; validation stayed on local focused suites only

## Residual risks

- [gemini.txt](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt/gemini.txt) still teaches a more plan-heavy posture than the other providers, which may continue to create execution-style skew even though the underlying capability and registry surfaces are now more coherent.
- [registry.ts](C:/Users/HP/repos/opencode/packages/opencode/src/tool/registry.ts) still conditions some modern surfaces on startup flags, which makes full end-to-end exposure testing harder than the runtime-family layer suggests. That is not a bug by itself, but it does increase the chance of future composition drift.
- [prompt.ts](C:/Users/HP/repos/opencode/packages/opencode/src/session/prompt.ts) compaction is still intentionally blunt. The current tests are good enough for this pass, but if more tools start depending on long description sections for safety-critical routing, compaction policy may need a more structured approach.

## Verification commands used

1. `bun test test/tool/registry.test.ts test/tool/capability.test.ts test/session/system.test.ts test/session/system-prompt.test.ts test/session/prompt.test.ts -t "capability broker|compactToolDescription|ordinary build turns do not inject tracker guidance until tracker tools are enabled|complex build turns encourage coordination before tracker tools are enabled|sortByID canonicalizes tool order for stable prompt surfaces|system prompt provider routing|tool.registry|planning family includes the modern topology and execution brief tools"`
