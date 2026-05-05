# Tool Audit - 2026-03-29

## Scope

This audit tranche focused on:

- shell selection and shell invocation behavior
- `bash` tool runtime behavior on Windows
- `edit` tool regression verification
- prompt/training alignment for managed background processes

Relevant prompt/system files in scope:

- `src/session/system.ts`
- `src/session/prompt/codex_header.txt`
- `src/session/prompt/anthropic.txt`
- `src/session/prompt/anthropic-20250930.txt`
- `src/session/prompt/gemini.txt`

## What changed

### Runtime

- Added shared shell invocation logic in `src/shell/shell.ts`
- Added `Shell.commandPreferred()` so the `bash` tool prefers a POSIX shell on Windows when available
- Added `Shell.invocationFor()` so shell-specific argument handling is explicit instead of relying on ambiguous `spawn(..., { shell })` behavior
- Corrected login-shell argument ordering for `bash` and `zsh`
- Updated `src/tool/bash.ts` to use explicit shell invocation instead of Node/Bun shell fallback semantics
- Updated `src/session/prompt.ts` to use the same shell invocation helper for session shell execution
- Hardened `src/tool/edit.ts` so successful edits no longer crash when the LSP surface is partial or mocked. `LSP.touchFile()` and `LSP.diagnostics()` are now best-effort, and diagnostics formatting falls back cleanly when `LSP.Diagnostic.pretty` is unavailable.
- Hardened `src/provider/provider.ts` so provider/tool planning paths tolerate environments where `Plugin.list` is missing instead of crashing on provider resolution.
- Hardened `src/tool/plan.ts` so broken ancestry falls back to the current session, and planning-analog scoring now treats clean strong evidence as high-confidence while degrading confidence when historical outcomes conflict.
- Hardened `src/bun/registry.ts` so package-version probing degrades gracefully when `bun info ...` cannot be spawned on Windows, instead of leaking a hard exception into unrelated tool paths.

### Tests

- Added shell helper coverage in `test/shell/shell.test.ts`
- Isolated `bash` tool tests from plugin bootstrap noise by mocking `Plugin.trigger("shell.env", ...)`
- Adjusted brittle bash test commands to use portable shell commands in the actual bash environment
- Verified the full `edit` tool file after the earlier compaction-related investigation
- Added `test/session/system-prompt.test.ts` to pin tool-training expectations in `system.ts`, `codex_header.txt`, `anthropic.txt`, `anthropic-20250930.txt`, and `gemini.txt`.
- Updated timeout-sensitive tests to use explicit budgets where the behavior is correct but the default 5s Bun deadline is too tight on this Windows environment:
  - `test/tool/node_repl.test.ts`
  - `test/tool/registry.test.ts`
  - `test/tool/bash-safety.test.ts`
- Relaxed `test/tool/task-lane.test.ts` to assert stable routing semantics with `expect.objectContaining(...)` so added routing metadata does not fail otherwise-correct behavior.

## Verified passing slices

### Clean green runs

- `bun test test/shell/shell.test.ts test/tool/edit.test.ts`
- `bun test test/tool/bash.test.ts -t "basic"`
- `bun test test/tool/bash.test.ts -t "truncates output exceeding line limit"`
- `bun test test/tool/bash.test.ts -t "truncates output exceeding byte limit"`
- `bun test test/tool/bash.test.ts -t "uses a larger truncation budget for file-read-like commands"`
- `bun test test/tool/bash-safety.test.ts -t "detects rm -rf on sensitive files"`
- `bun test test/tool/bash.test.ts -t "asks for external_directory permission when file arg is outside project"`
- `bun test test/tool/edit.test.ts test/session/system-prompt.test.ts test/session/prompt.tracker.test.ts`
- `bun test test/tool/plan.test.ts`
- `bun test test/tool/apply_patch.test.ts -t "parses heredoc-wrapped patch without cat"`
- `bun test test/tool/node_repl.test.ts -t "times out long-running evaluations and restarts the worker"`
- `bun test test/tool/registry.test.ts -t "loads tools with external dependencies without crashing"`
- `bun test test/tool/registry.test.ts -t "loads tools from"`
- `bun test test/tool/task-lane.test.ts`

### Broad status

