# OpenCodex by McCullough Digital

This repository is the public `opencode-fork` branch of [GalToast/opencode-fork](https://github.com/GalToast/opencode-fork/tree/opencode-fork), maintained by McCullough Digital as **OpenCodex**: a systems-oriented fork of upstream [OpenCode](https://opencode.ai).

OpenCodex shifts the surface from single-turn code assistance toward long-horizon, human-in-the-loop software work. It adds task DAG orchestration, durable tracker state, semantic retrieval and compaction, deterministic TUI proof artifacts, a stateful agent workbench runtime, and experimental self-editing harnesses with explicit caveats.

### What changed vs. upstream

- **Operator / session surface** - human-in-the-loop routes and plan state surfaces for supervising active work.
- **Task DAGs & durable task tracker** - dependency-aware task behavior, tracker tools, and clearer CLI/TUI task progress.
- **Semantic retrieval & compaction** - retrieval policy, rerank, runtime, and compaction baton subsystems.
- **TUI launcher proof** - render-proof and launcher smoke coverage for the terminal UI.
- **Self-editing harness research** - healer, reviewer, confidence, blackboard, and shadow-workspace subsystems, guarded as active development.
- **Stateful agent workbench** - Node-backed persistent session runtime plus ephemeral helper creation through the registered `workbench` tool.
- **Typecheck / test stabilization** - `packages/opencode` typecheck and TUI lint are clean, with focused tool/TUI tests passing in the current publish prep.

For the detailed feature guide and caveats, start with [packages/opencode/README.md](packages/opencode/README.md). For a source-backed tool inventory, see [docs/opencodex-runtime-surface.md](docs/opencodex-runtime-surface.md).

### Implementation Evidence

| What | Where |
|------|-------|
| Fork capabilities & caveats | [packages/opencode/README.md](packages/opencode/README.md) |
| Operator & session changes | `packages/opencode/src/server/routes/session.ts`, `packages/opencode/src/server/routes/experimental.ts`, `packages/opencode/src/session/plan-state.ts` |
| DAG orchestration | `packages/opencode/src/tool/task.ts`, `packages/opencode/test/tool/task-dependencies.test.ts` |
| Semantic retrieval | `packages/opencode/src/retrieval/` |
| TUI / launcher proof | `packages/opencode/docs/proof-artifacts/tui-render/`, `packages/opencode/test/cli/tui-render-proof.test.tsx` |
| Self-editing harness | `packages/opencode/src/harness/` |
| Workbench tool | `packages/opencode/src/tool/workbench.ts`, `packages/opencode/test/tool/workbench.test.ts` |
| Runtime surface inventory | [docs/opencodex-runtime-surface.md](docs/opencodex-runtime-surface.md) |
| Publish hygiene | [docs/opencodex-publish-workflow.md](docs/opencodex-publish-workflow.md) |

### Verification Status

| Check | Result |
|-------|--------|
| `bun run typecheck` in `packages/opencode` | Passed during May 5, 2026 publish prep |
| `bun run lint:tui` in `packages/opencode` | Passed during May 5, 2026 publish prep |
| Focused TUI/tool tests | Passed during May 5, 2026 publish prep, with one broad-run bash timeout passing on exact serial rerun |
| Pre-push monorepo typecheck hook | Passed during May 5, 2026 publish prep |

---

### Upstream Base

OpenCodex remains based on upstream OpenCode and keeps the upstream installation and platform notes below for compatibility context. The fork-specific proof surface is documented above and in [packages/opencode/README.md](packages/opencode/README.md).

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, or AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

### FAQ

#### How is this different from Claude Code?

It's very similar to Claude Code in terms of capability. Here are the key differences:

- 100% open source
- Not coupled to any provider. Although we recommend the models we provide through [OpenCode Zen](https://opencode.ai/zen), OpenCode can be used with Claude, OpenAI, Google, or even local models. As models evolve, the gaps between them will close and pricing will drop, so being provider-agnostic is important.
- Out-of-the-box LSP support
- A focus on TUI. OpenCode is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- A client/server architecture. This, for example, can allow OpenCode to run on your computer while you drive it remotely from a mobile app, meaning that the TUI frontend is just one of the possible clients.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
