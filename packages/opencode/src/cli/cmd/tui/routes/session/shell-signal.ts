import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import type { SignalEvent, SignalIntensity, SignalMode, SignalPressure } from "../../component/spinner"
import type { Session } from "@opencode-ai/sdk/v2"

type ShellSession = Pick<Session, "id" | "parentID">

type RootMessageScope<T> = {
  rootSessionID?: string
  familySessionIDs: string[]
  messages: T[]
}

export type LocalMessageScope<T> = {
  sessionID?: string
  messages: T[]
}

export function resolveSessionMessageScope<T>(args: {
  messagesBySession: Record<string, T[] | undefined>
  sessionID: string
}): LocalMessageScope<T> {
  if (args.sessionID.length === 0) return { sessionID: undefined, messages: [] }
  return { sessionID: args.sessionID, messages: args.messagesBySession[args.sessionID] ?? [] }
}

export function resolveRootSessionID(sessions: ShellSession[], sessionID: string): string | undefined {
  if (sessionID.length === 0) return undefined
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const visited = new Set<string>()
  let current = byID.get(sessionID)
  if (!current) return undefined
  let highestLoadedID = current.id

  while (current?.parentID && !visited.has(current.parentID)) {
    visited.add(current.parentID)
    const parent = byID.get(current.parentID)
    if (!parent) return current.parentID
    highestLoadedID = parent.id
    current = parent
  }

  return highestLoadedID
}

export function resolveRootSessionMessageScope<T>(args: {
  sessions: ShellSession[]
  messagesBySession: Record<string, T[] | undefined>
  sessionID: string
}): RootMessageScope<T> {
  const rootSessionID = resolveRootSessionID(args.sessions, args.sessionID)
  if (rootSessionID === undefined) return { rootSessionID: undefined, familySessionIDs: [], messages: [] }

  const familySessionIDs = args.sessions
    .filter((session) => resolveRootSessionID(args.sessions, session.id) === rootSessionID)
    .map((session) => session.id)

  if (!familySessionIDs.includes(rootSessionID)) {
    familySessionIDs.unshift(rootSessionID)
  }

  const decorated = familySessionIDs.flatMap((familySessionID, sessionIndex) =>
    (args.messagesBySession[familySessionID] ?? []).map((message, messageIndex) => ({
      message,
      sessionIndex,
      messageIndex,
      timestamp: resolveScopedMessageTimestamp(message),
    })),
  )

  decorated.sort((left, right) => {
    if (left.timestamp !== undefined && right.timestamp !== undefined && left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp
    }
    if (left.timestamp !== undefined && right.timestamp === undefined) return -1
    if (left.timestamp === undefined && right.timestamp !== undefined) return 1
    if (left.sessionIndex !== right.sessionIndex) return left.sessionIndex - right.sessionIndex
    return left.messageIndex - right.messageIndex
  })

  return {
    rootSessionID,
    familySessionIDs,
    messages: decorated.map((entry) => entry.message),
  }
}

function resolveScopedMessageTimestamp(message: unknown) {
  if (!message || typeof message !== "object") return undefined
  const time = (message as { time?: unknown }).time
  if (!time || typeof time !== "object") return undefined
  const created = (time as { created?: unknown }).created
  if (typeof created === "number") return created
  const completed = (time as { completed?: unknown }).completed
  if (typeof completed === "number") return completed
  return undefined
}

type ShellPart = {
  type: string
  tool?: string
  text?: string
  state?: {
    status?: string
  } | null
}

// Generic message type for shell signal functions that accepts any message-like object
export type GenericMessage = {
  id: string
  role?: string
  finish?: string | null
  error?: { name?: string } | null
  time?: {
    completed?: number | null
  } | null
  [key: string]: unknown
}

function messageFinal(message: GenericMessage) {
  return !!message.finish && !["tool-calls", "unknown"].includes(message.finish)
}

function signalWindow(messages: GenericMessage[]) {
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user")
  if (lastUserIndex <= 0) return messages
  return messages.slice(lastUserIndex)
}

