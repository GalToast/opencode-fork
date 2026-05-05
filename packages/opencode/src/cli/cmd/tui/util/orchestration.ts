type ForegroundStateInput = {
  pendingInboxCount: number
  steerStage?: "received" | "applied"
  steerPending?: number
  ingressQueued: number
  ingressRunning: number
  mainRunning: number
  sessionStatusType?: string
  hasPendingAssistant: boolean
}

type ForegroundNextActionInput = ForegroundStateInput & {
  orchestratorRunning: number
  adversarialRunning: number
  workerRunning: number
  actionableUpdateCount: number
}

type ForegroundReserveInput = {
  mainRunning: number
  mainConcurrency: number
  ingressQueued: number
}

type ChildSessionAutoReturnInput = {
  childWasBusy: boolean
  currentSessionID?: string
  parentSessionID?: string
  currentSessionStatus?: string
  foreground?: {
    state: "idle" | "accepting" | "responding" | "steering"
    awaitingPromotion: boolean
    activeSessionID?: string
    pendingSessionID?: string
    latestSessionID: string
  }
}

type TimelineMessageLike = {
  id: string
  role?: string
  parentID?: string
}

export type ForegroundState = "blocked" | "steering" | "accepting" | "responding" | "idle"
export type ForegroundReserve = "open" | "warming" | "saturated"
export type OperatorConfidence = "high" | "medium" | "low"
export type OperatorInterruptability = "idle" | "ready" | "boundary"
export type OperatorSubmitMode = "send" | "steer"

export type OperatorDigestInput = ForegroundNextActionInput &
  ForegroundReserveInput & {
    mainConcurrency: number
    pausedLaneCount?: number
    starvedLaneCount?: number
    retrying?: boolean
  }

export type OperatorDigest = {
  state: ForegroundState
  reserve: ForegroundReserve
  confidence: OperatorConfidence
  interruptability: OperatorInterruptability
  submitMode: OperatorSubmitMode
  label: string
  blocker?: string
  nextAction: string
  attentionCount: number
  reasons: string[]
}

export type ChildSessionDerivedStatus = "queued" | "running" | "completed" | "error" | "canceled" | "idle"
export type SubagentAttentionState = "blocked" | "paused" | "error"

type SubagentAttentionInput = {
  lifecycleStatus: ChildSessionDerivedStatus
  latestTimelineEvent?: {
    phase: "queued" | "dispatched" | "running" | "completed" | "error" | "canceled" | "recovered"
    action?: string
    paused?: boolean
  }
  latestLaneStatus?: "queued" | "running" | "completed" | "blocked" | "error" | "canceled"
}

export type SubagentAttentionSummary = {
  status: ChildSessionDerivedStatus
  attention?: SubagentAttentionState
  active: boolean
  needsAttention: boolean
  displayStatus: "queued" | "running" | "completed" | "error" | "canceled" | "idle" | "blocked" | "paused"
}

export type SubagentPulseState = "convoy" | "baton" | "returning" | "cooling" | "blocked" | "idle"
export type SubagentLaneSignal = {
  pulseState: SubagentPulseState
  lifecycleLine: string
}

export type CarrierNarrative = {
  carrierLabel: string
  pressureLabel: string
  constraintLabel: string
  nextMoveLabel: string
}

type SchedulerLane = NonNullable<ExecutionTimelineHintInput["laneLatest"]>["lane"]

type ChildSessionLifecycleInput = {
  sessionStatusType?: string
  launchStatus?: string
  hasPendingAssistant: boolean
  hasCompletedAssistant: boolean
  firstUserCreated?: number
  lastAssistantCompleted?: number
  sessionUpdatedAt?: number
  now?: number
}

const STALE_CHILD_SESSION_ACTIVITY_MS = 90_000
const SUBAGENT_RETURN_WINDOW_MS = 70_000

export type MissionHighlightInput = {
  latestUserIntent?: string
  todoCount: number
  childCount: number
  activeChildCount: number
  pendingSteer: number
}

export type ExecutionTimelineHintInput = {
  timelineEvent?: {
    phase: "queued" | "dispatched" | "running" | "completed" | "error" | "canceled" | "recovered"
    description: string
    lane?: SchedulerLane
    source?: "scheduler" | "task"
  }
  supervisorUpdate?: {
    status: "queued" | "started" | "completed" | "error" | "canceled"
    description: string
    subagentType: string
    eventKind?: "queued" | "dispatched" | "paused" | "resumed" | "escalated" | "status" | "heartbeat" | "recovered"
    error?: string
  }
  laneLatest?: {
    lane:
      | "user_ingress"
      | "main_turns"
      | "steer_fastlane"
      | "orchestrator_swarm"
      | "adversarial_review"
      | "subagent_tasks"
      | "tool_io"
      | "longrun_jobs"
    latest: {
      description: string
      status: "queued" | "running" | "completed" | "error" | "canceled" | "recovery_failed"
      priority: "urgent" | "steer" | "normal" | "background"
    }
  }
}

