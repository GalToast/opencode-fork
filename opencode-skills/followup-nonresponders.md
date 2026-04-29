---
name: followup-nonresponders
description: "Draft follow-ups for non-responders from a specific send window (draft-only, deduped against Re: in Sent and Drafts)."
---

# Follow Up Non-Responders (Opencode)

## Overview
Draft follow-ups for non-responders in a specific date window without double-sending or following up on closed loops.

## Scope Rules
- Default scope: last week only (not this week).
- Use explicit calendar dates when there is any ambiguity.
- Ask before running long multi-page scans.

## Workflow
1. Open Hostinger Mail in Playwright and go to Sent.
2. Identify the target date window (for example, Jan 22 to Jan 23, 2026).
3. Gather candidate originals:
   - Prefer non-"Re:" subjects as starting points.
   - Include leads where no reply is visible.
4. Dedupe before drafting:
   - Check Sent for any "Re:" already sent to that recipient.
   - Check Drafts for an existing "Re:" follow-up draft.
   - If either exists, skip.
5. Skip obvious closed loops:
   - Bounces, corporate redirects, scams, or "do not contact" signals.
6. Draft the follow-up:
   - Open the original message.
   - Use Forward to keep context, then set the recipient and subject to "Re: <original subject>".
   - Insert follow-up text at the top of the body.
   - Do not use editor fill on forwarded drafts; click body -> Control+Home -> type.
   - Hyperlink "McCullough Digital" via the Add link UI.
   - Save draft -> Close -> Reopen to verify.
7. Get sign-off early:
   - Ask the user to approve the first 1 to 2 follow-ups before drafting the rest.

## Quality Bar
- Soft, exploratory tone on follow-ups unless a severe issue is verified.
- No em dashes. Avoid AI phrasing and repetitive uncertainty language.
- Keep it short, specific, and easy to ignore.

## Rules
- Never send drafts.
- Do not draft follow-ups for the current week unless asked.
- Prefer the smallest safe scan that answers the question.