export function deriveRecentShellEvent(args: {
  messages: GenericMessage[]
  partsByMessage: Record<string, ShellPart[] | undefined>
  awaitingPromotion?: boolean
  sessionState?: string
}): SignalEvent | undefined {
  const messages = signalWindow(args.messages)
  const latestAssistant = messages.findLast((message) => message?.role === "assistant")
  const latestAssistantParts = latestAssistant ? (args.partsByMessage[latestAssistant.id] ?? []) : []
  const latestAssistantHasClaimedTurn =
    !!latestAssistant && !messageFinal(latestAssistant) && latestAssistant.error?.name !== "MessageAbortedError"
  const latestAssistantIsClearlyActive = latestAssistantParts.some((part) => {
    if (part.type === "reasoning" || part.type === "text") return (part.text?.trim().length ?? 0) > 0
    if (part.type === "tool") return part.state?.status === "pending" || part.state?.status === "running"
    return false
  })

  // "accepted_baton" should only represent the narrow pre-stream handoff window.
  // Once the assistant message exists for this turn, the chrome should defer to
  // actual live work modes instead of continuing to amplify baton drama.
  if (args.awaitingPromotion && !latestAssistantHasClaimedTurn && !latestAssistantIsClearlyActive) {
    return "accepted_baton"
  }

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message) continue

    const parts = args.partsByMessage[message.id] ?? []
    const hasTaskTool = parts.some((part) => part.type === "tool" && part.tool === "task")
    const hasText = parts.some((part) => part.type === "text" && (part.text?.trim().length ?? 0) > 0)
    const hasCompaction = parts.some((part) => part.type === "compaction")

    if (message.error?.name === "MessageAbortedError" && hasTaskTool && !hasText) {
      return "interrupt"
    }

    if (hasCompaction) return "compaction_handoff"

    if (message.role === "assistant" && hasTaskTool && messageFinal(message)) {
      return "subagent_return"
    }
  }

  if (args.sessionState === "error") return "recovery"
  return undefined
}

export function describeShellEvent(event: SignalEvent | undefined) {
  switch (event) {
    case "accepted_baton":
      return { label: "signal ignition", tone: "primary" as const }
    case "compaction_handoff":
      return { label: "memory fold", tone: "accent" as const }
    case "subagent_return":
      return { label: "swarm return", tone: "success" as const }
    case "interrupt":
      return { label: "wait recoil", tone: "warning" as const }
    case "recovery":
      return { label: "signal recovery", tone: "error" as const }
    default:
      return undefined
  }
}

export type ShellCeremonyCue = {
  glyph: string
  label: string
  tone: "primary" | "secondary" | "accent" | "success" | "warning" | "error"
  detail: string
}

function messageHasText(parts: ShellPart[] | undefined) {
  return (parts ?? []).some((part) => part.type === "text" && (part.text?.trim().length ?? 0) > 0)
}

function messageHasTask(parts: ShellPart[] | undefined) {
  return (parts ?? []).some((part) => part.type === "tool" && part.tool === "task")
}

function messageHasTaskInFlight(parts: ShellPart[] | undefined) {
  const source = parts ?? []
  return source.some(
    (part) =>
      part.type === "tool" && part.tool === "task" && (part.state?.status === "running" || part.state?.status === "pending"),
  )
}

