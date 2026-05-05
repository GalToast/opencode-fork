## CLI Layer Findings

### Dead Code
- `packages/opencode/src/cli/cmd/run.ts:358-368` - `--port` option defined but never consumed in handler (only `args.attach` is used for remote connections)
- `packages/opencode/src/cli/cmd/debug/*.ts:96,51,86,51,47` - Multiple debug subcommands have empty `async handler() {}` bodies (LSP, File, Ripgrep, Snapshot, Debug parent commands) - these are parent commands that delegate to subcommands, which is valid pattern
- `packages/opencode/src/cli/cmd/mcp.ts:755` - Parent McpCommand has empty handler (delegates to subcommands - valid pattern)
- `packages/opencode/src/cli/cmd/session.ts:124` - Parent SessionCommand has empty handler (delegates to subcommands - valid pattern)
- `packages/opencode/src/cli/cmd/auth.ts:512` - Parent AuthCommand has empty handler (delegates to subcommands - valid pattern)
- `packages/opencode/src/cli/cmd/agent.ts:265` - Parent AgentCommand has empty handler (delegates to subcommands - valid pattern)
- `packages/opencode/src/cli/cmd/github.ts:1647` - Parent GithubCommand has empty handler (delegates to subcommands - valid pattern)
- `packages/opencode/src/cli/cmd/db.ts:117` - Parent DbCommand has empty handler (delegates to subcommands - valid pattern)

### Unhooked Features
- `packages/opencode/src/cli/cmd/run.ts:358-368` - `--port` flag defined with description "port to connect to" but handler never reads `args.port`; only `args.attach` is checked for remote connections (line 798)
- `packages/opencode/src/cli/cmd/tui/thread.ts:214` - Network options (port, hostname, mdns, cors) are added via `withNetworkOptions()` but TUI thread handler never consumes them; network options are only relevant for server modes, not TUI
- `packages/opencode/src/cli/cmd/run.ts:365-368` - `--variant` option defined for model variant selection but usage is unclear from context (appears to be passed to session creation at lines 768, 776)

### Incomplete/Stubs
- `packages/opencode/src/cli/cmd/github.ts:215` - Comment `// TODO: add guide for copilot, for now just hide it` indicates incomplete GitHub Copilot integration guide
- `packages/opencode/src/cli/cmd/debug/lsp.ts:51` - LSP command parent handler is empty stub (though subcommands are implemented)
- `packages/opencode/src/cli/cmd/debug/file.ts:96` - File command parent handler is empty stub (though subcommands are implemented)
- `packages/opencode/src/cli/cmd/debug/ripgrep.ts:86` - Ripgrep command parent handler is empty stub (though subcommands are implemented)
- `packages/opencode/src/cli/cmd/debug/snapshot.ts:51` - Snapshot command parent handler is empty stub (though subcommands Track/Patch/Diff are implemented)

### Suspicious Patterns
- `packages/opencode/src/cli/cmd/run.ts:358-368` + `packages/opencode/src/cli/cmd/run.ts:798-808` - `--port` option defined but handler uses `args.attach` instead; suggests refactoring incomplete or option misnamed
- `packages/opencode/src/cli/cmd/tui/thread.ts:214` + `packages/opencode/src/cli/network.ts:1-60` - Network options added to TUI command but TUI doesn't start a server; network.ts `resolveNetworkOptions()` is never called in TUI thread flow
- `packages/opencode/src/cli/cmd/tui/attach.ts:12-44` - Attach command has network-style options (`--dir`, `--continue`, `--session`, `--fork`, `--password`) but attaches to existing server via `args.attach`; some options may be unused
- `packages/opencode/src/cli/index.ts:224` - `WorkspaceServeCommand` is conditionally added only when certain conditions met; unclear what triggers this and whether feature is complete
- `packages/opencode/src/cli/cmd/run.ts:416` - Handler checks `!args.command` but `--command` option is not visible in builder (may be defined elsewhere or missing)
- `packages/opencode/src/cli/cmd/tui/app.tsx:561-762` - Multiple command aliases defined in TUI app (resume, continue, session, sess / clear / model / quit, q) but these are TUI-internal slash commands, not CLI commands; potential confusion between TUI commands and CLI commands

### Notes
- Empty parent command handlers (Debug, Mcp, Session, Auth, Agent, Github, Db) are valid yargs pattern for commands that only serve as containers for subcommands
- The `--variant` option in run.ts appears to be consumed (lines 768, 776) but its effect on model selection is not fully traceable in CLI layer alone
- TUI thread network options appear to be incorrectly inherited; TUI doesn't need network listener options
