---
name: lead-exhaustion
description: "Exhaust lead contact methods in order email -> web form -> social -> phone, verify identity, and log outcomes. Use when asked to finish contacting leads or to determine remaining contact paths."
---

# Lead Exhaustion (Opencode)

## Overview
Use this workflow to contact each lead once via the best verified method in priority order and stop when no verified path remains.

## Workflow Decision Tree
1. Check current status.
   Review leads.md, the lead profile outreach log, and outreach/logs/contact-log.md. If a lead is already contacted, stop.
2. Verify identity.
   Compare business name, address, phone, and website. If there is a location mismatch, obvious dupe, or conflicting identity, hold for manual review and log as attempted or held.
3. Choose the contact path in this order.
   Email if a verified inbox exists. Use hostinger-mail-drafts for drafting and send only with approval.
   Web form if no email exists or the email bounced. Use Playwright and log blocked errors if submission fails.
   Social DM if no email or form exists. Use social-dm-outreach and confirm the official page plus McCullough Digital profile.
   Phone only if no other path exists. Mark phone-only unless the user explicitly asks to call or text.
4. Update logs and statuses.
   Add a row to outreach/logs/contact-log.md with date, channel, status, and notes.
   Update the lead profile outreach log.
   Update leads.md status and Updated timestamp.
   If the lead appears in missing-drafts.md, update the status and timestamp there too.

## Notes
- Do not send by a lower priority method if a higher priority method already succeeded unless the user asks.
- No em dashes in messages or notes.