- `test/tool/edit.test.ts` is green end-to-end
- `test/shell/shell.test.ts` is green end-to-end
- `test/tool/bash.test.ts` and `test/tool/bash-safety.test.ts` are functionally much healthier and the previously failing runtime paths are fixed
- The broad `test/tool test/capability test/question test/pty` tranche exposed a mix of real regressions and brittle expectations:
  - Real regressions fixed in this tranche:
    - `edit` post-write LSP crash
    - provider planning crash when `Plugin.list` is unavailable
    - planning analog confidence / ancestry replay bugs
    - `bun info` spawn failures leaking into tool loading
  - Expectation / harness-budget fixes applied:
    - `node_repl` timeout test budget
    - registry custom-tool load budgets
    - bash safety test budget
    - task-lane assertions updated for richer routing metadata and the current general-task envelope

## Important findings

### 1. Windows shell invocation was incorrect for the `bash` tool

The old path depended on:

- `spawn(command, { shell: pwsh.exe })`

That left command execution behavior dependent on shell-specific quirks and was the wrong abstraction for PowerShell and POSIX-shell differences. The fix was to make shell invocation explicit and shared.

### 2. Prompt/runtime shell handling had drifted

`src/session/prompt.ts` already had shell-specific invocation logic, while `src/tool/bash.ts` did not. That inconsistency is now removed by routing both through shared shell invocation helpers.

### 3. `bash` test timeouts were hiding two different issues

- a real runtime issue: Windows shell selection/invocation for the `bash` tool
- a test-isolation issue: plugin bootstrap cost in fresh test sandboxes

Mocking the shell-env plugin path inside the `bash` tests made the test file measure the tool instead of plugin install/bootstrap behavior.

### 4. Several bash tests were using commands that were not portable in the actual bash environment under test

The following patterns were especially brittle:

- `python` from the PowerShell environment, but not from the bash environment
- shell-specific heartbeat commands that did not reliably stay quiet across environments

These were replaced with commands that better match the shell actually being exercised.

### 5. Tool-training drift was real in the provider prompts

The prompt layer was over-prescriptive in some places (`TodoWrite` / `Task`) and under-specific in others (`terminal`, `recall`, tracker-vs-todo, `blackboard`, `capability`). The prompt updates in this tranche were not cosmetic; they bring the model-facing training surface back into alignment with the actual builtin tool registry.

### 6. A meaningful portion of the remaining red surface is test-contract drift, not product breakage

The broad suite surfaced multiple failures where the implementation had evolved in useful ways:

- richer routing metadata in `resolveTaskRouting(...)`
- a lightweight general-discipline envelope in `applyTaskDisciplineEnvelope(...)`
- slower but still-correct custom tool loading and timeout/restart paths on Windows

Those tests needed to assert stable semantics without pinning incidental formatting or assuming the Bun default timeout was an accurate product contract.

## Prompt/training observations so far

### Confirmed improved

- `codex_header.txt` now explicitly distinguishes `bash` vs `Terminal`
- `anthropic.txt` and `anthropic-20250930.txt` now teach `wait_for_result=false` for true background task fanout and prefer `Terminal` for persistent processes
- `gemini.txt` now teaches managed `terminal` usage instead of shell `&` backgrounding
- `system.ts` keeps the Windows-native guidance honest by warning not to assume bash semantics unless explicitly invoked

### Still needs audit

- map every builtin tool to whether it is taught in system/provider prompts
- identify stale tool names or over-prescriptive heuristics in provider prompts
- verify whether compacted tool descriptions are enough for lesser-used tools without extra system-prompt reinforcement
- verify whether `TodoWrite` / `Task` guidance is proportionate and still aligned with the current surface

## Remaining audit backlog

High priority:

- complete a builtin-tool matrix: tool id, prompt mention, description quality, focused tests, known risks
- run remaining tool files in `test/tool/` in slices and separate real tool failures from test-environment noise
- audit prompt references against the actual builtin registry to catch stale names or missing high-value guidance

Likely next slice:

- `read`, `write`, `search_replace`, `multiedit`
- `task` and tracker tools
- `workbench`, `recall`, `retrieval_status`, `capability`
- `terminal` prompt reinforcement and lifecycle coverage beyond the current focused tests
