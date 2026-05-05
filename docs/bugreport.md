## Current Harness Bugs and Friction

### Tavily Authentication Failure

- `TAVILY_API_KEY` is present in the runtime environment.
- Direct requests to `https://api.tavily.com/search` still return `401`.
- This indicates the issue is not missing env wiring in the harness runtime.
- Most likely causes:
  - invalid or expired Tavily key
  - wrong Tavily project/account scope
  - account-side auth mismatch

Impact:

- Tavily backend is unavailable even when selected or available as fallback.
- Web research currently depends on Searxng fallback instead.

Suggested follow-up:

- regenerate or replace the Tavily API key
- verify Tavily account/project scope
- rerun one direct Tavily smoke test after updating the key

### Task Observability Gap: Blocked vs Running

- Some subagents appeared to be long-running in `running_turn` even when the UI suggested they were blocked on a missing requirement.
- The task tool previously under-reported this state and did not clearly expose missing requirements in `check_in` / `status`.

Patch applied:

- added `waiting_on_requirement` work-state handling in `packages/opencode/src/tool/task.ts`
- added blocked dependency tracking via `blockedOnDependencies`
- blocked state now feeds task work summary and check-in reasoning

Relevant code paths:

- `packages/opencode/src/tool/task.ts:642`
- `packages/opencode/src/tool/task.ts:1495`
- `packages/opencode/src/tool/task.ts:1519`

Remaining opportunity:

- further split long-running work into:
  - `provider_wait`
  - `model_generating`
  - `waiting_on_requirement`
  - `finalizing_result`

### Task Follow-up Action Inference

- Follow-up task calls without explicit `action` were previously defaulting to `start`, which caused bogus errors like `action="start" requires "prompt"`.

Patch applied:

- task action inference now uses params to infer the intended follow-up action:
  - `task_id` + `timeout_ms` -> `wait`
  - `task_id` only -> `status`
  - `task_id` + `prompt` -> `message`

Relevant code path:

- `packages/opencode/src/tool/task.ts:1556`

Remaining friction:

- orchestration-related tests are still somewhat timing-sensitive and should be stabilized further.

### Search Backend Resilience

- Exa hit credits exhaustion.
- Tavily is currently unauthorized.
- Searxng fallback is working and is carrying the search path right now.

Impact:

- Web research still works, but backend resilience depends heavily on Searxng at the moment.

### Subagent Result Capture And Task History

- Completed subagents can still finish without durable result text or a captured fallback artifact.
- Useful worker conclusions can therefore disappear even when lifecycle metadata survives.
- Older attached child tasks are not easily discoverable from the active runtime list after cleanup or archive.

Impact:

- Successful research lanes are harder to synthesize back into the parent task.
- Valuable work episodes are at risk of being lost before they can feed retrieval or future orchestration memory.

Suggested follow-up:

- always persist a final summary/result string for completed subagents
- capture a fallback artifact when the expected artifact type is missing
- add a cheap paginated persisted task-history listing path that returns compact metadata only

### General Friction Notes

- Task lifecycle reliability is much better than before, but still worth continued monitoring.
- Provider auth/runtime plumbing should be treated as a first-class observability area.
- Orchestration and task tests remain a bit fragile under timing pressure.
