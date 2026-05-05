# External CLI Subagent Helpers

These helpers launch local external CLI agents from prompt files while keeping runs auditable under `tmp/external-cli-subagents/`.

Default lanes use an empty MCP config where the CLI supports it, or a context-only guard where it does not, to avoid surprise browser/tool fan-out. When a task actually needs MCP tools, launch a separate MCP-enabled lane with an explicit MCP config or allowed server list, exact tool purpose, and ownership boundary.

## Claude read-only audit

Use Claude for repo/file inspection and command-backed read-only audits.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File script/external-cli/Invoke-ClaudeReadOnlyAudit.ps1 `
  -PromptPath tmp/external-cli-subagents/example.prompt.md `
  -Name claude-example `
  -TimeoutSeconds 120 `
  -Tools "Read,Bash" `
  -PermissionMode plan `
  -OutputFormat stream-json `
  -IncludePartialMessages
```

The wrapper uses the real `claude.exe`, stdin prompt delivery, `--strict-mcp-config`, an empty MCP config, no Chrome integration, no slash commands, and process-tree timeout cleanup.

## Gemini audit

Use Gemini for context-fed critique, product/UX judgment, or narrow edit lanes. The wrapper avoids PowerShell redirection, sends the prompt on stdin, archives stdout/stderr/result metadata, and kills the process tree on timeout.

On this Windows setup Gemini may emit node-pty `AttachConsole failed` or missing-tool stderr even after a successful edit. Treat exit status as only one signal; inspect the archived output and the real file diff.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File script/external-cli/Invoke-GeminiAudit.ps1 `
  -PromptPath tmp/external-cli-subagents/example.prompt.md `
  -Name gemini-example `
  -TimeoutSeconds 120 `
  -ApprovalMode plan `
  -OutputFormat text
```

For an MCP-enabled Gemini lane, pass the explicit allow-list with `-AllowedMcpServerNames switchboard` or the specific server required for the task.

## MCP-enabled lanes

Use MCP-enabled lanes only when the worker needs a specific MCP capability such as switchboard coordination, browser verification, or a repo-local tool server. Do not silently reuse the default no-MCP wrappers for these tasks.

Every MCP-enabled prompt must name:

- the MCP tools the worker may use
- the files or directories the worker owns
- the browser/Chrome DevTools coordination rule, if browser tools are enabled
- the verification command or evidence expected from the tool use

Keep browser MCP access serialized unless the user explicitly accepts collision risk.

## Edit-capable lanes

All three third-party CLIs can do real edit work. Use edit lanes only with prompts that define exact ownership, forbidden paths, no-revert rules, and verification.

| Agent | Good edit lane | Notes |
| --- | --- | --- |
| Claude | `Invoke-ClaudeReadOnlyAudit.ps1` with `-Tools "Read,Bash,Edit"` and `-PermissionMode acceptEdits` | Best default for scoped repo edits. |
| Gemini | `Invoke-GeminiAudit.ps1` with `-ApprovalMode auto_edit` | Prefer context-fed or narrow file ownership; broad shell-backed inspection can stall on this Windows setup. |
| Qwen | `Invoke-QwenEdit.ps1` with `-ApprovalMode yolo` | Strong small-model edit lane, but run a process/MCP scan before and after because previous yolo runs spawned MCP helpers. |

The main lane must review `git diff` and run verification after every edit-capable external agent, regardless of model.

## Qwen context-only critique

Use Qwen for context-fed critique or second opinions only. Do not use it for autonomous file inspection in this workspace; non-interactive plan mode can stall when Qwen attempts shell tools.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File script/external-cli/Invoke-QwenContextOnlyAudit.ps1 `
  -PromptPath tmp/external-cli-subagents/qwen-context.prompt.md `
  -Name qwen-context `
  -TimeoutSeconds 90
```

The wrapper prepends a no-tools guard, passes an empty MCP config, excludes common shell/read/write tool names, captures stdout/stderr/result metadata, and kills the process tree on timeout.

## Qwen edit lane

Use the edit wrapper for strict owned edits. It uses the explicit MCP config path, sends prompt content through stdin, captures stdout/stderr/result metadata, and kills the process tree on timeout.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File script/external-cli/Invoke-QwenEdit.ps1 `
  -PromptPath tmp/external-cli-subagents/qwen-edit.prompt.md `
  -Name qwen-edit `
  -TimeoutSeconds 180 `
  -ApprovalMode yolo
```

## Main-lane rule

Treat every external agent result as untrusted until the main lane checks the actual files, `git diff`, and relevant verification commands.

## MCP config templates

Templates live in `script/external-cli/mcp-configs/`:

- `empty-mcp.json`: default no-MCP config for CLIs that accept `--mcp-config`
- `switchboard-mcp.json`: coordination-only MCP lane
- `browser-mcp.example.json`: browser verification lane; serialize Chrome/Playwright access before use