function summarizeLine(text: string, maxLength = 84) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd() + "..."
}

function laneLabel(
  lane:
    | "user_ingress"
    | "main_turns"
    | "steer_fastlane"
    | "orchestrator_swarm"
    | "adversarial_review"
    | "subagent_tasks"
    | "tool_io"
    | "longrun_jobs",
) {
  if (lane === "user_ingress") return "ingress"
  if (lane === "main_turns") return "main"
  if (lane === "steer_fastlane") return "steer"
  if (lane === "orchestrator_swarm") return "orch"
  if (lane === "adversarial_review") return "review"
  if (lane === "subagent_tasks") return "worker"
  if (lane === "tool_io") return "tool"
  return "longrun"
}

function titleCaseState(state: ForegroundState) {
  if (state === "idle") return "Idle"
  if (state === "blocked") return "Blocked"
  if (state === "steering") return "Steering"
  if (state === "accepting") return "Accepting"
  return "Responding"
}

function countAttention(input: OperatorDigestInput) {
  return input.pendingInboxCount + (input.steerPending ?? 0) + input.actionableUpdateCount
}

function deriveConfidence(input: OperatorDigestInput, state: ForegroundState) {
  if (input.pendingInboxCount > 0 || input.retrying || (input.starvedLaneCount ?? 0) > 0) return "low"
  if (state === "steering" || input.actionableUpdateCount > 0 || (input.pausedLaneCount ?? 0) > 0) return "medium"
  return "high"
}

function deriveInterruptability(input: OperatorDigestInput, state: ForegroundState): OperatorInterruptability {
  if (state === "idle") return "idle"
  if (state === "blocked" || state === "accepting") return "ready"
  if (input.retrying) return "ready"
  return "boundary"
}

export function deriveOperatorDigest(input: OperatorDigestInput): OperatorDigest {
  const state = deriveForegroundState(input)
  const reserve = deriveForegroundReserve(input)
  const nextAction = deriveForegroundNextAction(input)
  const reasons: string[] = []
  if (input.pendingInboxCount > 0) reasons.push(`${input.pendingInboxCount} inbox item${input.pendingInboxCount === 1 ? "" : "s"} waiting`)
  if ((input.steerPending ?? 0) > 0) reasons.push(`${input.steerPending} steer update${input.steerPending === 1 ? "" : "s"} pending`)
  if (input.actionableUpdateCount > 0) {
    reasons.push(`${input.actionableUpdateCount} actionable supervisor update${input.actionableUpdateCount === 1 ? "" : "s"}`)
  }
  if ((input.pausedLaneCount ?? 0) > 0) reasons.push(`${input.pausedLaneCount} scheduler lane${input.pausedLaneCount === 1 ? "" : "s"} paused`)
  if ((input.starvedLaneCount ?? 0) > 0) reasons.push(`${input.starvedLaneCount} scheduler lane${input.starvedLaneCount === 1 ? "" : "s"} starved`)
  if (input.retrying) reasons.push("retry backoff active")

  const blocker =
    input.pendingInboxCount > 0
      ? "Resolve inbox approvals/questions."
      : input.retrying
        ? "Wait for retry backoff to settle."
        : undefined

  return {
    state,
    reserve,
    confidence: deriveConfidence(input, state),
    interruptability: deriveInterruptability(input, state),
    submitMode: state === "idle" ? "send" : "steer",
    label: titleCaseState(state),
    blocker,
    nextAction,
    attentionCount: countAttention(input),
    reasons,
  }
}

export function deriveMissionHighlight(input: MissionHighlightInput) {
  const parts = [summarizeIntent(input.latestUserIntent, 56)]
  parts.push(`todo ${input.todoCount}`)
  if (input.activeChildCount > 0) parts.push(`active child ${input.activeChildCount}`)
  else if (input.childCount > 0) parts.push(`child ${input.childCount}`)
  if (input.pendingSteer > 0) parts.push(`steer ${input.pendingSteer}`)
  return summarizeLine(parts.join(" | "), 96)
}

