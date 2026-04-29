---
name: lead-discovery
description: "Lead research and enrichment for local business lists: find websites, verified emails, socials, and contact forms, then update lead profiles/worklists/exclusions. Use when asked to build or enrich lead lists or verify contact info."
---

# Lead Discovery (Opencode)

## Overview
Build or enrich lead lists with verified contact details and evidence, then update the repo files consistently.

## Workflow
1. Confirm scope and filters (radius, exclusions, lead types, output format, batch IDs).
2. Read repo memory and the current batch/worklist files.
3. For each lead:
   - Verify the business name, address, and public presence.
   - Find website, socials, and a direct email if available.
   - If no email exists, record contact form only and keep phone if present.
   - Avoid paid APIs unless explicitly approved.
   - Email discovery checklist (quick pass, in order):
     - Official site: header/footer, Contact, About, Team, Locations, Privacy/Legal, and any PDF brochures.
     - If the site throws 5xx errors, try http vs https and www vs non-www, then log as unreachable and pivot to directories/socials.
     - Check page source for `mailto:` links or hidden emails (search for `@` in HTML).
     - If the site is WordPress, check exposed REST user metadata at `/wp-json/wp/v2/users` (and `?search=` when useful) for business contact emails/usernames; only mark as verified when clearly tied to the company/contact.
     - If a sitemap exists, crawl linked pages and scan raw HTML for hidden emails not visible on the page.
     - Capture any visible general inbox on the official site (info@, contact@, hello@) and note where it appears.
     - On-site search or `site:domain.com "@domain"` query for buried emails.
     - Check downloadable PDFs or brochures for contact emails.
     - Official socials (Facebook, LinkedIn, Instagram, YouTube) for visible emails or contact buttons.
     - Trusted directories (BBB, D&B, Manta, MapQuest, chamber, licensing boards).
     - If still no email: record "contact form only" and capture the form URL. Keep Email as "not found".
4. Update lead profile at `leads/profiles/<range>/<id-slug>/profile.md`:
   - Set Status, Last updated date, and Contact section.
   - Add notes on where the email was found.
5. Update batch worklist status and excluded list when disqualified.
6. If asked, produce a markdown output list of leads with required fields.

## Output conventions
- Only mark emails as verified if they appear on the site, official socials, or trusted listings.
- If only a contact form is found, label as "contact form only" in notes and store the form URL. Do not put "contact form only" in the Email field.
- Keep notes short and factual; link sources when available.
