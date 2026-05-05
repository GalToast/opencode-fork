# TUI Effects Audit

This is the current audit of the "living terminal organism" system in the session TUI.

It is meant to answer four questions:

1. What did we actually implement?
2. What is definitely wired and reachable?
3. What is still under-wired or too subtle?
4. What should we check next before adding more effects?

## Core Organism

Primary implementation:

- [spinner.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/component/spinner.tsx)

What exists there now:

- Signal modes:
  - `dispatching`
  - `processing`
  - `thinking`
  - `waiting`
  - `responding`
  - `idle`
  - `stalled`
  - `settled`
- Signal dimensions:
  - `pressure`: `cool`, `warm`, `hot`
  - `intensity`: `calm`, `active`, `crowded`, `stressed`
  - `attention`: `inward`, `outward`, `forward`, `suspended`
- Animation layers:
  - body
  - rail
  - aura
  - shell
  - atmosphere
- Transition animation:
  - dedicated transition frames between mode changes
- Event overlays:
  - `interrupt`
  - `subagent_return`
  - `accepted_baton`
  - `compaction_handoff`
  - `recovery`
- Special beats:
  - `waiting`
  - `responding`
  - `idle`
  - `stalled`
- Environmental modifiers:
  - pressure changes accents
  - intensity alters rails
  - child count adds orbit markers
  - special beat frequency reacts to pressure/intensity/child count
- Layout stabilization:
  - fixed computed stage width to prevent shell reflow

## Signal Consumers

### Header

- [header.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/header.tsx)
- Uses:
  - `ThinkingIndicator`
  - shell weather tint
  - shell border tint
  - named event badge

Current inputs:

- context pressure
- child count
- thinking state
- recent shell event

### Footer

- [footer.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/footer.tsx)
- Uses:
  - organism rail
  - rail state chip
  - atmosphere chip
  - status chips

Current inputs:

- session error state
- active subagent count
- inbox/steer rail state
- recent shell event

### Sidebar Masthead

- [sidebar.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx)
- Uses:
  - organism rail
  - weather tint
  - weather label
  - event badge

Current inputs:

- active subagents
- workgraph activity
- tracker blocked state
- MCP issue count
- recent shell event

### Transcript Activity

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- Uses:
  - activity organism
  - transcript weather background
  - transcript weather border
  - explicit activity labels

Current inputs:

- running tool
- pending tool
- reasoning presence
- text presence
- stalled elapsed time
- wait preemption
- compaction part presence
- completed task-tool assistant turn

## Shared Event Bridge

Shared event derivation:

- [shell-signal.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/shell-signal.ts)

Current derived events:

- `accepted_baton`
  - when `awaitingPromotion` is true
- `interrupt`
  - when the most recent relevant assistant turn is an aborted task-only wait
- `compaction_handoff`
  - when recent message parts include compaction
- `subagent_return`
  - when a completed assistant turn included the task tool
- `recovery`
  - when session state is `error` and no fresher event wins

Named event descriptors:

- `baton ignition`
- `ghost handoff`
- `worker return`
- `wait recoil`
- `signal recovery`

Focused regression coverage:

- [shell-signal.test.ts](/C:/Users/HP/repos/opencode/packages/opencode/test/cli/shell-signal.test.ts)

## Confirmed Reachable

These are confirmed as implemented and logically reachable:

### Event overlays

- `accepted_baton`
- `interrupt`
- `compaction_handoff`
- `subagent_return`
- `recovery`

### Transcript activity states

- `PROCESSING`
- `DISPATCHING`
- `THINKING`
- `WAITING`
- `RESPONDING`
- `WARMING`
- `STALL RISK`
- `SETTLED`

### Shell weather reactions

- header tinting
- footer pulse background
- sidebar masthead tinting
- transcript activity weather

## Under-Wired Or Under-Visible

These are the current weak areas.

### 1. Rare events

These may work but are naturally uncommon in ordinary use:

- `accepted_baton`
- `compaction_handoff`
- `recovery`

Risk:

- users may interpret them as broken even when they are technically fine

### 2. Low-contrast moods

These exist, but can feel too subtle:

- `idle`
- `settled`
- some special beats

Risk:

- the organism reads as "nice animation" instead of a clearly different mood

### 3. Environmental memory is still shallow

Current environment inputs are good but still mostly instantaneous:

- pressure
- intensity
- child count
- recent event

Missing or weak:

- event decay over time
- pressure accumulation
- retry heat accumulation
- interruption fatigue
- congestion memory
- cooling/recovery arcs

Risk:

- the shell feels reactive, but not yet truly sentient or moodful over time

### 4. Footer/header/sidebar are improved, but still less expressive than the transcript

Transcript wiring is currently the strongest part of the system.

Risk:

- the message flow feels alive, but the shell chrome can still feel secondary

## Layout/UX Risks Already Fixed

These were real problems and have already been addressed:

- variable-width organism frames caused layout thrash
- footer crash from `rootSessionID` initialization order
- footer event miswire for `subagent_return`
- extra spacer row above prompt
- jump-to-latest button consuming its own row
- prompt helper rows burning too much vertical space

## Current Verification

Most recent clean lanes:

- `bun test test/cli/shell-signal.test.ts test/cli/orchestration.test.ts test/cli/prompt-focus.test.ts test/cli/prompt-submit.test.ts --timeout 30000`
- `bun x tsc -p tsconfig.json --noEmit`

## Recommended Next Checks

### Reachability

For each of these, verify a real session path can trigger them on demand:

- `accepted_baton`
- `compaction_handoff`
- `subagent_return`
- `interrupt`
- `recovery`

### Visibility

Check whether these feel obviously different in live use:

- `idle` vs `settled`
- `thinking` vs `waiting`
- `dispatching` vs `processing`
- `stalled` vs `recovery`

### Environmental response

Check whether the organism should additionally react to:

- repeated retries
- long waiting durations
- repeated interrupts
- swarm congestion over time
- post-event cooldowns

## Next High-Value Improvements

If we continue from here, the most valuable additions are:

1. Time-decaying global blooms for major events
2. Pressure accumulation or cooldown memory
3. Stronger emotional separation for subtle moods
4. A live trigger checklist so each event can be intentionally demoed

## Practical Summary

The organism is real.

The transcript is the strongest expression of it.

The shell chrome is now much better wired than before.

The biggest remaining gap is not missing implementation so much as missing temporal memory and stronger visibility for subtle or rare states.
