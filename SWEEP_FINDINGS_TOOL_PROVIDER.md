## Tool/Provider Layer Findings

### Dead Code
- **src/tool/registry.ts:18** - `TodoReadTool` imported from `./todo` but never registered in tool array
- **src/tool/registry.ts:34** - `SearchReplaceTool` imported but never registered in tool array
- **src/tool/multiedit.ts:8** - `MultiEditTool` defined but never imported or registered in registry
- **src/tool/ls.ts:38** - `ListTool` defined but never imported or registered in registry (only used in CLI render)
- **src/tool/mecha.ts:28,125,159,200** - `HypothesisTool`, `StructuralReadTool`, `ImpactTool`, `EvolutionTool` defined in `MechaTools` array but never imported or registered in registry
- **src/tool/plan.ts:986** - `ExitPlanModeTool` defined but not registered in main tool array (only conditionally included via plan mode flag)
- **src/tool/plan.ts:2-8** - `EnterPlanModeTool`, `PlanningTopologyCompareTool`, `PlanningExecutionBriefCommitTool`, `PlanningTopologyOutcomeTool`, `PlanningTopologyPreviewTool`, `PlanningTopologySelectTool` imported but only conditionally registered behind plan mode flag

### Unhooked Features
- **src/tool/mecha.ts:280** - `MechaTools` array exported but never consumed by registry (entire Mecha tool suite unhooked)
- **src/provider/sdk/copilot/responses/tool/web-search.ts** - Copilot web-search tool defined but unclear if connected to main tool system
- **src/provider/sdk/copilot/responses/tool/file-search.ts** - Copilot file-search tool defined but unclear if connected to main tool system
- **src/provider/sdk/copilot/responses/tool/code-interpreter.ts** - Copilot code-interpreter tool defined but unclear if connected to main tool system
- **src/provider/sdk/copilot/responses/tool/image-generation.ts** - Copilot image-generation tool defined but unclear if connected to main tool system
- **src/provider/sdk/copilot/responses/tool/local-shell.ts** - Copilot local-shell tool defined but unclear if connected to main tool system
- **src/acp\agent.ts:562** - Authentication method returns "Authentication not implemented" error

### Incomplete/Stubs
- **src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts:454** - TODO: "we lost type safety on Chunk, most likely due to the error schema. MUST FIX"
- **src/provider/sdk/copilot/responses/openai-responses-language-model.ts:436** - TODO: "AI SDK 6: use optional here instead of nullish"
- **src/provider/transform.ts:497** - TODO: "Remove this after models.dev data is fixed to use 'kimi-k2.5' instead of 'k2p5'" (temporary workaround still in place)
- **src/provider/auth.ts** - OAuth callback flow exists but `OauthCallbackFailed` error suggests incomplete error handling paths
- **src/provider/provider.ts:410,615** - TODO comments about `Env.set` only updating shallow copy of process.env (workaround in place but not fixed)

### Suspicious Patterns
- **src/tool/registry.ts** - Plan mode tools (lines 2-8, 275-282) conditionally registered behind `Flag.get("plan-mode")` - if flag is disabled, these tools are defined but unreachable
- **src/tool/todo.ts:6,33** - Both `TodoWriteTool` and `TodoReadTool` defined, but only `TodoWriteTool` imported/registered (asymmetry suggests incomplete implementation)
- **src/tool/bash.ts:91** - TODO comment: "we may wanna rename this tool so it works better on other shells" (shell compatibility concern)
- **src/tool/composer.ts:68** - Contains placeholder JSON structure in description suggesting tool composition feature not fully realized
- **src/provider/models-snapshot.ts** - Auto-generated file with large JSON snapshot; if build process fails, provider model info becomes stale
- **src/provider/provider.ts:280-302** - `BUNDLED_PROVIDERS` has 21 providers registered, but custom provider loader pattern (lines 304+) suggests some providers may have duplicate registration paths
- **src/config/config.ts:605,627,1054,1087,1173,1509** - Multiple `@deprecated` annotations on config fields (`tools`, `maxSteps`, `share`, `agent`, `layout`, `tui keys`) but old fields still parsed (migration incomplete)

### Uncertainty Notes
- **Copilot SDK tools** - Five provider-defined tools exist in `src/provider/sdk/copilot/responses/tool/` but cannot confirm if they're exposed through the main tool registry or only available via Copilot-specific API
- **Custom tool loading** - Registry supports dynamic tool loading from config directories (lines 120-135) but no evidence of this being tested or documented
- **Plugin tool hooks** - Registry has `triggerPluginDefinition` function (lines 90-98) but unclear if any plugins actually use this hook
