# OpenCodex Publish Workflow

This fork has two different working contexts:

- **Development/source worktree**: the active engineering workspace. It can contain local-only model payloads, ignored diagnostics, archived patches, and other heavy artifacts needed for restoration work.
- **Public publish worktree**: a sanitized branch/worktree based on the public `opencode-fork` branch. This is the only safe source for GitHub recruiter-facing pushes.

Do not push the development/source tree directly to the public fork unless the tree has first been checked for large local artifacts and public-safety concerns. In particular, local `ai-models/`, `tmp/`, test logs, generated diagnostics, and patch archives must not be introduced into the public branch.

## Safe Publish Pattern

1. Validate the source package in the development worktree.
2. Ensure the current public branch tip is archived before replacing broad public state.
3. Create or reuse a sanitized publish worktree from the public `opencode-fork` branch.
4. Apply only the intended public paths, normally:
   - `README.md`
   - `bun.lock`
   - `packages/opencode/**`
   - any explicitly reviewed public docs
5. Run a public-worktree validation pass:
   - `bun install --frozen-lockfile` when the lockfile is expected to be settled
   - `bun run typecheck` from `packages/opencode`
   - `bun run lint:tui` from `packages/opencode`
6. Confirm no staged public diff touches local-only paths:
   - `ai-models/**`
   - `packages/opencode/tmp/**`
   - root test logs or temporary diagnostics
7. Push the sanitized publish commit to `opencode-fork`.

## Current Baseline

The previous public tip was archived before the May 5, 2026 publish:

- `archive/opencode-fork-pre-source-publish-20260505-b2622739a`
- archived commit: `b2622739a68085877ae380c00df2a016455d8217`

The public `opencode-fork` branch was then fast-forwarded to the sanitized publish commit:

- `59ea2aa10eeb33c849aed4ba3cecca326b46cbeb`

This preserves history without publishing the development worktree's local model blobs.
