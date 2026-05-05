# TUI Chat-First UX Criteria

This document is the design bar for the OpenCode harness TUI.

It exists to answer one question:

- Does this change make the terminal feel more like a one-on-one conversation with a superintelligence and its minions, or does it make the product feel more like a dashboard?

If a proposed change does not improve that core experience, it should be questioned before implementation.

## Core Thesis

OpenCode should feel like:

- an intimate conversation
- a living terminal presence
- a cute, cheeky, slightly possessive synthetic intelligence
- a futuristic noir instrument with warmth and style

OpenCode should not feel like:

- a devtools cockpit first
- a wall of status counters
- a command center that competes with the chat
- a generic CLI with extra decorations

The transcript is the stage.

The sidebar, split view, and auxiliary surfaces are backstage tools.

Default stance:

- the sidebar should start collapsed by default
- the chat lane should remain primary and legible even in half-width or unusually narrow terminal sizes
- subagent session viewing and return-to-parent flow should work cleanly without depending on wide header chrome or sidebar affordances

## Primary Product Goal

The transcript must carry the experience.

The user should be able to stay in the chat and still understand:

- who is acting
- what is happening
- whether the system is thinking, acting, blocked, or returning
- when subagents are out working
- when a result has landed
- what matters right now

The user should not need a sidebar to understand the state of the interaction.

## Aesthetic Direction

The target blend is:

- kawaii
- cheeky
- tender
- eerie
- rain-soaked futuristic noir
- high-competence, low-anxiety

Short version:

- cute soul
- Blade Runner atmosphere
- surgical intelligence

## Non-Negotiable Experience Principles

### 1. Chat First

The transcript is the main interface, not merely the output log.

Must:

- prioritize transcript clarity over side-surface complexity
- make major state changes legible inside the conversation itself
- keep the prompt bay and reply flow emotionally central
- preserve a usable chat experience in narrow, half-width, and awkward terminal dimensions
- let the user enter a subagent conversation and return to the parent conversation cleanly

Should:

- let advanced users open rails and panels when they want them
- keep most users in the main chat lane most of the time

Must not:

- move critical understanding into a sidebar by default
- make the primary experience depend on split view
- assume wide-terminal layouts as the baseline experience
- hide parent/child session navigation behind width-dependent chrome alone

### 2. Presence Over Plumbing

The system should feel alive, not mechanical.

Must:

- render assistant state changes as expressive presence, not raw machinery
- make tools feel like extensions of intent
- make subagents feel like emissaries returning to a central mind

Should:

- use language and motion that imply agency, memory, and continuity
- reduce low-level implementation noise when it does not help the user

Must not:

- foreground internal plumbing just because it exists
- expose implementation details that feel like backend leakage

### 3. Immersion Without Confusion

The terminal can be lyrical, but it still has to be readable at speed.

Must:

- keep state changes understandable in under a second
- preserve hierarchy, spacing, and text contrast
- ensure effects reinforce meaning

Should:

- reward close attention with depth
- feel dramatic at the right moments

Must not:

- bury meaning in ornament
- make every turn equally theatrical

### 4. Selective Magic

The system should glow at meaningful moments, not all the time.

Must:

- reserve the strongest visual treatment for meaningful transitions
- preserve calm, low-noise default reading

Should:

- flare during ignition, search, tool execution, swarm dispatch, return, interruption, and closure

Must not:

- make idle states louder than active states
- run constant spectacle that numbs the user

## Transcript Criteria

### Turn Lifecycle

Assistant turns should feel like scenes, not blobs.

The transcript should distinguish:

- presence
- thinking
- acting
- dispatching
- waiting
- returning
- sealing

Success looks like:

- a user can sense where the assistant is in its cognitive loop without reading a status legend

### Tool Rendering

Tool calls should be represented as world interaction, not boring plumbing.

Must:

- make tool execution legible in context
- visually separate action from narration
- preserve transcript readability even during heavy tool use

Should:

- make shell, file edits, search, and web actions feel distinct
- compress repetitive tool noise

Must not:

- dump low-value raw tool chatter into the main reading path
- reduce the assistant to a stream of generic "called tool" rows

### Subagent Rendering

Subagents should feel like minions, scouts, or emissaries inside the chat.

Must:

- show launches and returns in the transcript
- make swarm behavior feel coordinated, not fragmented
- preserve the sense of a central intelligence orchestrating helpers

Should:

- give subagents compact personality and role distinction
- make returns feel satisfying and ceremonial

Must not:

- force users into a separate panel just to understand swarm activity
- make parallel work feel like disconnected side threads unless the user asked for that

### Transient State Moments

State cards in the transcript should be transient by default.

Must:

- appear because something changed, blocked, returned, or now needs consent
- cool and disappear once their meaning has been delivered
- persist only when the user must act or when the system is genuinely blocked

Should:

- behave like event moments, not a permanent summary deck
- fade out of prominence as soon as the transcript itself is carrying the story again

Must not:

- pin durable summary cards at the top of chat
- recreate the sidebar as a stack of persistent transcript cards
- keep non-blocking state visible just because it exists

### Graph Moments

Graph meaning may appear in the transcript only as event moments.

Must:

- translate graph structure into short human-readable moments such as blockers clearing, lanes opening, or branches converging
- emit these moments only when the underlying workflow meaning changes
- keep the full DAG or graph inspection backstage

Should:

