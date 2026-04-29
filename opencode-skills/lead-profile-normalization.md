---
name: lead-profile-normalization
description: "Normalize lead profile headers, statuses, and worklist paths (including disqualified moves and duplicate handling) and regenerate lead views. Use when asked to normalize or reconcile lead profiles for batches."
---

# Lead Profile Normalization (Opencode)

## Use This When
- You are asked to normalize or reconcile lead profiles.
- You need to align profile headers with worklists, move disqualified leads, or fix status/outreach fields.
- You need to regenerate lead views after manual edits.

## Workflow
1. Identify the target batch and ID range.
2. Read the worklist line for each ID to capture source, address, distance, NAICS, email, phone, website, and notes.
3. Locate the profile:
   - Active: `leads/profiles/<range>/<id-slug>/profile.md`
   - Disqualified: `leads/disqualified/<range>/<id-slug>/profile.md`
4. If the worklist marks a lead as disqualified, move the folder to the disqualified path and normalize the header.
5. Normalize the header to the standard field order (see template below).
6. Update the Information section so Status/Outreach status/Contact path match the header.
7. Update the worklist line to include the profile path.
8. If reconciling Hostinger Drafts/Sent, run IMAP export first: `python scripts/maintenance/imap_export_hostinger.py`.
9. Regenerate views with `python scripts/generate-lead-views.py` after a batch of edits.

## Header Template (Standard Order)
```
Status: <status>
Outreach status: <outreach status>
Contact path: <contact path>
Contact search: <contact search>
Social check: <unknown|checked>
Batch: <batch>
Batch line: <line>
Source: <source>
Address: <address>
Phone: <phone>
Email: <email>
Website: <website>
Contact form: <contact form>
Social media: <social media>
NAICS: <naics>
Distance (zip centroid): <distance>
Decision maker: <decision maker>
Last updated: <YYYY-MM-DD>
```

## Status Rules
- `disqualified`: no verified public presence, residential/holding entity, or out of scope.
- `draft-prepared`: outreach drafted but not sent. Keep `Outreach status: drafted`.
- `complete`: outreach sent/replied/bounced.
- `ready`: contactable (email, phone, form, or social) but no draft yet.
- `research`: identity unclear or possible mismatch; preserve nuance and add notes.

## Contact Path Rules
- `email`: verified email contains `@`.
- `phone-only`: phone exists but no verified email.
- `form`: contact form exists but no verified email.
- `social`: social profile exists but no email/form/phone.
- `unknown`: no verified path.

## Contact Search Rules
- `not started`: research has not begun.
- `checked YYYY-MM-DD`: a contact method was found.
- `not found`: research completed with no contact methods.

## Email Normalization
- Require `@` in any email; otherwise set `Email: unknown`.

## Duplicate Handling
- If a worklist line says "duplicate of <ID>", do not create a new profile.
- Keep the primary profile only; note the duplicate in the worklist.
- If a duplicate profile folder exists, remove it only with user approval.

## Disqualified Move Check
- After moving a profile, ensure there is no nested duplicate folder left behind.

## Regenerate Views
- After edits, run `python scripts/generate-lead-views.py` and note that views are refreshed.