export function deriveShellCeremonyCue(args: {
  messages: GenericMessage[]
  partsByMessage: Record<string, ShellPart[] | undefined>
  event?: SignalEvent
}) {
  const messages = signalWindow(args.messages)
  const firstUserIndex = messages.findIndex((message) => message.role === "user")

  const assistantTaskIndexes = messages.flatMap((message, index) =>
    message.role === "assistant" && messageHasTask(args.partsByMessage[message.id]) ? [index] : [],
  )
  const assistantTextIndexes = messages.flatMap((message, index) =>
    message.role === "assistant" && messageHasText(args.partsByMessage[message.id]) ? [index] : [],
  )
  const taskReturnIndexes = messages.flatMap((message, index) => {
    if (message.role !== "assistant") return []
    if (!message.finish) return []
    if (message.finish === "tool-calls" || message.finish === "unknown") return []
    return messageHasTask(args.partsByMessage[message.id]) ? [index] : []
  })

  if (
    assistantTaskIndexes.length === 0 &&
    assistantTextIndexes.length === 0 &&
    firstUserIndex === 0 &&
    args.event === "accepted_baton"
  ) {
    return {
      glyph: ">>",
      label: "UPLK",
      tone: "primary" as const,
      detail: "uplink entering",
    }
  }

  const latestAssistantIndex = messages.findLastIndex((message) => message.role === "assistant")
  const firstTaskIndex = assistantTaskIndexes[0]
  const firstTextIndex = assistantTextIndexes[0]
  const latestTaskIndex = assistantTaskIndexes[assistantTaskIndexes.length - 1]
  const latestTextIndex = assistantTextIndexes[assistantTextIndexes.length - 1]
  const firstReturnIndex = taskReturnIndexes[0]
  const latestReturnIndex = taskReturnIndexes[taskReturnIndexes.length - 1]

  if (firstTaskIndex === latestTaskIndex && latestTaskIndex >= 0 && args.event === "accepted_baton") {
    const current = messages[latestTaskIndex]
    const hasInFlight = messageHasTaskInFlight(args.partsByMessage[current.id])
    if (hasInFlight) {
      return {
        glyph: "*",
        label: "CNV",
        tone: "accent" as const,
        detail: "first outward reach",
      }
    }
  }

  if (args.event === "subagent_return" && latestReturnIndex >= 0 && latestReturnIndex === firstReturnIndex) {
    return {
      glyph: "+",
      label: "RTN",
      tone: "success" as const,
      detail: "first return arriving",
    }
  }

  if (args.event === undefined && latestAssistantIndex === latestTextIndex && latestTextIndex === firstTextIndex && latestTextIndex >= 0) {
    return {
      glyph: ">",
      label: "SIG",
      tone: "secondary" as const,
      detail: "first answer sealing",
    }
  }

  return undefined
}

export type ShellPosture =
  | "editing"
  | "searching"
  | "orchestrating"
  | "blocked"
  | "reflecting"
  | "recovering"
  | "responding"
  | "idle"

export function describeShellPosture(posture: ShellPosture | undefined) {
  switch (posture) {
    case "editing":
      return { label: "editing tissues", tone: "primary" as const }
    case "searching":
      return { label: "scanning terrain", tone: "secondary" as const }
    case "orchestrating":
      return { label: "coordinating agents", tone: "accent" as const }
    case "blocked":
      return { label: "awaiting operator input", tone: "warning" as const }
    case "reflecting":
      return { label: "reflecting on intent", tone: "success" as const }
    case "recovering":
      return { label: "healing pathways", tone: "warning" as const }
    case "responding":
      return { label: "reply composing", tone: "primary" as const }
    default:
      return { label: "holding steady", tone: "primary" as const }
  }
}

function isWritingTool(tool?: string) {
  const key = tool?.toLowerCase() ?? ""
  return key.includes("write") || key.includes("edit") || key.includes("patch")
}

function isSearchTool(tool?: string) {
  const key = tool?.toLowerCase() ?? ""
  return (
    key.includes("grep") ||
    key.includes("glob") ||
    key.includes("list") ||
    key.includes("ls") ||
    key.includes("search") ||
    key.includes("websearch") ||
    key.includes("webfetch") ||
    key.includes("codesearch") ||
    key.includes("find") ||
    key.includes("read")
  )
}

function isOrchestrationTool(tool?: string) {
  const key = tool?.toLowerCase() ?? ""
  return (
    key === "task" ||
    key.includes("todo") ||
    key.includes("plan") ||
    key.includes("track") ||
    key.includes("orchestr") ||
    key.includes("skill") ||
    key.includes("git") ||
    key.includes("bash") ||
    key.includes("command")
  )
}

function postureFromTool(tool?: string) {
  if (isWritingTool(tool)) return "editing" as const
  if (isSearchTool(tool)) return "searching" as const
  if (isOrchestrationTool(tool)) return "orchestrating" as const
  return undefined
}