- make workflow topology emotionally legible without requiring the user to read a graph
- disappear after the moment has landed unless action is still required

Must not:

- pin a full graph card into the transcript
- treat graph structure as a persistent chat surface
- use the transcript as a permanent topology browser

### Narrow-Width Labeling

Ceremonial transcript labels must collapse gracefully before they truncate badly.

Must:

- provide compact narrow-width variants for high-ceremony labels at the top of chat
- prefer a shorter intentional alias over raw ellipsis when width gets tight
- keep the top-of-chat state lane readable in half-width and awkward terminal sizes

Must not:

- rely on long all-caps labels that only look good in roomy terminals
- let the organism turn into chopped-off banner text under narrow widths

### Final Answer Moments

Final responses should feel sealed and intentional.

Must:

- create a sense of conclusion
- visually signal that the system has returned from action into direct conversation

Should:

- make strong answers feel calm, complete, and emotionally grounded

Must not:

- end major work with a visually flat landing

## Prompt Bay Criteria

The prompt composer is not just an input box. It is the ritual chamber.

Must:

- feel important and alive
- make sending feel deliberate
- support rich input without visual chaos

Should:

- preserve the emotional continuity between composing and receiving
- surface slash actions, file/image context, and retry states elegantly

Must not:

- feel like a generic form control
- overtake the transcript as the center of attention

## Sidebar And Secondary Surface Criteria

The sidebar and split surfaces are support tools, not the main show.

Must:

- remain optional in spirit, even if visible
- provide extra operator value without stealing attention from the transcript
- default to collapsed or otherwise low-attention states until explicitly opened
- make the collapsed state feel intentional and attractive, not hidden, broken, or apologetic

Should:

- help power users inspect state, tracker, and swarm topology
- compress complex operational data into quick glances

Must not:

- carry essential narrative state that belongs in the transcript
- become the emotional center of the application
- reduce the usable chat area below comfortable reading width by default
- be the only reliable place to open subagent sessions or escape back to the parent lane

## Visual Language Criteria

### Color

Must:

- support a noir-futuristic atmosphere
- maintain strong contrast and clear semantic meaning

Should:

- use neon and glow as accent, not wallpaper
- make warmth and danger feel different

Must not:

- wash the interface in constant saturated color
- make every state feel equally intense

### Motion

Must:

- communicate state, urgency, and mood
- feel smooth and intentional

Should:

- imply breathing, pulsing, ignition, cooling, return, and seal

Must not:

- jitter
- reflow the layout
- animate for no reason

### Typography And Copy Tone

Must:

- sound confident, warm, and slightly playful
- keep lines short enough for fast terminal reading

Should:

- blend tenderness and precision
- feel like a sentient system with style, not a slogan generator
- vary ceremonial nouns and verbs so repeated moments do not sound templated

Must not:

- become try-hard cyberpunk parody
- overwhelm technical clarity with flavor text

## Terminal Reality Criteria

We are designing for a terminal, not pretending it is a browser.

Must:

- respect terminal constraints
- prefer symbolic richness, spacing, timing, and color over fake web-like tricks
- maintain graceful behavior across different terminal environments

Should:

- use overlays, mouse support, clipboard, hyperlinks, and animation where they help
- exploit terminal strengths instead of apologizing for them

Must not:

- rely on features that only work in a narrow slice of emulators unless explicitly optional
- chase browser aesthetics at the expense of terminal elegance

## Feature Evaluation Rubric

When considering a TUI change, ask:

1. Does this make the transcript feel more alive or more bureaucratic?
2. Does this increase immersion without increasing confusion?
3. Does this help the user feel closer to the intelligence, or farther away behind machinery?
4. Does this belong in the transcript, or is it truly backstage information?
5. Is this effect expressive, or merely decorative?
6. Would this still feel cool after a week of heavy use?
7. Would this embarrass us in hindsight as over-designed or under-useful?

If the answer trends toward bureaucracy, clutter, or dashboardification, reject or redesign it.

## High-Value Outcomes

We are aiming for:

- transcript-first clarity
- stronger emotional continuity between thought, action, and response
- in-chat swarm choreography
- richer tool dramaturgy
- a distinct kawaii-noir personality
- less dependence on rails for comprehension

## Anti-Goals

We are not trying to build:

- a metrics-heavy operator console as the default experience
- a copy of Claude Code with different colors
- a "futuristic" interface that confuses the user
- a terminal packed with effects that do not improve feeling or comprehension

## Definition Of Success

The TUI succeeds when:

- the user wants to stay in the chat
- the conversation feels immersive and intelligent
- helpers feel real without becoming distracting
- the product feels more intimate than a dashboard and more alive than a normal CLI
- the style feels unique, memorable, and durable under daily use
- the chat still feels good in half-width, split-screen, or otherwise constrained terminals

## Working Rule

When transcript experience and auxiliary surfaces conflict, favor the transcript.

When style and clarity conflict, favor clarity.

When clarity is secure, push style hard.

## Implementation Roadmap

This roadmap translates the criteria into phased work tied to the current TUI code.

The sequencing principle is:

- improve the chat lane first
- wire dormant transcript-supporting features second
- expand backstage/operator surfaces only after the main conversation feels undeniable

### Phase 1: Strengthen The Transcript

Goal:

- make the core chat experience feel more alive, legible, and emotionally coherent without adding more layout complexity

User-visible outcome:

- the conversation itself feels richer, clearer, and more immersive even if the sidebar never opens

