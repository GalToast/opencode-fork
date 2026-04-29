# Fred's OpenCode Fork — Custom Skills & Semantic Substrate

This is a fork of [OpenCode](https://github.com/anomalyco/opencode) with Fred McCullough's custom additions.

## What's Here

### Custom Skills (54 files)
Fred's custom skill suite in `opencode-skills/`:

**AI & Automation**
- `batch-audit-stats.md` — batch audit statistics and analysis
- `deep-security-audit.md` — security audit workflows
- `doc-coauthoring.md` — document collaboration
- `content-repurpose.md` — content repurposing pipelines
- `contact-log-sync.md` — contact synchronization

**Engineering**
- `algorithmic-art.md` — algorithmic/art generation workflows
- `canvas-design.md` — canvas/design system work
- `frontend-design.md` — frontend design implementation
- `brand-guidelines.md` — brand consistency tooling

**Operations**
- `client-onboarding.md` — client onboarding automation
- `drive-client-sync.md` — Google Drive sync
- `hostinger-mail-drafts.md` — mail draft generation
- `first-contact-drafts.md` — initial outreach drafts
- `followup-nonresponders.md` — follow-up sequencing

**Profile & Research**
- `fred-profile.md` — profile management
- `harness-dashboard.md` — harness monitoring

See all 54 skills in `opencode-skills/`.

### Custom Launcher
`opencode-steer.ps1` — Fred's PowerShell launcher with:
- Multi-runtime support (Bun, Node, .opencode harness)
- SearXNG integration for private search
- Parallel tool execution by default
- Mutable worker mode for dynamic agent updates

## Semantic Substrate (described in OpenCode context)

The fork includes integration work for:
- **Dual embedding lanes** — fast (Qwen3-Embedding-0.6B) and quality (Qwen3-Embedding-4B) retrieval
- **Policy-switchable retrieval** — metadata prefilter → embedding search → rerank → outcome weighting
- **Adaptive routing** — multi-model orchestration across providers
- **MCP server building** — Model Context Protocol integration
- **Semantic RAG** — LanceDB + sentence-transformers pipeline
- **HITL profile learning** — human-in-the-loop profile adaptation

## Usage

Add skills from `opencode-skills/` to your OpenCode installation's skills directory.

```powershell
# Clone the fork
git clone https://github.com/GalToast/opencode-fork

# Use the custom launcher
.\opencode-steer.ps1
```

## Background

This fork was built during Fred's AI automation engineering work at McCullough Digital, focused on multi-model orchestration, browser automation at scale, and lead intelligence pipelines.