export function deriveShellPosture(args: {
  messages: GenericMessage[]
  partsByMessage: Record<string, ShellPart[] | undefined>
  sessionState?: string
  childCount?: number
  pendingPermissionCount?: number
  pendingQuestionCount?: number
  pendingSupervisorCount?: number
}) {
  if (args.sessionState === "error") return "recovering"

  const messages = signalWindow(args.messages)
  const pendingPermissions = args.pendingPermissionCount ?? 0
  const pendingQuestions = args.pendingQuestionCount ?? 0
  const pendingSupervisorWork = args.pendingSupervisorCount ?? 0
  const externalPressure = pendingPermissions + pendingQuestions + pendingSupervisorWork

  if (externalPressure > 0) {
    return "blocked" as const
  }

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.role !== "assistant") continue

    const parts = args.partsByMessage[message.id] ?? []
    const activeTool = parts.findLast((part) => part.type === "tool" && (part.state?.status === "running" || part.state?.status === "pending"))
    const posture = postureFromTool(activeTool?.tool)
    if (posture) return posture

    const hasText = parts.some((part) => part.type === "text" && (part.text?.trim().length ?? 0) > 0)
    const hasReasoning = parts.some((part) => part.type === "reasoning" && (part.text?.replaceAll("[REDACTED]", "").trim().length ?? 0) > 0)

    if (hasReasoning && !hasText) return "reflecting"
    if (activeTool) return "orchestrating"
    if (hasText && message.finish) return "responding"
    if (hasText && !message.time?.completed) return "responding"
  }

  if ((args.childCount ?? 0) > 1) return "orchestrating"
  if (args.childCount === 1) return "responding"
  return "idle"
}

export type ShellSurfaceNarrative = {
  primaryLabel: string
  secondaryLabel: string
  stressKind: "none" | "permission" | "question" | "supervisor" | "recovery" | "interrupt" | "context"
  actor: "root" | "swarm" | "operator" | "child"
  scope: "root" | "child"
}