Primary work:

- unify assistant turn lifecycle presentation
- sharpen the distinction between thinking, acting, waiting, returning, and sealing
- improve in-chat tool rendering so actions feel intentional rather than mechanical
- make subagent launch and return moments feel like in-world events inside the transcript
- refine closure moments for strong final answers

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [shell-signal.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/shell-signal.ts)
- [spinner.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/component/spinner.tsx)
- [prompt-status.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/prompt-status.ts)
- [transcript.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts)
- [orchestration.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/orchestration.ts)

Success criteria:

- a user can understand the assistant's state from the transcript alone
- tool-heavy turns still feel elegant
- swarm activity reads as choreography, not clutter
- transcript chrome feels intentional, not random

Suggested tasks:

1. Audit every assistant turn state and collapse overlapping presentation modes.
2. Create a compact visual grammar for transcript scenes:
   - presence
   - thinking
   - action
   - swarm
   - return
   - seal
3. Replace generic tool rows with transcript-native action blocks.
4. Add stronger but selective "return" and "seal" moments for completed assistant turns.

### Phase 2: Make The Prompt Bay Feel Sacred

Goal:

- turn the composer into a more expressive ritual chamber without letting it overpower the transcript

User-visible outcome:

- writing, attaching context, and sending feel more intentional and premium

Primary work:

- refine prompt send states and submitted-preview handling
- improve slash command, image, and file attachment staging
- tighten validation and retry feedback so it feels graceful rather than operational
- create a cleaner emotional bridge between composition and response

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx)
- [autocomplete.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx)
- [prompt-submit.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/prompt-submit.ts)
- [clipboard.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/clipboard.ts)

Success criteria:

- sending a prompt feels deliberate and satisfying
- slash actions feel native, not bolted on
- image and file attachments feel like premium context objects
- retry and recovery states feel intelligent and reassuring

Suggested tasks:

1. Rework the submitted-preview strip to feel more ceremonial and less like a temp status row.
2. Style slash mode, shell mode, and attachment mode as distinct but related prompt states.
3. Revisit file and image attachment rendering for stronger in-composer presence.
4. Add better recovery choreography for retries and interrupted submits.

### Phase 3: Give Subagents A Stronger In-Chat Identity

Goal:

- make helpers feel real and useful inside the main conversation without fragmenting the user experience

User-visible outcome:

- the user feels like they are speaking to one central intelligence that can send out minions and pull them back in

Primary work:

- improve subagent launch copy and transcript arrival/return handling
- make helper identities and roles legible without bloating the screen
- create compact lane signatures that read emotionally as emissaries, not raw jobs

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [orchestration.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/orchestration.ts)
- [shell-signal.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/shell-signal.ts)
- [dialog-subagent.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-subagent.tsx)

Success criteria:

- the user understands when helpers are out working and when they return
- swarm behavior enhances the sense of intelligence
- subagent activity never feels like noisy parallel logs

Suggested tasks:

1. Define transcript-native subagent entrance, in-flight, and return patterns.
2. Create compact role signatures for explorer, worker, reviewer, and similar helper types.
3. Make "return" moments feel satisfying and clearly reintegrated into the main intelligence.

### Phase 4: Wire Dormant Or Half-Finished Transcript-Supporting Features

Goal:

- finish the pieces that can materially support the chat-first experience, while rejecting those that do not

User-visible outcome:

- fewer fake or half-real affordances
- features that exist feel fully alive

Primary work:

- decide whether to fully wire or remove dormant split-view paths
- decide whether drag-and-drop support is real or should stop being implied
- finish tracker DAG presentation only if it helps the conversation-oriented product

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [split-view.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/split-view.tsx)
- [split-view-tracker.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/split-view-tracker.tsx)
- [dialog-tracker.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-tracker.tsx)
- [tips-state.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/component/tips-state.ts)

Success criteria:

- no important feature feels fake
- no dormant feature keeps distorting product decisions
- side surfaces remain support tools, not accidental centerpieces

Suggested tasks:

1. Either fully mount `SplitView` or remove its default surfacing until it is real.
2. Either implement drag-and-drop properly or stop advertising it.
3. Finish tracker DAG only if it supports transcript-aware swarm comprehension.

Current audit snapshot:

