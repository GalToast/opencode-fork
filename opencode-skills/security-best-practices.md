---
name: "security-best-practices"
description: "Perform language and framework specific security best-practice reviews and suggest improvements. Trigger only when the user explicitly requests security best practices guidance, a security review/report, or secure-by-default coding help."
---

# Security Best Practices (Opencode)

## Overview
This skill provides language and framework specific security guidance. Use only when explicitly requested.

## Workflow
1. Identify all languages and frameworks in the project scope.
2. Check for relevant security guidance in skill references.
3. Use information to write secure code or detect vulnerabilities passively.
4. If asked for a security report, produce a prioritized markdown report.

## Modes
1. **Write secure code**: Use best practices for new code.
2. **Passive detection**: Flag critical vulnerabilities while working.
3. **Full report**: Produce a detailed security report with severity levels.

## Report Format
- Executive summary
- Severity-ordered sections (Critical, High, Medium, Low)
- Line numbers for referenced code
- Offer fixes after report

## General Advice
- Avoid auto-incrementing IDs for public resources; use UUIDs
- Be careful about TLS in dev environments
- Don't recommend HSTS without understanding full impacts