export function deriveExecutionTimelineHint(input: ExecutionTimelineHintInput) {
  if (input.timelineEvent) {
    const prefix = input.timelineEvent.source === "task" ? "timeline task" : "timeline"
    const lane = input.timelineEvent.lane ? ` ${laneLabel(input.timelineEvent.lane)}` : ""
    return summarizeLine(`${prefix}${lane} ${input.timelineEvent.phase} | ${input.timelineEvent.description}`, 96)
  }
  if (input.supervisorUpdate) {
    const prefix =
      input.supervisorUpdate.status === "error"
        ? "timeline error"
        : input.supervisorUpdate.status === "completed"
          ? "timeline complete"
          : input.supervisorUpdate.status === "canceled"
            ? "timeline canceled"
            : input.supervisorUpdate.status === "started"
              ? "timeline started"
              : "timeline queued"
    return summarizeLine(`${prefix} | ${input.supervisorUpdate.description}`, 96)
  }
  if (input.laneLatest) {
    return summarizeLine(
      `timeline ${laneLabel(input.laneLatest.lane)} ${input.laneLatest.latest.status} | ${input.laneLatest.latest.description}`,
      96,
    )
  }
  return undefined
}

export function summarizeIntent(text: string | undefined, maxLength = 96) {
  if (!text) return "No user intent captured yet."
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return "No user intent captured yet."
  if (normalized.length <= maxLength) return normalized
  return normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd() + "..."
}

export function deriveForegroundState(input: ForegroundStateInput): ForegroundState {
  if (input.pendingInboxCount > 0) return "blocked"
  if (input.steerStage === "received" || (input.steerPending ?? 0) > 0) return "steering"
  if (input.ingressQueued > 0 || input.ingressRunning > 0) return "accepting"
  // Session status can stay busy for background work such as title generation.
  // Only foreground assistant activity should force the next prompt into steer mode.
  if (input.mainRunning > 0 || input.hasPendingAssistant) {
    return "responding"
  }
  return "idle"
}

export function deriveForegroundReserve(input: ForegroundReserveInput): ForegroundReserve {
  if (input.mainRunning < input.mainConcurrency) return "open"
  if (input.ingressQueued > 0) return "warming"
  return "saturated"
}

export function deriveForegroundNextAction(input: ForegroundNextActionInput) {
  const state = deriveForegroundState(input)
  if (state === "blocked") return "Resolve inbox approvals/questions before promoting more work."
  if (state === "steering") return "Apply steer pressure and reprioritize the foreground response."
  if (state === "accepting") return "Move accepted ingress into the live responder lane."
  if (input.actionableUpdateCount > 0) return "Inspect actionable supervisor updates before surfacing results."
  if (input.adversarialRunning > 0) return "Wait for adversarial review before promoting risky output."
  if (input.orchestratorRunning > 0 || input.workerRunning > 0) return "Watch swarm results and promote the best candidate."
  return "Ready for the next user turn."
}

type SessionChromeInput = {
  isChildSession: boolean
  sidebarMode: "auto" | "hide"
  sidebarOpen: boolean
  wide: boolean
}

export function deriveSessionChrome(input: SessionChromeInput) {
  const rootOnly = !input.isChildSession

  return {
    showSidebar: rootOnly && (input.sidebarOpen || (input.sidebarMode === "auto" && input.wide)),
    showControlPanels: rootOnly,
    showPendingInboxBanner: rootOnly,
    // Child sessions should stay interactive even when we hide the root-only orchestration chrome.
    showPrompt: true,
    showFooter: true,
  }
}

export function deriveChildSessionLifecycle(input: ChildSessionLifecycleInput) {
  let status: ChildSessionDerivedStatus = "idle"
  const now = input.now ?? Date.now()
  const hasFreshSessionActivity =
    input.sessionUpdatedAt !== undefined && now - input.sessionUpdatedAt <= STALE_CHILD_SESSION_ACTIVITY_MS
  const hasTerminalAssistant = input.hasCompletedAssistant || input.lastAssistantCompleted !== undefined

  if (input.sessionStatusType && input.sessionStatusType !== "idle" && (input.hasPendingAssistant || hasFreshSessionActivity)) status = "running"
  else if (input.hasPendingAssistant) status = "running"
  else if (input.launchStatus === "error") status = "error"
  else if (input.launchStatus === "canceled") status = "canceled"
  else if (input.launchStatus === "pending" || input.launchStatus === "queued") status = "queued"
  else if ((input.launchStatus === "running" || input.launchStatus === "started") && hasFreshSessionActivity) status = "running"
  else if (input.launchStatus === "completed" || hasTerminalAssistant) status = "completed"

  const terminalAt =
    input.lastAssistantCompleted ??
    (status === "completed" || status === "error" || status === "canceled" ? input.sessionUpdatedAt : undefined)

  const durationMS =
    input.firstUserCreated && terminalAt && terminalAt >= input.firstUserCreated ? terminalAt - input.firstUserCreated : 0

  return {
    status,
    terminalAt,
    durationMS,
  }
}