- `SplitView` is currently a ghost path:
  - [split-view.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/split-view.tsx) is implemented
  - but the legacy control-panel surface is hard-disabled via `showLegacyControlPanels() === false`, so the feature is not meaningfully mounted in the user experience
  - update: the dead `split_view` state, toggle keybind surfacing, and command-palette entry have now been removed from [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [split-view-tracker.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/split-view-tracker.tsx) still exists as support structure, but it is downstream of the same dead mounting story
- this means split-view is currently distorting the architecture more than it is helping the product
- the strongest decision is likely:
  - either wire split-view back in later as explicit optional inspection
  - or keep it dormant until there is a real transcript-first reason to revive it
- clipboard-image paste is real in the prompt flow, but prompt-side drag-and-drop still does not have a clear end-to-end implementation path in the current TUI code
- update: the drag-and-drop tip has been removed from [tips-state.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/component/tips-state.ts) so the product no longer promises it before it exists
- local file-path attach is now a real prompt path:
  - pasted local file paths are normalized and attached as first-class file context
  - pasted image file paths attach as image context
  - multi-path paste is now handled more gracefully
- this means terminals that translate drop gestures into pasted file paths can now benefit from a polished attach path even though true drag events are still not part of the product contract

### Phase 5: Refine The Backstage Surfaces

Goal:

- make side surfaces feel premium and useful without competing with the chat

User-visible outcome:

- advanced panels feel like elegant instrumentation, not a second app

Primary work:

- simplify sidebar content to what is actually useful in the moment
- reduce dashboard-like clutter
- keep model, swarm, tracker, and surface information compact and glanceable

Target files:

- [sidebar.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx)
- [sidebar-state.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/sidebar-state.ts)
- [dialog-status.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/component/dialog-status.tsx)
- [dialog-mcp.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/component/dialog-mcp.tsx)

Success criteria:

- the sidebar adds confidence, not cognitive drag
- the user can ignore it without losing the core experience
- it feels like backstage instrumentation rather than the main product

Suggested tasks:

1. Remove low-value counters and labels that do not help moment-to-moment trust.
2. Tighten section hierarchy around swarm, model, blockers, and next move.
3. Make the sidebar read like a companion rail, not an admin surface.

Current audit snapshot:

- substantially complete
- the sidebar now defaults collapsed and reads more like backstage support than a second product
- the collapsed rail has been reduced heavily, but still needs final live acceptance in narrow widths
- the footer has been quieted, but remains the busiest non-chat surface and should be judged by live use rather than more abstract redesign
- the remaining work here is primarily acceptance testing and issue-driven refinement

### Phase 6: Productize Taste

Goal:

- turn the current aesthetic into configurable, durable product behavior rather than scattered hardcoded flavor

User-visible outcome:

- users can choose how expressive the terminal feels without breaking the identity

Primary work:

- expose more controlled presentation settings
- define style tiers instead of one fixed intensity
- keep the design system coherent across themes and modes

Target files:

- [tui-schema.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/config/tui-schema.ts)
- [theme.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/context/theme.tsx)
- [app.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/app.tsx)

Success criteria:

- style can be tuned without code edits
- expression remains coherent across themes
- users can choose restraint or flourish without losing product identity

Suggested tasks:

1. Add presentation controls such as:
   - motion intensity
   - transcript ceremony density
   - sidebar default visibility
   - compact versus expressive transcript chrome
2. Define supported style modes:
   - restrained
   - expressive
   - organism

Current audit snapshot:

- intentionally deferred
- the product is currently tuned toward the `organism` branch by design
- we have not yet exposed a formal style selector or taste controls in config
- this is a productization step, not a blocker for the current transcript-first redesign

## Priority Order

If we want the highest leverage sequence, do this:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6

## Decision Rule For Future Work

Before starting a TUI change, tag it as one of:

- transcript
- prompt
- swarm
- dormant feature
- backstage
- productization

If it is not transcript, prompt, or swarm work, it should justify itself against the chat-first thesis before it is prioritized.

## Backstage Decluttering Execution Sheet

This section turns the existing chat-first criteria into a concrete cleanup plan for sidebar, graph, tracker, and plan surfaces.

The rule is:

- if the user needs it to understand the current moment, move it into the transcript
- if it is useful only for inspection, keep it backstage
- if it does not materially improve trust, actionability, or comprehension, cut or demote it

### Current Backstage Surfaces In Code

Primary files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [sidebar.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx)
- [dialog-plan.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-plan.tsx)
- [dialog-tracker.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-tracker.tsx)
- [split-view.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/split-view.tsx)
- [split-view-tracker.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/split-view-tracker.tsx)

Current backstage categories in code:

- sidebar rail signal and climate summaries
- control-panel tabs for foreground, scheduler, graph, subagents, inbox, refresh
- planner preview and plan-state metadata
- tracker summary and DAG access
- workgraph summary and artifact/lane/objective counts
- split-view tracker preview

### Move Into Chat

These should become transcript-native by default because the user benefits from seeing them in the flow of conversation.

#### 1. Plan State

Current problem:

- plan state mostly lives in [dialog-plan.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-plan.tsx) and backstage summaries in [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- the user should not need to open a dialog to understand whether a plan exists, is pending, is approved, or is waiting on them

Move into chat:

- planner entering or exiting plan mode
- plan draft created
- plan awaiting approval
- approved plan now governing the work
- plan revised after user feedback

Transcript form:

- compact plan scene cards
- one-line "plan now governing this turn" badges near relevant assistant turns
- approval and revision moments rendered as conversational events, not file metadata

Keep backstage:

- raw plan file paths
- copy actions for plan paths
- detailed approval timestamps

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [dialog-plan.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-plan.tsx)

#### 2. Tracker Summary

Current problem:

- tracker understanding is split across sidebar summary, tracker dialog, and tool output
- the user should not need the sidebar just to know what is open, blocked, or actively being worked

Move into chat:

- task set created
- task blocked on dependency or skill
- task lane became active
- task lane resolved or closed
- significant tracker shifts like "all blockers cleared" or "plan collapsed to one active track"

Transcript form:

- compact tracker state cards
- in-chat "blocked", "unblocked", "active", "closed" turnlets
- periodic tracker compression summaries only when the state meaningfully changes

Keep backstage:

- full task list browser
- tracker path copy
- exhaustive per-task inventory

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [dialog-tracker.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-tracker.tsx)

#### 3. Swarm Topology

Current problem:

- we already moved a lot of swarm meaning into chat, but some topology still lives in backstage summaries and rail language
- users should feel the swarm in the transcript first and inspect it backstage only when curious

Move into chat:

- swarm dispatch
- active helper classes
- return and fold-in moments
- lane count only when it clarifies the scene

Keep backstage:

- full lane-by-lane roster
- detached session browsing
- scheduler diagnostics

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [sidebar.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx)

### Keep Backstage

These are legitimately backstage and should stay there, but become quieter and more glanceable.

#### 1. Full Workgraph / DAG Inspection

Keep backstage because:

- it is useful for power inspection
- it is not necessary for most users to understand the current conversation
- showing it by default risks dashboardification

Allowed surfaces:

- tracker dialog
- optional split view if ever fully wired
- explicit "visualize task graph" action

Constraint:

- the transcript should carry the meaning of the graph, while the dialog carries the structure

#### 2. Operator / Scheduler Diagnostics

Keep backstage because:

- reserve, confidence, scheduler lane counts, and similar operator summaries are implementation-adjacent
- they are only useful as confidence instrumentation for advanced users

Constraint:

- only surface them in chat when they imply a user-meaningful state such as blocked, waiting on approval, or recovering

#### 3. Raw Paths, Copy Helpers, And Metadata

Keep backstage because:

- plan path, tracker path, update timestamps, and similar metadata are utility details
- they are useful but not narrative

### Cut Or Demote

These should be reduced, hidden, or removed from default surfaces unless a strong use case emerges.

#### 1. Low-Value Counters

Examples:

- open/in-progress/blocked/closed counts shown with no immediate implication
- lane/objective/artifact totals shown without explaining why they matter now
- MCP connection totals in the same glance strip as user-relevant state

Why:

- they create dashboard texture without strengthening trust or action

Action:

- remove from default sidebar glance rows
- keep only when paired with a user-relevant sentence

#### 2. Graph As A Default Tab Identity

Current problem:

- `graph` is treated as a first-class control-panel tab in [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- this encourages the product to think in control-room terms

Action:

- demote graph from a default control-plane identity
- keep graph available through explicit tracker or visualize actions
- do not make graph the assumed daily-use surface

#### 3. Sidebar As A Trust Crutch

Current problem:

- if the sidebar is carrying "what matters now", the transcript is underperforming

Action:

- remove or rewrite sidebar rows whose only job is to compensate for transcript weakness
- after transcript-native replacements exist, simplify sidebar language to:
  - current atmosphere
  - current blockers
  - optional deep links to tracker or plan

### Concrete Execution Order

Do this in order:

1. Audit sidebar and control-panel rows and tag each one:
   - `move_to_chat`
   - `keep_backstage`
   - `cut_or_demote`
2. Add transcript-native plan-state moments.
3. Add transcript-native tracker-state moments.
4. Remove duplicate meaning from sidebar and control panels.
5. Demote graph-first framing in the control-panel area.
6. Tighten the remaining backstage rail into a glance-only companion surface.

### Suggested File-Level Work Split

#### Pass A: Plan And Tracker Meaning

Files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [dialog-plan.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-plan.tsx)
- [dialog-tracker.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-tracker.tsx)

Deliverable:

- the transcript communicates planning and tracking state without requiring dialogs

Progress snapshot:

- substantially complete
- transcript-native plan-state cards are now being surfaced in the prelude lane for:
  - planning
  - awaiting approval
  - approved-but-revising
- transcript-native tracker-state cards are now being surfaced in the prelude lane for:
  - blocked tracks
  - active tracks
- these transcript moments are now being corrected toward transient-by-default behavior instead of forming a persistent deck
- dialogs still exist as backstage inspection tooling, but the transcript is becoming the default place where the user learns what matters now
- remaining work is acceptance-oriented:
  - verify the moments feel right in live narrow-width use
  - trim any lingering copy density if the prelude starts feeling deck-like again

#### Pass B: Sidebar And Control-Panel Declutter

Files:

- [sidebar.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx)
- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)

Deliverable:

- fewer counters
- fewer admin-feeling labels
- more companion-rail feeling

Progress snapshot:

- substantially complete
- the sidebar rail now defaults to collapsed instead of opening as a competing second surface
- section defaults are being quieted so the rail opens with less cognitive drag
- rail language is being simplified away from dashboard phrasing and toward companion-surface phrasing
- duplicate tracker meaning is being trimmed now that plan and tracker state can already surface in the transcript
- the collapsed rail has now been reduced toward a sigil / companion surface rather than a mini dashboard
- the expanded rail now reads more like backstage support than a second home screen
- remaining work is mostly finish-quality:
  - keep tightening anything that still competes with chat during live use

Current audit tags:

- `move_to_chat`
  - plan state meaning
  - tracker state meaning
  - child-lane launch / return significance
  - graph meaning such as "blocked", "active", and "what matters now"
- `keep_backstage`
  - raw model context numbers
  - MCP connection health
  - tracker detail browsing
  - full graph / DAG inspection
- `cut_or_demote`
  - duplicate carrier / next-move narration in the rail
  - duplicate tracker counters once transcript cards exist
  - graph-first framing in control surfaces
  - section labels that sound like operator tooling instead of companion tooling

#### Pass C: Graph / Split Surface Decision

Files:

- [split-view.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/split-view.tsx)
- [split-view-tracker.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/split-view-tracker.tsx)
- [dialog-tracker.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-tracker.tsx)

Deliverable:

- graph stays as explicit inspection tooling, not default product identity

Progress snapshot:

- substantially complete
- split-view tracker surfaces are being renamed and softened so they read as inspection, not a second home screen
- tracker dialog copy is being reframed around list/dependency inspection instead of graph-first identity
- quick tracker surfaces are being reduced to pressure checks and drill-in affordances, not persistent operator dashboards
- dead split-view surfacing has been removed from the session route, so the product no longer advertises a toggle for a path that is not actually mounted
- the tracker room now behaves as an inspection chamber instead of a graph-first control surface
- remaining work is optional uplift rather than core direction:
  - make the chamber more spatial or cinematic only if it materially improves inspection

### Acceptance Criteria

This decluttering pass succeeds when:

- a user can stay in the transcript and still understand planning, tracking, and swarm state
- opening the sidebar feels optional, not necessary
- graph and tracker views feel like inspection tools, not the center of the app
- the product feels less like an operator console and more like a living conversation
- the default layout keeps the sidebar collapsed until invited open
- the transcript remains readable and emotionally coherent in narrow or awkward terminal widths
- subagent chat windows can be opened and exited cleanly even in narrow layouts

### Parent / Child Session Navigation Requirement

This is a dedicated requirement because the harness now has real swarm behavior, and users need a clean way to drop into a child lane and return without losing orientation.

Current observation:

- there is already partial support in code through:
  - header controls in [header.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/header.tsx)
  - commands in [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
  - the subagent browser in [dialog-subagent.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-subagent.tsx)
- but the current path is too dependent on wide layouts, hidden commands, or backstage surfaces

Product rule:

- entering a child session and returning to the parent session must feel like a first-class conversational movement, not a hidden operator trick

Must:

- provide a visible narrow-safe path to open a subagent session from the transcript or transcript-adjacent surfaces
- provide a visible narrow-safe path to return to the parent session once inside a child lane
- preserve orientation so the user knows which lane they are in and where "back" will go

Should:

- make the jump into a child session feel like entering a minion's private chat window
- make returning to the parent feel calm and obvious
- keep sibling cycling as an advanced action, not the primary requirement

Must not:

- require the sidebar to browse or return from child sessions
- require a wide header to expose the only parent/child controls
- make the user memorize keybinds just to get back to the parent lane

Suggested implementation shape:

1. Transcript-native child-lane entry:
   - clicking or activating a swarm return / subagent line opens that lane
   - transcript summaries for active minions should expose an obvious "enter lane" affordance
2. Child-session return strip:
   - every child session should have a compact always-available "return to parent" strip near the top of the transcript
   - this strip must survive narrow widths
3. Optional deep navigation:
   - header nav, sibling cycling, and dialogs can stay as power-user paths
   - they should not be the only paths

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [header.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/header.tsx)
- [dialog-subagent.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/dialog-subagent.tsx)
- [sidebar.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx)

Acceptance criteria:

- a user on a narrow terminal can open a child lane without opening the sidebar
- a user inside a child lane can always find their way back to the parent
- parent/child movement feels like conversational navigation, not admin navigation

## Phase 1 Build Sheet

This is the concrete implementation sheet for Phase 1.

Scope:

- transcript only
- no major sidebar expansion
- no new dashboard surfaces
- no broad config work yet

Definition of done:

- the transcript alone feels more alive, clearer, and more emotionally coherent
- tool-heavy turns are easier to follow
- subagent activity feels integrated into the conversation
- final assistant turns land with more presence and closure

### Workstream 1: Define The Transcript Scene Grammar

Purpose:

- reduce overlap and inconsistency in how assistant states are presented

Outcome:

- every assistant turn belongs to a small set of recognizable scene types

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [transcript.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts)
- [orchestration.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/orchestration.ts)

Build tasks:

1. Inventory all assistant visual states currently emitted in the transcript.
2. Group them into a stable scene grammar:
   - `presence`
   - `thinking`
   - `action`
   - `swarm`
   - `return`
   - `seal`
3. Remove or merge transcript states that feel redundant, too subtle, or semantically muddy.
4. Write a single derivation layer that maps raw session/tool/activity inputs into one scene type per transcript moment.

Implementation note:

- prefer one clean derivation path over many local conditional flourishes

Acceptance criteria:

- a transcript scene can be named quickly by a human reviewer
- adjacent states read as intentionally different
- the transcript no longer feels like multiple visual systems colliding

### Workstream 2: Rework Assistant Turn Chrome

Purpose:

- make assistant messages feel like scenes with clear intent and mood

Outcome:

- users can tell whether the assistant is thinking, acting, waiting, returning, or done at a glance

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [spinner.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/component/spinner.tsx)
- [shell-signal.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/shell-signal.ts)

Build tasks:

1. Standardize assistant turn header treatment.
2. Standardize assistant turn body background/border behavior by scene type.
3. Reserve the strongest pulse and color treatment for:
   - action
   - interruption
   - swarm return
   - seal
4. Make low-energy states calmer and cleaner.
5. Ensure transitions between states feel like motion with meaning, not general busyness.

Implementation note:

- reduce the number of simultaneous animated cues visible in one turn

Acceptance criteria:

- active turns feel vivid
- settled turns feel calm
- interrupted or blocked turns feel obviously different
- the visual hierarchy stays readable under dense transcript conditions

### Workstream 3: Make Tool Use Feel Diegetic

Purpose:

- stop tool calls from reading like raw backend plumbing

Outcome:

- tools feel like the assistant extending itself into the world

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [transcript.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts)

Build tasks:

1. Audit all tool-rendered transcript parts and classify them by user value.
2. Create compact action block styles for:
   - shell execution
   - file reads
   - file writes or edits
   - search or retrieval
   - web actions
   - task or subagent dispatch
3. Compress repetitive low-value tool noise.
4. Promote only the meaningful parts of tool activity into the main reading flow.
5. Keep full detail reachable without making it the default reading path.

Implementation note:

- think "action card" not "log row"

Acceptance criteria:

- tool-heavy turns remain readable
- the user can tell what kind of action occurred without parsing raw details
- the transcript feels more cinematic and less procedural

### Workstream 4: Integrate Swarm Activity Into The Chat

Purpose:

- make subagents feel like minions of a central intelligence rather than detached background jobs

Outcome:

- launches and returns are legible and satisfying inside the conversation

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [orchestration.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/orchestration.ts)
- [shell-signal.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/shell-signal.ts)

Build tasks:

1. Define an inline subagent launch moment.
2. Define an in-flight swarm presence treatment that does not overwhelm the main transcript.
3. Define an inline return pattern for completed helpers.
4. Distinguish helper types just enough to feel intentional:
   - scout
   - worker
   - reviewer
   - general helper
5. Make completed swarm returns fold naturally back into the main assistant voice.

Implementation note:

- keep it emotionally rich but text-light

Acceptance criteria:

- users can track swarm work without leaving the transcript
- helper activity feels coordinated
- return moments feel earned and integrated

### Workstream 5: Improve Seal And Closure Moments

Purpose:

- make strong answers land with more confidence and emotional completion

Outcome:

- completed assistant turns feel intentional instead of visually flat

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [transcript.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts)

Build tasks:

1. Define what a "sealed" answer looks like.
2. Add a restrained but distinct end-state treatment for completed major turns.
3. Differentiate:
   - provisional response
   - active tool loop
   - returned swarm synthesis
   - final settled answer
4. Make the end of a turn feel visually resolved.

Implementation note:

- this should feel like calm confidence, not celebration spam

Acceptance criteria:

- major answers feel complete
- finality is visible without being loud
- transcript endings have emotional shape

### Workstream 6: Remove Transcript Friction

Purpose:

- cut transcript behavior that weakens immersion or clarity

Outcome:

- fewer awkward or underpowered transcript moments

Target files:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)
- [spinner.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/component/spinner.tsx)
- [shell-signal.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/shell-signal.ts)

Build tasks:

1. Identify transcript effects that are too subtle to matter.
2. Identify transcript effects that are visually busy without helping comprehension.
3. Remove duplicated labels, repeated micro-statuses, or conflicting emphasis patterns.
4. Normalize spacing so transcript rhythm feels deliberate.

Acceptance criteria:

- less clutter
- fewer mixed metaphors
- stronger scene-to-scene rhythm

## Recommended Build Order

Build in this order:

1. Workstream 1
2. Workstream 6
3. Workstream 2
4. Workstream 3
5. Workstream 4
6. Workstream 5

Reason:

- first define the grammar
- then remove friction
- then strengthen chrome
- then make tools and swarm feel native
- then improve closure

## Review Checklist For Phase 1

Use this after each meaningful transcript change.

Questions:

1. Can I understand the assistant state without reading tiny details?
2. Does the transcript feel more intimate or more operational?
3. Did this change make tool-heavy turns easier to read?
4. Did this make swarm behavior feel more integrated?
5. Is the style helping meaning, or just adding garnish?
6. Would a daily user enjoy this after the novelty wears off?
7. Does this still feel like a conversation first?

If any answer trends negative, revise before moving on.

## Workstream 1 Exact Code-Change Plan

This section maps Workstream 1 onto the current transcript code.

Primary observation:

- the transcript already has strong primitives
- the current problem is not lack of ideas
- the current problem is that scene meaning is derived in too many places at once

Right now transcript state is split across:

- turn surface derivation
- turn boundary derivation
- ceremony derivation
- local activity derivation in the session route
- local border and background logic in the session route
- shell event overlays

That gives the UI expressive power, but it also makes the transcript harder to reason about and easier to over-style.

### Current Seams

#### Seam A: Turn Summary Layer

Current functions:

- [deriveTurnSurface()](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts#L176)
- [deriveTurnBoundary()](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts#L221)
- [deriveTurnCeremony()](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts#L291)
- [deriveAssistantCeremonyCopy()](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts#L401)

Problem:

- these functions each describe the same turn from different angles
- labels like `sealed`, `signal`, `convoy`, `handoff`, `afterglow`, `quiet`, and `fracture` are expressive but partly overlapping
- the route layer then adds another interpretation on top

Plan:

1. Introduce a new transcript-scene derivation in [transcript.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts).
2. Make it output one stable scene type:
   - `presence`
   - `thinking`
   - `action`
   - `swarm`
   - `return`
   - `seal`
3. Treat `deriveTurnSurface`, `deriveTurnBoundary`, and `deriveTurnCeremony` as view helpers driven by the new scene type rather than as independent meaning engines.
4. Keep the existing expressive copy where it helps, but make the scene type the source of truth.

Proposed new type:

```ts
type TranscriptScene =
  | "presence"
  | "thinking"
  | "action"
  | "swarm"
  | "return"
  | "seal"
  | "fracture"
```

Proposed new output shape:

```ts
type TranscriptSceneState = {
  scene: TranscriptScene
  emphasis: "low" | "medium" | "high"
  branch: boolean
  toolKind?: "shell" | "read" | "write" | "search" | "web" | "task" | "generic"
  isFirstMoment?: boolean
  isAfterglow?: boolean
}
```

Acceptance condition:

- a single helper can tell the route what this turn fundamentally is

#### Seam B: Route-Level Activity Logic

Current zone:

- [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx#L3689)

Problem:

- `activity()` currently acts like a second scene engine
- it computes rich labels and details directly in the route
- this duplicates responsibility with the transcript helpers

Plan:

1. Keep `activity()` but narrow its role.
2. Make `activity()` consume the new transcript scene state instead of inventing parallel semantics.
3. Reserve route-level logic for:
   - duration-sensitive escalation
   - current in-flight urgency
   - event overlays like interrupt or return
4. Remove any route-level copy that duplicates transcript meaning already decided upstream.

What should stay in `activity()`:

- escalation based on elapsed time
- currently-running urgency
- live event overlay handling

What should move out:

- foundational scene naming
- core meaning of the turn
- stable lifecycle naming

Acceptance condition:

- `activity()` becomes a live modifier layer, not the primary meaning layer

#### Seam C: Visual Treatment Logic

Current zones:

- [transcriptWeatherBg](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx#L4028)
- [transcriptWeatherBorder](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx#L4057)
- [assistantBodyBg](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx#L4077)
- [assistantBodyBorder](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx#L4106)

Problem:

- these are expressive but branch heavily on overlapping conditions
- meaning is encoded directly in color logic
- subtle states are easy to lose

Plan:

1. Create a single presentation token layer for transcript scenes.
2. Map scene state to visual tokens first, then map tokens to colors.
3. Reduce direct condition branching inside the background/border functions.

Proposed token shape:

```ts
type TranscriptSceneTokens = {
  railTone: "muted" | "accent" | "warning" | "success"
  shellTone: "quiet" | "glow" | "hot" | "return"
  bodyTone: "plain" | "lifted" | "charged" | "cooling"
  motion: "still" | "pulse" | "drift"
}
```

Implementation approach:

1. derive `TranscriptSceneState`
2. convert it to `TranscriptSceneTokens`
3. let the route render from tokens

Acceptance condition:

- style changes become easier without rewriting transcript semantics

#### Seam D: Branch Turn Logic

Current references:

- [isBranchTurn()](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx#L3375)
- [isBranchTurn()](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx#L3548)

Problem:

- branch turns currently affect ceremony, background, footer copy, and calm-state behavior directly
- this is emotionally interesting, but branchness should be a modifier, not a separate visual universe

Plan:

1. Preserve branch flavor.
2. Represent branchness as a modifier on scene state rather than a parallel scene engine.
3. Limit branch-specific differences to:
   - copy nuance
   - slight color shift
   - return/seal phrasing
4. Avoid duplicating full behavior trees for branch and root turns.

Acceptance condition:

- branch turns feel distinct but remain part of the same transcript grammar

#### Seam E: Ceremony Overuse

Current references:

- [ceremony()](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx#L3392)
- [ceremony()](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx#L3551)

Problem:

- ceremony is one of the most charming parts of the system
- it is also the easiest place to overdo style

Plan:

1. Keep ceremony as a high-value flare, not a default for every turn.
2. Restrict ceremony to:
   - first contact moments
   - first convoy
   - first handoff
   - first swarm return
   - major fracture
   - strong seal moments
3. For ordinary turns, use scene grammar without ceremonial copy.
4. Ensure ceremony can never obscure state comprehension.

Acceptance condition:

- ceremony feels special again

### Proposed Refactor Order

Do the code changes in this order:

1. Add `TranscriptScene` and `TranscriptSceneState` in [transcript.ts](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/util/transcript.ts).
2. Add a new helper:
   - `deriveTranscriptSceneState(...)`
3. Update:
   - `deriveTurnSurface(...)`
   - `deriveTurnBoundary(...)`
   - `deriveTurnCeremony(...)`
   so they read from scene state instead of competing with each other.
4. In [index.tsx](/C:/Users/HP/repos/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx), replace parallel meaning logic with scene-state consumption.
5. Add a small token mapper in the route or transcript utility:
   - `deriveTranscriptSceneTokens(...)`
6. Refactor transcript background and border functions to use tokens.
7. Run a cleanup pass on labels and eliminate repeated or conflicting copy.

### Concrete Output Targets

After this refactor, the route should have:

- one source of truth for what the turn is
- one live overlay layer for what the turn is doing right now
- one token layer for how it should look

That means:

- semantics
- live modulation
- visual styling

instead of one giant blended condition tree

### What Not To Touch Yet

For Workstream 1, do not expand:

- sidebar behavior
- split view
- tracker UI
- config schema
- prompt composer styling

Those belong to later phases.

### Deliverable For The First Actual Coding Pass

The first pass should aim to land these exact results:

1. A new transcript scene state helper exists.
2. Existing transcript helper functions are rewritten to consume it.
3. `activity()` in the route becomes narrower and cleaner.
4. Transcript background and border logic are token-driven.
5. Ceremony remains, but only where it adds real value.

If that lands cleanly, Workstream 2 becomes much safer and much easier.
