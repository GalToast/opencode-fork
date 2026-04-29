---
name: contact-log-sync
description: "Synchronize outreach actions with repo logs and lead status. Use when emails, forms, or DMs were sent and logs or lead profiles need updating."
---

# Contact Log Sync (Opencode)

## Overview
Use this workflow to reconcile outreach actions with the contact log, lead profiles, and leads.md so status and dates stay consistent.

## Workflow
1. Collect facts for each outreach action.
   Capture lead name, channel, status, date, recipient, and subject. Use local time for the date.
2. Update outreach/logs/contact-log.md.
   Add one row per outreach action with clear notes. Keep it concise.
3. Update the lead profile.
   Add or extend an Outreach log table with date, channel, status, and notes.
4. Update leads.md.
   Set Status to contacted, bounced, phone-only, or disqualified as appropriate. Update the Updated timestamp.
5. Update missing-drafts.md if the lead appears there.
   Mirror the new status and Updated timestamp.

## Notes
- If a lead has no folder, still log the action in outreach/logs/contact-log.md.
- Do not send any messages in this skill. This is logging only.
- No em dashes in notes.