export function deriveSubagentAttention(input: SubagentAttentionInput): SubagentAttentionSummary {
  const blockedByLane = input.latestLaneStatus === "blocked"
  const blockedByAction = input.latestTimelineEvent?.action === "child_requirement_unmet"
  const paused = input.latestTimelineEvent?.paused === true || input.latestTimelineEvent?.action === "pause"
  const errored = input.lifecycleStatus === "error" || input.latestTimelineEvent?.phase === "error" || input.latestLaneStatus === "error"

  const attention: SubagentAttentionState | undefined = errored
    ? "error"
    : paused
      ? "paused"
      : blockedByLane || blockedByAction
        ? "blocked"
        : undefined

  return {
    status: input.lifecycleStatus,
    attention,
    active: input.lifecycleStatus === "queued" || input.lifecycleStatus === "running",
    needsAttention: !!attention,
    displayStatus: attention ?? input.lifecycleStatus,
  }
}

function normalizeSubagentStatus(status: string) {
  if (
    status === "queued" ||
    status === "running" ||
    status === "completed" ||
    status === "error" ||
    status === "canceled"
  ) {
    return status
  }
  if (status === "complete") return "completed"
  return "idle"
}

export function deriveSubagentPulseState(args: {
  status: string
  rawStatus?: string
  active: boolean
  lastUpdate: number
  now?: number
}) {
  const normalizedStatus = normalizeSubagentStatus(args.status)
  if (normalizedStatus === "error" || args.rawStatus === "retry") return "blocked"
  if (normalizedStatus === "queued") return "baton"
  if (normalizedStatus === "running" && args.active) return "convoy"
  if (normalizedStatus === "completed") {
    const now = args.now ?? Date.now()
    return now - args.lastUpdate < SUBAGENT_RETURN_WINDOW_MS ? "returning" : "cooling"
  }
  if (normalizedStatus === "idle") return "cooling"
  return "idle"
}

export function deriveSubagentLaneSignal(args: {
  status: string
  rawStatus?: string
  active: boolean
  lastUpdate: number
  turns: number
  now?: number
}): SubagentLaneSignal {
  const normalizedStatus = normalizeSubagentStatus(args.status)
  const pulseState = deriveSubagentPulseState({
    status: args.status,
    rawStatus: args.rawStatus,
    active: args.active,
    lastUpdate: args.lastUpdate,
    now: args.now,
  })

  if (args.rawStatus === "retry") {
    return {
      pulseState,
      lifecycleLine: "retry shield active; waiting for recovery cooldown",
    }
  }
  if (pulseState === "blocked") {
    return {
      pulseState,
      lifecycleLine: "blocked on a missing requirement; release this lane",
    }
  }
  if (pulseState === "baton") {
    return {
      pulseState,
      lifecycleLine: "baton held, prepared for dispatch ignition",
    }
  }
  if (pulseState === "convoy") {
    return {
      pulseState,
      lifecycleLine: `convoy live with ${args.turns} turns returning to root`,
    }
  }
  if (pulseState === "returning") {
    return {
      pulseState,
      lifecycleLine: "results folding back through the carrier bloodstream",
    }
  }
  if (pulseState === "cooling" && normalizedStatus === "completed") {
    return {
      pulseState,
      lifecycleLine: "cooled after a clean return; lane held in memory",
    }
  }
  return {
    pulseState,
    lifecycleLine: "lane dormant, warm for re-ignition",
  }
}

