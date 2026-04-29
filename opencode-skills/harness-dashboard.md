---
name: harness-dashboard
description: "Generates a 'Session Pulse' observability report. Use this skill to track task statuses, identify blocked or stale lanes, and get a high-level view of harness activity."
---

# Harness Dashboard (Observability)

## Purpose
The Harness Dashboard provides a bird's-eye view of agentic activity across the workspace. It helps identify blocked tasks, stale lanes, and overall completion metrics.

## Process
1. Run the Python generation script:
   ```bash
   python scripts/maintenance/generate_session_pulse.py
   ```
2. **Analysis**:
   - Review the generated output.
   - Note any tasks that have been "open" but stale for > 7 days.
   - Note the ratio of completed epics vs. open epics.
3. **Action**:
   - Propose an intervention if there are too many blocked tasks (e.g., "Would you like me to resolve the blockers on the Lead Discovery epic?").
   - Suggest pruning or cancelling stale tasks.

## When to Invoke
- At the start of a new working day.
- When the user asks "What are we working on?" or "What's the status?"
- If the agent feels like it has lost the thread of the current high-level objective.