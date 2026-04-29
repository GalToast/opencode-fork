---
name: batch-audit-stats
description: "Compute batch worklist and profile stats for lead audits, including kept vs skipped/excluded, website/email coverage, duplicates, and audited vs unaudited counts. Use when asked for batch progress, completion status, or count breakdowns."
---

# Batch Audit Stats (Opencode)

## Overview
Generate a clean, repeatable stats summary for a batch using the worklist and lead profiles.

## Quick Start
Run the stats script from the repo root:

```bash
python "$env:USERPROFILE\.codex\skills\batch-audit-stats\scripts\compute_batch_stats.py" --worklist <path-to-worklist> --root <repo-root> --batch-id 003
```

## Workflow
1. Identify the batch worklist file (for example, `leads/batches/registered-entities-batch-003-worklist.md`).
2. Run the script with the worklist path and repo root.
3. If a batch id is available, pass `--batch-id` to include profile-based counts.
4. Use the output to answer: kept vs skipped/excluded, website/email coverage, duplicates, and audit completion.

## Notes
- Worklist stats are authoritative for kept vs skipped/excluded.
- Email counts from profiles should only include verified inboxes (must contain `@`).
- Do not count "contact form only" as an email.