export function deriveCarrierNarrative(input: {
  rootStatus?: string
  activeChildCount: number
  childCount: number
  pendingPermissionCount?: number
  pendingQuestionCount?: number
  pendingSupervisorCount?: number
  trackerBlockedCount?: number
  trackerOpenCount?: number
  mcpAttentionCount?: number
  contextPercent?: number
}) : CarrierNarrative {
  const permissionCount = input.pendingPermissionCount ?? 0
  const questionCount = input.pendingQuestionCount ?? 0
  const supervisorCount = input.pendingSupervisorCount ?? 0
  const trackerBlockedCount = input.trackerBlockedCount ?? 0
  const trackerOpenCount = input.trackerOpenCount ?? 0
  const mcpAttentionCount = input.mcpAttentionCount ?? 0
  const contextPercent = input.contextPercent

  const pressureLabel =
    contextPercent === undefined
      ? "pressure // context still seeding"
      : contextPercent >= 85
        ? "pressure // hot context envelope"
        : contextPercent >= 65
          ? "pressure // warm context envelope"
          : "pressure // calm context envelope"

  if (permissionCount > 0) {
    return {
      carrierLabel: "carrier // operator gate",
      pressureLabel,
      constraintLabel: `${permissionCount} permission gate${permissionCount === 1 ? "" : "s"} holding the organism`,
      nextMoveLabel: "next // clear approvals to release the live turn",
    }
  }

  if (questionCount > 0) {
    return {
      carrierLabel: "carrier // operator loop",
      pressureLabel,
      constraintLabel: `${questionCount} open question${questionCount === 1 ? "" : "s"} waiting on operator reply`,
      nextMoveLabel: "next // answer the pending question and let the root move",
    }
  }

  if (supervisorCount > 0) {
    return {
      carrierLabel: "carrier // supervisor braid",
      pressureLabel,
      constraintLabel: `${supervisorCount} supervisor update${supervisorCount === 1 ? "" : "s"} need review before promotion`,
      nextMoveLabel: "next // inspect the swarm returns and promote the best one",
    }
  }

  if (input.rootStatus === "retry") {
    return {
      carrierLabel: "carrier // recovery loop",
      pressureLabel,
      constraintLabel: "retry backoff is protecting the next clean turn",
      nextMoveLabel: "next // let recovery settle before pushing fresh work",
    }
  }

  if (input.activeChildCount > 0) {
    return {
      carrierLabel: `carrier // ${input.activeChildCount} live swarm lane${input.activeChildCount === 1 ? "" : "s"}`,
      pressureLabel,
      constraintLabel:
        trackerBlockedCount > 0
          ? `${trackerBlockedCount} blocked track${trackerBlockedCount === 1 ? "" : "s"} constraining the convoy`
          : mcpAttentionCount > 0
            ? `${mcpAttentionCount} MCP edge${mcpAttentionCount === 1 ? "" : "s"} need attention`
            : "active lanes are carrying the mission body right now",
      nextMoveLabel: "next // merge the strongest swarm return back into root",
    }
  }

  if (input.childCount > 0) {
    return {
      carrierLabel: `carrier // ${input.childCount} warm lane${input.childCount === 1 ? "" : "s"} attached`,
      pressureLabel,
      constraintLabel:
        trackerOpenCount > 0
          ? `${trackerOpenCount} open track${trackerOpenCount === 1 ? "" : "s"} waiting for the next baton`
          : "no lane is carrying live work yet",
      nextMoveLabel: "next // dispatch the next baton into the warm swarm",
    }
  }

  return {
    carrierLabel: input.rootStatus === "busy" ? "carrier // root responder" : "carrier // solo root",
    pressureLabel,
    constraintLabel:
      trackerBlockedCount > 0
        ? `${trackerBlockedCount} blocked track${trackerBlockedCount === 1 ? "" : "s"} need resolution`
        : mcpAttentionCount > 0
          ? `${mcpAttentionCount} MCP edge${mcpAttentionCount === 1 ? "" : "s"} need attention`
          : "constraints are light and the organism is ready",
    nextMoveLabel: "next // take the next user turn cleanly",
  }
}

export function shouldAutoReturnFromChildSession(input: ChildSessionAutoReturnInput) {
  if (!input.childWasBusy || !input.parentSessionID || !input.currentSessionID || !input.foreground) return false

  if (input.foreground.activeSessionID === input.currentSessionID) return false
  if (input.foreground.awaitingPromotion && input.foreground.pendingSessionID === input.currentSessionID) return false
  return input.currentSessionStatus === "idle"
}
export function collapseAssistantTimeline<T extends TimelineMessageLike>(messages: T[]) {
  const collapsed: T[] = []
  const assistantIndexByParent = new Map<string, number>()

  for (const message of messages) {
    if (message.role !== "assistant" || !message.parentID) {
      collapsed.push(message)
      continue
    }

    const existingIndex = assistantIndexByParent.get(message.parentID)
    if (existingIndex === undefined) {
      assistantIndexByParent.set(message.parentID, collapsed.length)
      collapsed.push(message)
      continue
    }

    collapsed[existingIndex] = message
  }

  return collapsed
}
