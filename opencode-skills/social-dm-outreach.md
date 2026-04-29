---
name: social-dm-outreach
description: "Send first-contact outreach via Facebook or Instagram DMs for leads without verified email, or with broken or parked sites. Use when asked to message leads on social platforms, verify official pages, and log outreach."
---

# Social DM Outreach (Opencode)

## Overview
Send first contact DMs via Facebook or Instagram with strict page verification, business profile confirmation, and logging.

## Workflow
1. Identify the lead and the approved contact path.
   - Read the lead profile and the queue.
   - Skip if the lead should be held for manual review (identity mismatch, location mismatch, phone mismatch, closed listing).
   - If a working email exists and was used, do not DM unless the user asks.
2. Pick platform.
   - Prefer Facebook page DMs.
   - Use Instagram if Facebook messaging is disabled.
3. Verify the page is official.
   - Check for an "Unofficial Page" label.
   - Confirm the website link, address, and phone match the lead profile.
   - If unsure or a dupe, stop and ask.
4. Confirm sending profile.
   - Open the profile switcher and confirm McCullough Digital is active.
   - On the page, verify any composer shows "Comment as McCullough Digital" or similar.
5. Draft the DM.
   - Use the matching draft from outreach/drafts/.
   - Ensure the message mentions the bounce when applicable and includes the key issue.
   - Do not use em dashes.
6. Send only after approval.
   - Show the final DM to the user and ask for approval.
   - Click Send only after explicit approval.
7. Log the outreach.
   - Update leads/profiles/<range>/<id-slug>/profile.md with date, channel, status, and notes.
   - Add a row to outreach/logs/contact-log.md.
   - Check off the queue item in outreach/queues/.
   - Update leads.md status if the lead is in leads.md.

## Files and references
- Lead profiles: leads/profiles/<range>/<id-slug>/profile.md
- Drafts: outreach/drafts/batch-001-002-first-contact.md, outreach/drafts/legacy-leads-first-contact.md
- Queues: outreach/queues/no-email-send-queue-2026-01-27.md and outreach/queues/batch-001-002.md
- Log: outreach/logs/contact-log.md
