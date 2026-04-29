---
name: memory-sync
description: "Maintain global and repo memory: read both, reconcile contradictions, and update Canonical Truths, Current Task, Blockers, Suggested Next Steps, and Rolling Log. Use when asked to amend/update memory or when a task finishes and durable facts or status changes should be recorded."
---

# Memory Sync (Opencode)

## Process
1. Read global memory and repo memory.
2. Identify new durable facts, preferences, environment details, or decisions from current work.
3. Check for conflicts with Canonical Truths. If a conflict exists, ask the user before changing the Canonical Truth.
4. Update Current Task, Suggested Next Steps, and Blockers when needed.
5. Append to Rolling Log, keep at most 20 entries, and fold stable items into Canonical Truths.
6. Update Last Cleanup when you prune or reorganize entries.
7. Never store secrets, passwords, access tokens, or sensitive personal data.

## Content rules
- Store facts and status only. Do not store step by step procedures.
- Keep entries short and specific.
- Use explicit dates.
