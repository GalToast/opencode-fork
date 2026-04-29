---
name: remote-edit-preservation
description: "Safe remote file edits over SSH/SCP with server + local backups, staging copies, atomic swaps, verification checks, and change logging. Use when modifying live server files (e.g., .htaccess, configs) and you need easy rollback and preservation."
---

# Remote Edit Preservation (Opencode)

## Workflow
1. Identify host alias and target file path.
2. Create a server-side backup with a timestamped suffix.
3. Pull the file into ops/remote-backups/ and copy to ops/remote-staging/ for edits.
4. Edit the staged copy locally.
5. Upload as .new to the server.
6. Atomically swap .new into place (mv).
7. Verify the change (curl headers or page check).
8. Log the change in ops/remote-changes.md.

## Conventions
- Timestamp format: YYYYMMDD-HHMM
- Keep local backups committed to git.
- Prefer atomic rename over in-place edits.
- For McCullough Digital domains, keep backups and staging under ops/remote-backups/mccullough.digital* and ops/remote-staging/mccullough.digital*.
- For client sites, use a separate namespace: ops/remote-backups/clients/<client-slug>/<host-alias>/ and ops/remote-staging/clients/<client-slug>/<host-alias>/.

## Rollback
- Restore server backup: mv <file>.bak-<timestamp> <file>
- Restore local backup from ops/remote-backups/