export function deriveShellSurfaceNarrative(args: {
  event?: SignalEvent
  posture?: ShellPosture
  pressure?: SignalPressure
  weather?: string
  childCount?: number
  activeChildCount?: number
  pendingPermissionCount?: number
  pendingQuestionCount?: number
  pendingSupervisorCount?: number
  sessionState?: string
  isChildSession?: boolean
}): ShellSurfaceNarrative {
  const scope = args.isChildSession ? "child" : "root"
  const actor = args.isChildSession ? "child" : "root"
  const permissionCount = args.pendingPermissionCount ?? 0
  const questionCount = args.pendingQuestionCount ?? 0
  const supervisorCount = args.pendingSupervisorCount ?? 0
  const activeChildCount = args.activeChildCount ?? 0
  const childCount = args.childCount ?? 0

  if (permissionCount > 0) {
    return {
      primaryLabel: "awaiting permission",
      secondaryLabel:
        scope === "child"
          ? `${permissionCount} permission gate${permissionCount === 1 ? "" : "s"} holding this lane steady`
          : `${permissionCount} permission gate${permissionCount === 1 ? "" : "s"} holding the root steady`,
      stressKind: "permission",
      actor: "operator",
      scope,
    }
  }

  if (questionCount > 0) {
    return {
      primaryLabel: "awaiting operator reply",
      secondaryLabel: `${questionCount} open question${questionCount === 1 ? "" : "s"} keeping the next turn on hold`,
      stressKind: "question",
      actor: "operator",
      scope,
    }
  }

  if (supervisorCount > 0) {
    return {
      primaryLabel: "supervisor backlog",
      secondaryLabel: `${supervisorCount} swarm update${supervisorCount === 1 ? "" : "s"} need review before promotion`,
      stressKind: "supervisor",
      actor: "operator",
      scope,
    }
  }

  if (args.sessionState === "error" || args.event === "recovery") {
    return {
      primaryLabel: "recovery lane active",
      secondaryLabel:
        scope === "child" ? "this branch is restabilizing after fault" : "root is restabilizing after a failed turn",
      stressKind: "recovery",
      actor,
      scope,
    }
  }

  if (args.event === "interrupt") {
    return {
      primaryLabel: "wait recoil",
      secondaryLabel:
        scope === "child" ? "this branch recoiled and is settling" : "a tool-only turn recoiled; the root is settling again",
      stressKind: "interrupt",
      actor,
      scope,
    }
  }

  if (args.event === "accepted_baton") {
    return {
      primaryLabel: "signal ignition",
      secondaryLabel:
        activeChildCount > 0
          ? `${activeChildCount} live lane${activeChildCount === 1 ? "" : "s"} carrying the new baton`
          : scope === "child"
            ? "this branch is taking the new baton live"
            : "root is taking the fresh baton live",
      stressKind: "none",
      actor: activeChildCount > 0 ? "swarm" : actor,
      scope,
    }
  }

  if (args.event === "compaction_handoff") {
    return {
      primaryLabel: "memory fold",
      secondaryLabel: "context is compressing to protect the next live turn",
      stressKind: "none",
      actor,
      scope,
    }
  }

  if (args.event === "subagent_return") {
    return {
      primaryLabel: "swarm return",
      secondaryLabel:
        activeChildCount > 0
          ? "one lane folded back while the rest keep carrying the mission"
          : scope === "child"
            ? "worker output is folding cleanly back into this branch"
            : "worker output is folding cleanly back into the organism",
      stressKind: "none",
      actor: "swarm",
      scope,
    }
  }

  if (activeChildCount > 0) {
    return {
      primaryLabel: "swarm convoy",
      secondaryLabel:
        scope === "child"
          ? "this lane is carrying the mission forward"
          : `${activeChildCount} live lane${activeChildCount === 1 ? "" : "s"} carrying the mission forward`,
      stressKind: "none",
      actor: "swarm",
      scope,
    }
  }

  if (childCount > 0) {
    return {
      primaryLabel: "swarm standby",
      secondaryLabel: `${childCount} lane${childCount === 1 ? "" : "s"} attached and ready for the next baton`,
      stressKind: "none",
      actor: "swarm",
      scope,
    }
  }

  if (args.pressure === "hot") {
    return {
      primaryLabel: "context pressure high",
      secondaryLabel: "the organism is holding a tighter memory envelope right now",
      stressKind: "context",
      actor,
      scope,
    }
  }

  switch (args.posture) {
    case "editing":
      return {
        primaryLabel: "editing tissues",
        secondaryLabel: "the organism is rewriting live structure",
        stressKind: "none",
        actor,
        scope,
      }
    case "searching":
      return {
        primaryLabel: "scanning terrain",
        secondaryLabel: "the organism is reading for the next decisive move",
        stressKind: "none",
        actor,
        scope,
      }
    case "orchestrating":
      return {
        primaryLabel: "coordinating agents",
        secondaryLabel:
          scope === "child"
            ? "this lane is distributing work across attached lanes"
            : "the root is distributing work across attached lanes",
        stressKind: "none",
        actor: "swarm",
        scope,
      }
    case "blocked":
      return {
        primaryLabel: "awaiting operator input",
        secondaryLabel: "the organism is paused until an external gate clears",
        stressKind: "permission",
        actor: "operator",
        scope,
      }
    case "reflecting":
      return {
        primaryLabel: "reflecting on intent",
        secondaryLabel: "the organism is shaping an answer before it speaks",
        stressKind: "none",
        actor,
        scope,
      }
    case "recovering":
      return {
        primaryLabel: "healing pathways",
        secondaryLabel: "the organism is rerouting after a rough edge",
        stressKind: "recovery",
        actor,
        scope,
      }
    case "responding":
      return {
        primaryLabel: "reply composing",
        secondaryLabel:
          scope === "child" ? "this branch is carrying the active reply" : "root is carrying the active reply",
        stressKind: "none",
        actor,
        scope,
      }
    default:
      return {
        primaryLabel: args.weather ?? "holding steady",
        secondaryLabel:
          scope === "child" ? "this lane is quiet and listening for the next turn" : "root is quiet and listening for the next turn",
        stressKind: "none",
        actor,
        scope,
      }
  }
}

