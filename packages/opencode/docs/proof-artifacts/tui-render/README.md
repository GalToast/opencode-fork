# TUI Render Proof Artifacts

These files are committed proof outputs from:

```bash
bun run script/tui-render-proof.tsx
```

The render proof imports the real `DialogPlan` and `DialogTracker` TypeScript modules, mounts them under deterministic mocked TUI contexts, and captures character frames, HTML, PNG, and slash-command dispatch metadata. It does not call a product model or require network access.

Key files:

- `real-dialog-proof.png` - visual composite of the rendered dialog proof.
- `real-dialog-proof.html` - browser-viewable proof export.
- `real-dialog-proof-summary.json` - machine-readable verdict and metadata.
- `dialog-plan-frame.txt` - captured plan dialog text frame.
- `dialog-tracker-list-frame.txt` - captured tracker list text frame.
- `dialog-tracker-dag-frame.txt` - captured tracker DAG text frame.
- `slash-command-wiring.json` - source-level command option verification.
- `slash-command-dispatch.json` - `/plan`, `/tracker`, and `/tasks` dispatch results.

This is strong no-model UI proof. It is not a claim that live PTY capture or full keyboard navigation is complete.
