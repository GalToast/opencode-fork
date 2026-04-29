---
name: montgomery-county-leads
description: "Process Montgomery County fresh business leads: qualify/disqualify, find contact info, verify websites, and create profiles. Use for the MCF-XXXX lead batch in leads/montgomery-county-fresh/."
---

# Montgomery County Lead Processing

## Scope
Process leads from `leads/bundles/montgomery-county-fresh-businesses-2026-03-05/county-fresh-leads-net-new-strict-v2.csv` (4,521 net-new leads).

## Tools Available
- **SearXNG MCP**: `searxng_websearch` - web search for finding business info
- **Playwright MCP**: Browser automation for site verification
- **WebFetch**: Fetch and parse web pages

## Workflow Per Lead

### 1. Quick Disqualification Check (SearXNG)
Before deep research, run a SearXNG search to identify obvious disqualifications:

```
searxng_websearch: "<business_name> <city> TX"
```

**Disqualify immediately if:**
- National/regional chain (e.g., "LA QUINTA INNS", "SPROUTS FARMERS MARKET")
- Property holding/real estate investment LLC with no public business presence
- Government entity
- Out of business/closed
- Residential address with no commercial activity

**Chain detection patterns:**
- Multiple locations across different states/cities with same branding
- Corporate/franchise websites with location finder
- Well-known national brand names

**Property holding LLC patterns:**
- Name contains: "HOLDINGS", "PROPERTIES", "INVESTMENTS", "REALTY" (combined with no commercial web presence)
- Registered agent address only, no business operations
- SIC/NAICS codes for holding companies (6794, 6798)

### 2. Website Discovery (SearXNG + Playwright)
If not disqualified, find the verified business website:

```
searxng_websearch: "<business_name> <city> TX website"
```

**Validation rules:**
- Website must be business-owned (not directory listings like Yelp, Facebook, BBB)
- Check the domain actually loads (Playwright snapshot)
- Verify it's the correct business (name/address match)

**Directory URLs to NOT store as Website:**
- facebook.com, instagram.com, linkedin.com, yelp.com, yellowpages.com
- manta.com, bbb.org, mapquest.com, bizapedia.com
- Wikipedia, news articles, government filings

### 3. Contact Discovery
Once website is verified, find contact methods in this priority order:

**A. On-site email search:**
- Check: header, footer, Contact page, About page, Team page
- Look for: info@, contact@, hello@, or named person emails
- Search page source for `mailto:` links
- For WordPress sites: check `/wp-json/wp/v2/users` for exposed user data

**B. Social media check:**
- Facebook business page (look for email in About section)
- LinkedIn company page
- Instagram (email in bio if present)

**C. Contact form:**
- If no email found but form exists, capture the form URL
- Note: "contact form only" in notes

**D. Phone:**
- Capture if found on website or verified directories
- Format: 10 digits without formatting (e.g., "8325551234")

### 4. Profile Creation
Create profile at: `leads/montgomery-county-fresh/profiles/<range>/<id-slug>/profile.md`

**ID ranges for MCF leads:**
- MCF-0001 to MCF-0099 → `MCF-0001-0099`
- MCF-0100 to MCF-0199 → `MCF-0100-0199`
- etc.

**Profile template:**
```
# <Business Name>

Status: <pending|ready|disqualified|research>
Outreach status: uncontacted
Contact path: <email|phone-only|form|social|unknown>
Contact search: <not started|checked YYYY-MM-DD|not found>
Social check: <not started|checked>
Batch: montgomery-county-fresh-001
Batch line: <MCF-XXXX>
Source: <from CSV>
Address: <full address>
Phone: <10 digits or unknown>
Email: <email or unknown>
Website: <verified URL or unknown>
Contact form: <form URL or unknown>
Social media: <URLs or unknown>
NAICS: <from CSV or unknown>
City: <city>
Decision maker: <unknown or name if found>
Last updated: YYYY-MM-DD

## Snapshot
- Brief description of business based on website/research.

## Observations
- Giant/Critical: <security issues, site down, legal issues>
- Big: <major issues>
- Medium: <notable issues>
- Small: <minor issues>

## Outreach angle
- Key issue or opportunity for first contact.

## Next steps
- What research or action is needed.

## Evidence
- List URLs checked with status codes.

## Notes
- Date-stamped notes about research findings.
```

### 5. Worklist Update
Update the worklist at `leads/montgomery-county-fresh/worklist-batch-XXX.md`:
- Change Status from `pending` to `ready` or `disqualified`
- Add Profile path for ready leads
- Update summary counts

### 6. Disqualified Tracking
Move disqualified leads to: `leads/montgomery-county-fresh/disqualified/<range>/<id-slug>/profile.md`

Include disqualification reason in profile:
```
Status: disqualified
Disqualification reason: <chain|property-holding|out-of-business|government|out-of-scope>
```

## SearXNG Query Patterns

**Business name + location:**
```
"<business_name>" <city> TX
```

**Website search:**
```
"<business_name>" <city> TX site
```

**Email hunt:**
```
"<business_name>" email contact
```

**Chain verification:**
```
"<business_name>" locations franchise
```

## Output Conventions
- Only mark email as verified if seen on official site/socials
- Phone numbers: 10 digits, no formatting
- Website: must be business-owned domain
- Contact form: capture full URL
- Note all sources in Evidence section
- Use `Get-Date` for accurate timestamps

## Batch Processing
Process leads in batches of 10-20 per session:
1. Read worklist batch file
2. For each pending lead:
   - SearXNG quick search
   - Disqualify or proceed to deep research
   - Create/update profile
   - Update worklist status
3. Commit progress after each batch

## Quality Checks
- Website must resolve (200 status)
- Email must contain @ and match domain when possible
- Address should match county records
- Business name should match or be clearly related
- Disqualifications should have documented evidence