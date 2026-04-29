---
name: deep-security-audit
description: "Deep, passive-first security audits for lead websites and forms. Use when you need comprehensive security checks beyond the mobile audit, including headers, cookies, TLS certs, DNS SPF/DMARC, mixed content, and light admin exposure probes. Always save evidence to leads/profiles/<range>/<id>/evidence and update the lead profile with severity-ordered findings."
---

# Deep Security Audit (Opencode)

## Overview
Run a comprehensive, passive-first security review with light probes only. Save evidence in the lead folder and summarize findings in the profile with severity ordered from giant to small.

## Workflow
1. Confirm scope.
2. Identify pages to check.
3. Run the automated audit script on each key page.
4. Review outputs and summarize security risks.
5. Save evidence and update the lead profile.

## 1. Confirm scope
- Only passive checks and light probes are allowed.
- Do not log in, submit forms, or run vulnerability scanners.
- Use the primary public URL for the business.

## 2. Identify pages to check
- Required: Home, Contact, Services, and any Booking or Quote flow.
- If location pages exist, check at least one location page.
- Coverage rule (middle path):
  - If the site is small (<= 10 public pages), check all public pages.
  - If the site is larger, cap at 10-15 pages using sitemap + main nav + one deep service page.
- If any of these pages are missing, note it explicitly.

## 3. Run the audit script
Run the script once per page using the page URL. Example:

```powershell
powershell -File "$env:USERPROFILE\.codex\skills\deep-security-audit\scripts\security_audit.ps1" `
  -Url "https://example.com" `
  -OutDir "leads\profiles\<range>\<id-slug>\evidence"
```

Artifacts created in the evidence folder:
- headers.txt
- security-headers-summary.txt
- cookies-summary.txt
- page.html
- mixed-content.txt
- form-findings.txt
- probe-status.txt
- http-redirect.txt
- tls-cert.json
- dns-records.txt
- email-auth.txt

## 4. Review outputs and summarize security risks
Interpret findings conservatively and avoid overclaiming. Typical checks:
- Missing security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- Cookies missing Secure, HttpOnly, or SameSite flags.
- HTTP assets loaded on HTTPS pages.
- Weak or missing HTTP to HTTPS redirect.
- Exposed admin/login endpoints (presence only, no access attempts).
- Missing SPF or DMARC records for email authentication.
- TLS cert issues (expired, near expiry, unexpected issuer).

Severity guidance:
- Giant: form posting over HTTP, expired cert, missing HTTPS redirect on a site with forms.
- Big: missing HSTS or CSP on a site with forms, mixed content in active forms.
- Medium: cookies without flags, missing X-Content-Type-Options or X-Frame-Options.
- Small: missing referrer or permissions policy, exposed admin endpoints that are properly protected.

## 5. Save evidence and update the profile
- Save or keep all artifacts in `leads/profiles/<range>/<id-slug>/evidence/`.
- Update `leads/profiles/<range>/<id-slug>/profile.md` with a severity-ordered list.
- Reference filenames in the profile notes.

## Notes
- This skill complements `site-audit-mobile`. Use both when a full audit is needed.
- Keep findings factual and reproducible.
