---
name: site-audit-mobile
description: "Mobile-only website audit workflow: manual checks, console errors, security headers, and Lighthouse mobile. Use when asked to audit a site or build a lead profile audit."
---

# Site Audit (Mobile) (Opencode)

## Overview
Run a mobile-first audit and capture the biggest issues first, with evidence and clear severity ordering.

## Workflow
1. Use Chrome DevTools for non-login pages when available. Use Playwright only when explicitly requested.
2. Page sweep (mobile):
   - Required: Home, Contact, Services, and any Booking or Quote flow.
   - If location pages exist, check at least one location page.
   - Coverage rule (middle path):
     - If the site is small (<= 10 public pages), check all public pages.
     - If the site is larger, cap at 10-15 pages using sitemap + main nav + one deep service page.
   - If any required pages are missing, note it explicitly.
3. Mobile checks:
   - Verify a valid viewport meta tag.
   - Test key flows (contact, booking, checkout).
   - Confirm contact forms are visible and usable on mobile (not hidden or collapsed).
   - Contact form quick check (no submission):
     - Trigger client-side validation with empty required fields or an invalid email to confirm errors appear.
     - Confirm submit button is clickable and not blocked by overlays or sticky elements.
     - Check the form action targets HTTPS and note any mixed content or third-party embeds that fail to load.
     - Watch for console errors during form interaction (focus, validation, submit click).
   - Comprehensive form test (when requested):
     - Submit exactly one test submission per lead form using placeholder data.
     - Keep placeholder data generic and non-sensitive (e.g., Test User, test@example.com, 000-000-0000, short test message).
     - Capture the confirmation/thank-you state (or error) and note any captcha/anti-spam blockers.
     - Do not submit more than once per form.
   - Check for horizontal overflow, clipped content, or elements that overlap or run off screen.
   - Note layout issues, broken links, or blocked forms.
4. Console and security:
   - Capture console errors and warnings on Home and Contact at minimum.
   - If other pages show distinct errors, note them separately.
   - Check security headers (CSP, HSTS, X-Frame-Options, etc.).
   - On Windows, prefer `curl.exe -I -L <url>` to avoid PowerShell alias issues.
5. Lighthouse (mobile, unthrottled): run with `throttling-method=provided` and record LCP, FCP, TBT, CLS, and the category scores.
6. Write findings in severity order: giant -> big -> medium -> small.
7. Save evidence in `leads/profiles/<range>/<id-slug>/evidence/` and reference in the profile.

## Reporting
- Use the biggest issue as the outreach hook.
- If mobile speed is cited, use the 53% over-3s stat and mention around 50% of traffic is mobile.