export function deriveShellWorkMode(args: {
  messages: GenericMessage[]
  partsByMessage: Record<string, ShellPart[] | undefined>
  sessionState?: string
  childCount?: number
}): SignalMode {
  if (args.sessionState === "error") return "stalled"

  const messages = signalWindow(args.messages)

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.role !== "assistant") continue

    const parts = args.partsByMessage[message.id] ?? []
    const runningTool = parts.findLast((part) => part.type === "tool" && part.state?.status === "running")
    const pendingTool = parts.findLast((part) => part.type === "tool" && part.state?.status === "pending")
    const hasReasoning = parts.some((part) => part.type === "reasoning" && (part.text?.replaceAll("[REDACTED]", "").trim().length ?? 0) > 0)
    const hasText = parts.some((part) => part.type === "text" && (part.text?.trim().length ?? 0) > 0)

    if (runningTool) return isWritingTool(runningTool.tool) ? "writing" : "processing"
    if (pendingTool) return "dispatching"
    if (message.finish === "tool-calls") return "waiting"
    if (hasReasoning && !hasText) return "thinking"
    if (hasText && !message.finish) return "responding"
    if (hasText && !message.time?.completed) return "responding"
    if (!message.time?.completed) return "dispatching"
    break
  }

  if ((args.childCount ?? 0) > 0) return "processing"
  return "idle"
}

export function deriveShellSwarmMode(args: {
  baseMode: SignalMode
  activeChildCount?: number
  flaggedChildCount?: number
  settledChildCount?: number
}) {
  const active = args.activeChildCount ?? 0
  const flagged = args.flaggedChildCount ?? 0
  const settled = args.settledChildCount ?? 0

  if (flagged > 0) {
    if (args.baseMode === "writing" || args.baseMode === "processing") return "stalled" as const
    return "waiting" as const
  }

  if (active > 0) {
    if (args.baseMode === "idle" || args.baseMode === "settled") return "waiting" as const
    if (args.baseMode === "thinking") return "processing" as const
    return args.baseMode
  }

  if (settled > 0 && (args.baseMode === "idle" || args.baseMode === "processing")) {
    return "settled" as const
  }

  return args.baseMode
}

export function countRecentShellSignals(args: {
  messages: GenericMessage[]
  partsByMessage: Record<string, ShellPart[] | undefined>
}) {
  const messages = signalWindow(args.messages)
  let interrupts = 0
  let returns = 0
  let handoffs = 0

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message) continue

    const parts = args.partsByMessage[message.id] ?? []
    const hasTaskTool = parts.some((part) => part.type === "tool" && part.tool === "task")
    const hasText = parts.some((part) => part.type === "text" && (part.text?.trim().length ?? 0) > 0)
    const hasCompaction = parts.some((part) => part.type === "compaction")

    if (message.error?.name === "MessageAbortedError" && hasTaskTool && !hasText) interrupts += 1
    if (hasCompaction) handoffs += 1
    if (message.role === "assistant" && hasTaskTool && messageFinal(message)) returns += 1

    if (interrupts + returns + handoffs >= 6) break
  }

  return { interrupts, returns, handoffs }
}

