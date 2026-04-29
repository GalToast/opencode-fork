---
name: "security-threat-model"
description: "Repository-grounded threat modeling: enumerate trust boundaries, assets, attacker capabilities, abuse paths, and mitigations. Trigger only when explicitly asked for threat modeling."
---

# Threat Model (Opencode)

## Quick Start
1. Collect inputs: repo path, deployment model, auth expectations
2. Extract system model: components, data stores, external integrations
3. Derive boundaries, assets, entry points
4. Calibrate assets and attacker capabilities
5. Enumerate threats as abuse paths
6. Prioritize with likelihood x impact
7. Validate with user
8. Recommend mitigations

## Risk Guidance
- High: pre-auth RCE, auth bypass, cross-tenant access, data exfiltration
- Medium: targeted DoS, partial data exposure, rate-limit bypass
- Low: low-sensitivity info leaks, noisy DoS

## Output
Write to `<repo-name>-threat-model.md`
