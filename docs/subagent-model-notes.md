## Subagent Model Notes

### Purpose

- Track empirical behavior of non-OpenAI subagent models while doing real harness work.
- Record strengths, weaknesses, trust level, and suggested task roles.
- Use these notes to guide future model routing for planning, synthesis, review, and retrieval-related work.

### Operating Rules

- Do not assume one bad result means a model is universally bad.
- Do not promote a model to repo-grounded work until it demonstrates factual grounding.
- Prefer natural evaluation during real tasks over synthetic benchmark theater.
- Separate transport/routing success from behavioral quality.

### Evaluation Dimensions

- Repo grounding
- Terse compliance
- Structured output discipline
- Hallucination resistance
- Planning usefulness
- Synthesis quality
- Adversarial usefulness
- Compression quality

### Current Notes

#### `opencode/minimax-m2.5-free`

- Status: alive and responsive in orchestration.
- Evidence: completed a short liveness probe successfully.
- Observed behavior:
  - completed the task
  - output felt generic/templatey on a very small prompt
- Current trust:
  - transport/routing: confirmed
  - repo-grounded quality: not yet proven
- Suggested next tests:
  - bounded planning
  - short structured synthesis
  - repo-grounded inspection with explicit local-only constraints

#### `opencode/big-pickle`

- Status: responsive, but failed repo-grounded review.
- Evidence: when asked to review the retrieval scaffold in this repo, it returned a fact artifact referencing unrelated files such as `scripts/maintenance/semantic_search.py`, `oc_supervisor.py`, and `bootstrap_leadops_sqlite.py`.
- Observed behavior:
  - strong repo-grounding failure
  - likely context bleed or hallucinated codebase substitution
- Current trust:
  - repo-grounded analysis: untrusted
  - brainstorming / broad synthesis / speculative roles: still possible candidates
- Suggested next tests:
  - non-grounded ideation
  - compression of already-vetted material
  - adversarial alternative generation

#### `opencode/nemotron-3-super-free`

- Status: not yet meaningfully evaluated.
- Current trust: unknown.
- Suggested next tests:
  - bounded synthesis
  - critique of a concrete plan

#### `opencode/mimo-v2-pro-free`

- Status: not yet meaningfully evaluated.
- Current trust: unknown.
- Suggested next tests:
  - short structured planning
  - retrieval-policy comparison synthesis

#### `opencode/mimo-v2-omni-free`

- Status: not yet meaningfully evaluated.
- Current trust: unknown.
- Suggested next tests:
  - summarization
  - short exploratory planning

### Routing Guidance So Far

- Do not use `opencode/big-pickle` for repo-grounded implementation review right now.
- Keep testing `opencode/minimax-m2.5-free` under tighter prompts before judging it.
- Treat all unproven free models as experimental until they show local grounding and low hallucination rate.

### Notes for Retrieval Work

- The retrieval implementation project is a good natural benchmark ground because it includes:
  - schema design
  - service wiring
  - planning
  - synthesis
  - repo-grounded review
- Model-role fit should eventually feed back into semantic routing and task delegation policy.
