---
name: drive-client-sync
description: "Sync client materials to Google Drive: create client folder, client-profile.md, copy PDFs/assets, and move to Disqualified when needed. Use when asked to create/update Drive client folders."
---

# Drive Client Sync (Opencode)

## Overview
Create or update a Google Drive client folder that mirrors repo status and key files.

## Workflow
1. Create folder
   - `G:\My Drive\Business\Clients\<Client Name>`
2. Create `client-profile.md`
   - Summary, key contacts, scope, payment terms, cadence
   - List files and repo references
3. Copy files
   - Agreement/SOW PDFs
   - Optional: scope doc, screenshots, videos
4. Disqualified flow
   - Move to `Clients\Disqualified\<Client Name>`
   - Update `client-profile.md` to mark disqualified

## Outputs
- Drive client folder with profile + PDFs
- Disqualified folder (if applicable)
