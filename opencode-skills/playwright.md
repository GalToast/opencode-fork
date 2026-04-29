---
name: "playwright"
description: "Use when the task requires browser automation (navigation, form filling, snapshots, screenshots, data extraction) via the Playwright MCP server."
---

# Playwright Skill (Opencode)

## Overview
Opencode has a built-in Playwright MCP server. Use it for browser automation tasks.

## Prerequisite
The Playwright MCP server should already be configured and available. If not, check the AGENTS.md or config.toml for setup.

## Core workflow
1. Use `playwright_browser_navigate` to open pages.
2. Use `playwright_browser_snapshot` to get stable element refs.
3. Interact using refs from the snapshot.
4. Re-snapshot after navigation or significant DOM changes.
5. Capture artifacts (screenshot) when useful.

## Recommended patterns

### Navigation
```bash
playwright_browser_navigate url="https://example.com"
```

### Get element refs
```bash
playwright_browser_snapshot
```

### Click an element
```bash
playwright_browser_click ref="e3"
```

### Fill a form
```bash
playwright_browser_fill_form fields=[{"name": "email", "type": "textbox", "ref": "e1", "value": "user@example.com"}]
```

### Screenshot
```bash
playwright_browser_take_screenshot filename="screenshot.png" type="png"
```

## When to snapshot again
- After navigation
- After clicking elements that change the UI substantially
- After opening/closing modals or menus
- After tab switches

Refs can go stale. When a command fails due to a missing ref, snapshot again.

## Artifacts
Save screenshots to `reports/screenshots/playwright/` per repo conventions.

## Guardrails
- Always snapshot before referencing element ids like `e12`.
- Re-snapshot when refs seem stale.
- Default to file-based screenshot capture (set `filename` parameter).
