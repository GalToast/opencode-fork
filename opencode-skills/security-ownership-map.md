---
name: "security-ownership-map"
description: "Analyze git repositories to build a security ownership topology, compute bus factor, and identify orphaned sensitive code. Trigger only when explicitly requested for security ownership analysis."
---

# Security Ownership Map (Opencode)

## Overview
Build a bipartite graph of people and files from git history, compute ownership risk, and export graph artifacts.

## Requirements
- Python 3
- networkx

## Workflow
1. Scope repo and time window
2. Run ownership map script
3. Query outputs
4. Visualize

## Scripts
- run_ownership_map.py - builds the map
- query_ownership.py - queries results

## Common Queries
- Orphaned sensitive code: files with low bus factor + stale
- Hidden owners: people controlling high % of sensitive code
- Bus factor hotspots: sensitive files with bus factor <= 1
