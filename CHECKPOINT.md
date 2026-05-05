# Checkpoint: 2026-04-05 Post-Sync-Store-Fix

## Error Count: 491 (was 790, was 1,342)

## Changes Made This Session
1. Added `console_state`, `workspaceList`, `workspace` fields to sync store type and initial state in `sync.tsx`
2. Added import for `ConsoleState` and `Workspace` types in `sync.tsx`
3. Added bootstrap call to populate `console_state` and `workspaceList` from SDK client
4. Added `Server.App()` function to `server.ts` (delegates to `ControlPlaneRoutes()`)

## Remaining Error Breakdown
Need to re-run breakdown. Top categories from last run:
- TS2322: Branded type mismatches (SessionID, ProviderID, ModelID)
- TS2339: Missing properties (SessionPrompt.ingress, SessionPrompt.registerPromptResultTap, etc.)
- TS2353: Unknown object properties (resultTapID)
- TS7006: Implicit any parameters
- Provider.listFreeOpencodeModels missing

## Key Remaining Fixes
1. **SessionPrompt missing methods**: ingress, registerPromptResultTap, unregisterPromptResultTap, registerHarnessResultTap, unregisterHarnessResultTap
2. **Branded type factories**: Need `SessionID()`, `ProviderID()`, `ModelID()` helper functions
3. **Provider.listFreeOpencodeModels**: User said they added it but it's not in provider.ts
4. **ResultTapID**: Missing from prompt input type
5. **TUI component type errors**: onMouseMouseDown, NoBorderLeft, SplitBorderLeft, etc.

## Files Modified
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx` — Added console_state, workspaceList, workspace
- `packages/opencode/src/server/server.ts` — Added App() function