export function useLingeringShellEvent(
  event: Accessor<SignalEvent | undefined>,
  lingerMs: number = 4800,
): Accessor<{
  event: SignalEvent | undefined
  phase: "live" | "afterglow" | "scar" | "none"
  decay: number
}> {
  const [visibleEvent, setVisibleEvent] = createSignal<SignalEvent | undefined>(event())
  const [lastLiveAt, setLastLiveAt] = createSignal<number | undefined>(event() ? Date.now() : undefined)
  const [clock, setClock] = createSignal(Date.now())

  createEffect(() => {
    const next = event()
    if (!next) return
    setVisibleEvent(next)
    setLastLiveAt(Date.now())
    setClock(Date.now())
  })

  createEffect(() => {
    if (!visibleEvent()) return
    const interval = setInterval(() => setClock(Date.now()), 120)
    onCleanup(() => clearInterval(interval))
  })

  createEffect(() => {
    if (event()) return
    const current = visibleEvent()
    const startedAt = lastLiveAt()
    if (!current || !startedAt) return
    const effectiveLingerMs = current === "accepted_baton" ? Math.min(lingerMs, 1400) : lingerMs
    if (clock() - startedAt >= effectiveLingerMs) {
      setVisibleEvent(undefined)
    }
  })

  return createMemo(() => {
    const live = event()
    if (live) {
      return {
        event: live,
        phase: "live" as const,
        decay: 1,
      }
    }

    const current = visibleEvent()
    const startedAt = lastLiveAt()
    if (!current || !startedAt) {
      return {
        event: undefined,
        phase: "none" as const,
        decay: 0,
      }
    }

    const effectiveLingerMs = current === "accepted_baton" ? Math.min(lingerMs, 1400) : lingerMs
    const elapsed = clock() - startedAt
    if (elapsed >= effectiveLingerMs) {
      return {
        event: undefined,
        phase: "none" as const,
        decay: 0,
      }
    }

    const decay = Math.max(0, 1 - elapsed / effectiveLingerMs)
    return {
      event: current,
      phase: decay > 0.6 ? ("afterglow" as const) : ("scar" as const),
      decay,
    }
  })
}

function pressureToHeat(pressure: SignalPressure) {
  if (pressure === "hot") return 0.82
  if (pressure === "warm") return 0.48
  return 0.14
}

export function useShellClimate(args: {
  event: Accessor<SignalEvent | undefined>
  eventPhase: Accessor<"live" | "afterglow" | "scar" | "none">
  basePressure: Accessor<SignalPressure>
  baseIntensity: Accessor<SignalIntensity>
  childCount: Accessor<number>
  recentInterrupts?: Accessor<number>
  recentReturns?: Accessor<number>
  recentHandoffs?: Accessor<number>
  retrying?: Accessor<boolean>
  externalLoad?: Accessor<number>
}) {
  const [clock, setClock] = createSignal(Date.now())
  const [heat, setHeat] = createSignal(pressureToHeat(args.basePressure()))

  createEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 180)
    onCleanup(() => clearInterval(interval))
  })

  createEffect(() => {
    clock()
    const base = pressureToHeat(args.basePressure())
    const childLoad = Math.min(0.22, args.childCount() * 0.05)
    const externalLoad = Math.min(0.22, (args.externalLoad?.() ?? 0) * 0.04)
    const interruptLoad = Math.min(0.24, (args.recentInterrupts?.() ?? 0) * 0.08)
    const returnLoad = Math.min(0.12, (args.recentReturns?.() ?? 0) * 0.03)
    const handoffLoad = Math.min(0.1, (args.recentHandoffs?.() ?? 0) * 0.03)
    const retryLoad = args.retrying?.() ? 0.26 : 0
    const event = args.event()
    const phase = args.eventPhase()
    const eventLoad =
      event === "interrupt"
        ? phase === "live"
          ? 0.28
          : phase === "afterglow"
            ? 0.18
            : 0.1
        : event === "accepted_baton"
          ? phase === "live"
            ? 0.08
            : 0.03
          : event === "compaction_handoff"
            ? phase === "live"
              ? 0.1
              : 0.05
            : event === "subagent_return"
              ? phase === "live"
                ? 0.08
                : 0.04
              : event === "recovery"
                ? -0.22
                : 0

    const target = Math.max(
      0,
      Math.min(1, base + childLoad + externalLoad + interruptLoad + returnLoad + handoffLoad + retryLoad + eventLoad),
    )
    setHeat((prev) => prev + (target - prev) * (target > prev ? 0.24 : 0.1))
  })

  return createMemo(() => {
    const currentHeat = heat()
    const pressure: SignalPressure = currentHeat >= 0.74 ? "hot" : currentHeat >= 0.36 ? "warm" : "cool"
    const intensity: SignalIntensity =
      currentHeat >= 0.82
        ? "stressed"
        : args.childCount() >= 3 || currentHeat >= 0.62
          ? "crowded"
          : currentHeat >= 0.28 || args.baseIntensity() === "active"
            ? "active"
            : "calm"

    const weather =
      args.event() === "recovery" && args.eventPhase() !== "none"
        ? "recovery dawn"
        : currentHeat >= 0.86
          ? "fault storm"
          : currentHeat >= 0.68
            ? "pressure front"
            : currentHeat >= 0.5
              ? "swarm weather"
              : currentHeat >= 0.3
                ? "ember field"
                : "clear band"

    return {
      heat: currentHeat,
      pressure,
      intensity,
      weather,
    }
  })
}

