---
name: hostinger-mail-drafts
description: "Create or edit Hostinger Mail drafts (no sending). Use when asked to draft or QA emails inside Hostinger Mail."
---

# Hostinger Mail Drafts (Opencode)

## Overview
Create and edit Hostinger Mail drafts without sending. Default to IMAP-grounded QA and drift checks; only open the UI when we need to change content.

## Workflow
1. Ground truth via IMAP first.
   - Export indexes: `python scripts/maintenance/imap_export_hostinger.py --user <mailbox> --out-dir tmp --drafts-folder INBOX.Drafts --sent-folder INBOX.Sent`
   - Run QA: `python scripts/maintenance/qa_hostinger_drafts_from_imap.py --user <mailbox>`
2. Fixes, in priority order:
   - Signature hyperlinks (batch-safe via IMAP):
     - Run: `python scripts/maintenance/fix_draft_signature_links_via_imap.py --user <mailbox>`
     - This recreates drafts (APPEND) and moves originals to Trash, with `.eml` backups under `tmp/drafts-backups-YYYY-MM-DD/`.
   - Content edits (copy, tone, claims, formatting):
     - Use Playwright UI for the specific flagged drafts only.
3. Verification pass:
   - Re-run IMAP export + QA and confirm flags are gone (or reduced to only the truly-content-related ones).
4. Never send without explicit approval.

## QA
- Prefer IMAP QA output as truth. The Hostinger UI can auto-link text, which is not the same as a real hyperlink in the stored HTML.
- Signature link check: a real `<a href="https://mccullough.digital">...` anchor must exist in the draft HTML.
- Remove em-dash/en-dash characters (use periods/commas).
- Verify claims:
  - First check the mapped lead `profile.md` and any evidence.
  - If not corroborated, either verify quickly or soften wording so it stays unquestionably true.
- For large batches: IMAP extract -> QA -> fix via IMAP/UI -> re-QA.
