---
name: webapp-testing
description: "Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, and capturing browser screenshots."
---

# Web Application Testing (Opencode)

## Decision Tree
1. Static HTML? -> Read file directly
2. Dynamic webapp? -> Server running?
   - No: Start server, then automate
   - Yes: Navigate, snapshot, identify selectors, act

## Pattern
1. Navigate and wait for networkidle
2. Take screenshot or inspect DOM
3. Identify selectors from rendered state
4. Execute actions

## Best Practices
- Use `sync_playwright()` for synchronous scripts
- Always close browser when done
- Use descriptive selectors: text=, role=, CSS
- Add appropriate waits: wait_for_selector() or wait_for_timeout()

## Common Pitfall
Don't inspect DOM before waiting for networkidle on dynamic apps