export function useShellChargeExchange(args: {
  active: Accessor<boolean>
  recentCompletionAt: Accessor<number | undefined>
  climateHeat: Accessor<number>
  lingerMs?: number
}) {
  const lingerMs = args.lingerMs ?? 18000
  const [clock, setClock] = createSignal(Date.now())
  const [charge, setCharge] = createSignal(0)

  createEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 180)
    onCleanup(() => clearInterval(interval))
  })

  createEffect(() => {
    clock()
    const active = args.active()
    const climate = args.climateHeat()
    const completionAt = args.recentCompletionAt()
    const recentCompletionCharge = (() => {
      if (!completionAt) return 0
      const elapsed = Math.max(0, clock() - completionAt)
      if (elapsed >= lingerMs) return 0
      return 0.7 * (1 - elapsed / lingerMs)
    })()

    const target = active
      ? Math.min(1, 0.78 + climate * 0.22)
      : Math.max(recentCompletionCharge, climate * 0.22)

    setCharge((prev) => prev + (target - prev) * (target > prev ? 0.28 : 0.1))
  })

  return createMemo(() => {
    const value = charge()
    return {
      value,
      phase: args.active() ? ("radiant" as const) : value > 0.18 ? ("cooling" as const) : ("idle" as const),
    }
  })
}

export function deriveShellRhythm(args: {
  event: SignalEvent | undefined
  eventPhase: "live" | "afterglow" | "scar" | "none"
  eventDecay?: number
  chargePhase: "radiant" | "cooling" | "idle"
  chargeValue: number
  climateHeat: number
  pressure: SignalPressure
  posture?: ShellPosture
}) {
  const phaseWeight =
    args.eventPhase === "live"
      ? 1
      : args.eventPhase === "afterglow"
        ? 0.74
        : args.eventPhase === "scar"
          ? 0.48
          : 0
  const decay = args.eventDecay ?? phaseWeight
  const eventWake =
    args.event === "accepted_baton"
      ? 0.44
      : args.event === "subagent_return"
        ? 0.76
        : args.event === "compaction_handoff"
          ? 0.68
          : args.event === "interrupt"
            ? 0.52
            : args.event === "recovery"
              ? 0.44
              : 0
  const scar =
    args.event === "interrupt"
      ? 0.86 * phaseWeight
      : args.event === "recovery"
        ? 0.68 * phaseWeight
        : args.pressure === "hot"
          ? 0.26
          : 0
  const chargeBias =
    args.chargePhase === "radiant"
      ? 0.96
      : args.chargePhase === "cooling"
        ? 0.64
        : 0.24
  const glow = Math.max(args.chargeValue * chargeBias, args.climateHeat * 0.66)
  const posturePulse =
    args.posture === "editing"
      ? 0.22
      : args.posture === "orchestrating"
        ? 0.18
        : args.posture === "searching"
          ? 0.16
          : args.posture === "reflecting"
            ? 0.12
            : args.posture === "recovering"
              ? 0.08
              : 0
  const wake = Math.min(1, glow * 0.58 + eventWake * decay + posturePulse)
  const pulse = Math.min(1, wake * 0.72 + glow * 0.28 + posturePulse * 0.2)
  const shimmer = Math.min(1, pulse * 0.62 + scar * 0.24 + args.climateHeat * 0.18)

  return {
    glow,
    wake,
    pulse,
    shimmer,
    scar,
  }
}
