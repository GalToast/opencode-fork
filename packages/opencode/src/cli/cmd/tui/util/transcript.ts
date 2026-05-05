import type { AssistantMessage, Part, Provider, UserMessage } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import * as Model from "./model"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
  providers?: Provider[]
}

export type SessionInfo = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export type MessageWithParts = {
  info: UserMessage | AssistantMessage
  parts: Part[]
}

export type TranscriptTurnStatus = "user" | "running" | "waiting" | "tooling" | "complete" | "truncated" | "error"

export type TranscriptTurnSurface = {
  messageID: string
  timestamp: number
  role: UserMessage["role"] | AssistantMessage["role"]
  status: TranscriptTurnStatus
  statusLabel: string
  statusIcon: string
  roleLabel: string
  traceLabel: string
  preview: string
  toolCount: number
  activeToolCount: number
  activeToolName?: string
  hasText: boolean
  tokens?: number
  cost?: number
}

export type TranscriptTurnBoundary = {
  headerLabel: string
  footerLabel: string
  dividerLabel: string
}

export type TranscriptTurnBoundaryOptions = {
  isBranchTurn?: boolean
}

export type TurnSurfaceOptions = {
  previewLength?: number
}

export type TranscriptTurnCeremony = {
  label?: string
  detail?: string
  roleLabel?: TranscriptCeremonyRole
}

export type TranscriptScene = "presence" | "thinking" | "action" | "swarm" | "return" | "seal" | "fracture"
export type TranscriptSceneEmphasis = "low" | "medium" | "high"
export type TranscriptSceneRenderTier = "soft" | "strong"

export type TranscriptSceneState = {
  scene: TranscriptScene
  emphasis: TranscriptSceneEmphasis
  branch: boolean
  status: TranscriptTurnStatus
  toolKind?: "shell" | "read" | "write" | "search" | "web" | "task" | "generic"
  hasTools: boolean
  hasTaskTool: boolean
  hasText: boolean
  isLive: boolean
}

export type TranscriptSceneTokens = {
  railTone: "muted" | "accent" | "warning" | "success"
  shellTone: "plain" | "lifted" | "charged" | "cooling" | "hot" | "fracture"
  bodyTone: "plain" | "lifted" | "charged" | "cooling"
  branchTone: "root" | "branch" | "ceremony"
  motion: "still" | "pulse" | "drift"
  renderTier: TranscriptSceneRenderTier
}

export type TranscriptCeremonyRole =
  | "organism"
  | "uplink"
  | "convoy"
  | "handoff"
  | "hold"
  | "fracture"
  | "return"
  | "signal"
  | "afterglow"

export type AssistantCeremonyState =
  | "hold_operator"
  | "hold_safe"
  | "fracture"
  | "convoy_start"
  | "convoy_queue"
  | "convoy_hold"
  | "convoy_long"
  | "handoff_wait"
  | "handoff_hold"
  | "handoff_long"
  | "signal_stream"
  | "signal_settled"
  | "signal_afterglow"
  | "signal_quiet"
  | "return_settled"
  | "return_afterglow"

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ")
}

type DisplayableTranscriptPartLike = {
  type: string
  synthetic?: boolean
  ignored?: boolean
  text?: string
  reasoning_content?: string
  reasoning_details?: string
}

export function getTranscriptPartText<TPart extends DisplayableTranscriptPartLike>(part: TPart | undefined): string {
  if (!part) return ""
  if (typeof part.text === "string" && part.text.length > 0) return part.text
  if (part.type === "reasoning") {
    if (typeof part.reasoning_content === "string" && part.reasoning_content.length > 0) return part.reasoning_content
    if (typeof part.reasoning_details === "string" && part.reasoning_details.length > 0) return part.reasoning_details
  }
  return ""
}

export function listDisplayableTranscriptPartTypes<TPart extends DisplayableTranscriptPartLike>(
  parts: TPart[] | undefined,
): string[] {
  if (!parts?.length) return []
  return parts
    .filter((part) => {
      if (!part || part.synthetic || part.ignored) return false
      if (part.type === "text" || part.type === "reasoning") {
        return getTranscriptPartText(part).trim().length > 0
      }
      return part.type === "tool"
    })
    .map((part) => part.type)
}

function visibleTextParts(parts: Part[]): string {
  return parts
    .filter((part): part is Part & { type: "text"; text: string } => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => part.text)
    .filter(Boolean)
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0)
    .join(" ")
}

function collectToolParts(parts: Part[]) {
  return parts.filter((part): part is Part & { type: "tool"; tool: string; state?: { status?: string } } => part.type === "tool")
}

function buildToolPreview(parts: Part[], activeName?: string): string {
  const toolParts = collectToolParts(parts)
  if (toolParts.length === 0) {
    return ""
  }

  if (toolParts.length === 1) {
    const name = activeName ?? toolParts[0].tool
    return activeName ? `tool ${name} running` : `tool ${name} executed`
  }

  const base = `${toolParts.length} tools`
  return activeName ? `${base} running` : `${base} executed`
}

function describeTrace(
  message: UserMessage | AssistantMessage,
  status: TranscriptTurnStatus,
  args: { toolCount: number; activeToolName?: string; hasText: boolean },
) {
  if (message.role === "user") {
    return "intent uplink"
  }

  if (status === "error") {
    return message.error?.name ? Locale.titlecase(message.error.name.replace(/Error$/, "")) : "signal fracture"
  }

  if (status === "tooling") {
    return args.activeToolName ? `${args.activeToolName} live` : "tool convoy live"
  }

  if (status === "waiting") {
    return args.toolCount > 0 ? "awaiting tool return" : "awaiting continuation"
  }

  if (status === "running") {
    return args.hasText ? "response forming" : "reasoning live"
  }

  if (status === "truncated") {
    return "context edge"
  }

  if (args.toolCount > 0 && args.hasText) {
    return `${args.toolCount} tool${args.toolCount === 1 ? "" : "s"} resolved`
  }

  if (args.toolCount > 0) {
    return `${args.toolCount} tool${args.toolCount === 1 ? "" : "s"} completed`
  }

  return "response sealed"
}

function statusLabelFor(message: UserMessage | AssistantMessage, parts: Part[]): TranscriptTurnStatus {
  if (message.role === "user") {
    return "user"
  }

  if (message.error) {
    return "error"
  }

  const toolParts = collectToolParts(parts)
  const activeTool = toolParts.some((part) => part.state?.status === "running" || part.state?.status === "pending")

  if (!message.time.completed) {
    if (message.finish === "tool-calls") {
      return activeTool ? "tooling" : "waiting"
    }

    if (activeTool) {
      return "tooling"
    }

    return "running"
  }

  if (message.finish === "length") {
    return "truncated"
  }

  return "complete"
}

function statusDisplay(
  role: UserMessage["role"] | AssistantMessage["role"],
  status: TranscriptTurnStatus,
): { label: string; icon: string } {
  if (role === "user") {
    return { label: "intent", icon: "↗" }
  }

  switch (status) {
    case "running":
      return { label: "thinking", icon: "◔" }
    case "waiting":
      return { label: "handoff", icon: "◒" }
    case "tooling":
      return { label: "convoy", icon: "⌬" }
    case "truncated":
      return { label: "overflow", icon: "◧" }
    case "error":
      return { label: "fracture", icon: "✖" }
    case "complete":
      return { label: "sealed", icon: "✓" }
    default:
      return { label: "sealed", icon: "✓" }
  }
}

export function deriveTurnSurface(
  message: UserMessage | AssistantMessage,
  parts: Part[] = [],
  options: TurnSurfaceOptions = {},
): TranscriptTurnSurface {
  const previewLength = options.previewLength ?? 60
  const status = statusLabelFor(message, parts)
  const toolParts = collectToolParts(parts)
  const activeTools = toolParts.filter(
    (part) => part.state?.status === "running" || part.state?.status === "pending",
  )
  const activeToolName = activeTools.at(-1)?.tool

  const rawText = visibleTextParts(parts)
  const toolPreview = buildToolPreview(parts, activeToolName)

  const preview =
    message.role === "user"
      ? Locale.truncate(rawText, previewLength) || "(no content)"
      : Locale.truncate(rawText || toolPreview || "", previewLength) || "(thinking...)"

  const statusDisplayValue = statusDisplay(message.role, status)
  const traceLabel = describeTrace(message, status, {
    toolCount: toolParts.length,
    activeToolName,
    hasText: rawText.length > 0,
  })

  return {
    messageID: message.id,
    timestamp: message.time.created ?? 0,
    role: message.role,
    status,
    statusLabel: statusDisplayValue.label,
    statusIcon: statusDisplayValue.icon,
    roleLabel: message.role === "user" ? "uplink" : "organism",
    traceLabel,
    preview,
    toolCount: toolParts.length,
    activeToolCount: activeTools.length,
    activeToolName,
    hasText: rawText.length > 0,
    tokens:
      message.role === "assistant"
        ? (message.tokens?.input ?? 0) + (message.tokens?.output ?? 0) + (message.tokens?.reasoning ?? 0)
        : undefined,
    cost: message.role === "assistant" ? message.cost : undefined,
  }
}

export function deriveTurnBoundary(
  surface: TranscriptTurnSurface,
  options: TranscriptTurnBoundaryOptions = {},
): TranscriptTurnBoundary {
  if (surface.role === "user") {
    if (options.isBranchTurn) {
      return {
        headerLabel: "BRANCH ARC",
        footerLabel: "intent anchored in a branch lane",
        dividerLabel: " Branch Fold ",
      }
    }

    return {
      headerLabel: "INTENT ARC",
      footerLabel: "intent anchored in the root",
      dividerLabel: " Intent Fold ",
    }
  }

  switch (surface.status) {
    case "tooling":
      return {
        headerLabel: "CONVOY ARC",
        footerLabel: options.isBranchTurn
          ? "branch convoy is carrying the live turn"
          : "tool convoy is carrying the live turn",
        dividerLabel: options.isBranchTurn ? " Branch Convoy Fold " : " Convoy Fold ",
      }
    case "waiting":
      return {
        headerLabel: "HANDOFF ARC",
        footerLabel: options.isBranchTurn
          ? "the branch is holding for a returning lane"
          : "the organism is holding for a returning lane",
        dividerLabel: options.isBranchTurn ? " Branch Handoff Fold " : " Handoff Fold ",
      }
    case "running":
      return {
        headerLabel: "THOUGHT ARC",
        footerLabel: options.isBranchTurn
          ? "the branch is shaping the next answer"
          : "the organism is shaping the next answer",
        dividerLabel: options.isBranchTurn ? " Branch Thought Fold " : " Thought Fold ",
      }
    case "truncated":
      return {
        headerLabel: "EDGE ARC",
        footerLabel: options.isBranchTurn
          ? "the branch sheared at the context boundary"
          : "the turn sheared at the context boundary",
        dividerLabel: options.isBranchTurn ? " Branch Edge Fold " : " Edge Fold ",
      }
    case "error":
      return {
        headerLabel: "FRACTURE ARC",
        footerLabel: options.isBranchTurn
          ? "the branch response fractured and fell out of band"
          : "the response fractured and fell out of band",
        dividerLabel: options.isBranchTurn ? " Branch Fracture Fold " : " Fracture Fold ",
      }
    case "complete":
      return {
        headerLabel: "SEALED ARC",
        footerLabel: options.isBranchTurn
          ? "the branch reply closed cleanly into the transcript"
          : "the response closed cleanly into the transcript",
        dividerLabel: options.isBranchTurn ? " Branch Sealed Fold " : " Sealed Fold ",
      }
    default:
      return {
        headerLabel: "SIGNAL ARC",
        footerLabel: options.isBranchTurn
          ? "the branch is holding the turn body together"
          : "the organism is holding the turn body together",
        dividerLabel: options.isBranchTurn ? " Branch Signal Fold " : " Signal Fold ",
      }
  }
}

export function deriveTurnCeremony(input: {
  message: UserMessage | AssistantMessage
  parts: Part[]
  messages: Array<UserMessage | AssistantMessage>
  partsByMessage?: Record<string, Part[] | undefined>
  isBranchTurn?: boolean
}): TranscriptTurnCeremony {
  const { message, parts, messages, partsByMessage, isBranchTurn } = input
  const surface = deriveTurnSurface(message, parts)
  let ceremony: TranscriptTurnCeremony = {}

  if (message.role === "user") {
    const firstUser = messages.find((entry) => entry.role === "user")
    if (firstUser?.id !== message.id) {
      return {
        ...ceremony,
        roleLabel: deriveCeremonyRoleLabel(undefined, message.role),
      }
    }
    ceremony = {
      label: "FIRST UPLINK",
      detail: isBranchTurn
        ? "opening branch call cast off the main stem"
        : "opening call cast into the central body",
    }
  } else {
    const firstAssistant = messages.find((entry) => entry.role === "assistant")
    const firstToolBearingAssistant = messages.find((entry) => {
      if (entry.role !== "assistant") return false
      const turnParts = partsByMessage?.[entry.id] ?? []
      return turnParts.some((part) => part.type === "tool")
    })
    const firstTaskAssistant = messages.find((entry) => {
      if (entry.role !== "assistant") return false
      const turnParts = partsByMessage?.[entry.id] ?? []
      return turnParts.some((part) => part.type === "tool" && part.tool === "task")
    })
    const hasTool = parts.some((part) => part.type === "tool")
    const hasTaskTool = parts.some((part) => part.type === "tool" && part.tool === "task")

    if (!isBranchTurn && firstTaskAssistant?.id === message.id && hasTaskTool) {
      ceremony = {
        label: "FIRST RETURN",
        detail: "the swarm's first answer folded back into the central body",
      }
    } else if (firstToolBearingAssistant?.id === message.id && hasTool && surface.status === "tooling") {
      ceremony = {
        label: "FIRST CONVOY",
        detail: isBranchTurn
          ? "the opening branch reach is moving through the lane"
          : "the organism is making its first outward reach",
      }
    } else if (firstAssistant?.id !== message.id) {
      ceremony = {}
    } else if (message.error?.name === "MessageAbortedError") {
      ceremony = {
        label: "FIRST HOLD",
        detail: isBranchTurn
          ? "the opening branch answer paused for operator input"
          : "the opening answer paused for operator input",
      }
    } else if (message.error) {
      ceremony = {
        label: "FIRST FRACTURE",
        detail: isBranchTurn
          ? "the opening branch answer fractured before it could settle"
          : "the opening answer fractured before it could settle",
      }
    } else if (surface.status === "waiting") {
      ceremony = {
        label: "FIRST HANDOFF",
        detail: isBranchTurn
          ? "opening branch reach awaiting return"
          : "opening reach awaiting return",
      }
    } else if (surface.status === "complete") {
      ceremony = {
        label: "FIRST SIGNAL",
        detail: isBranchTurn
          ? "opening branch answer settled cleanly off the main stem"
          : "opening answer settled into the central body",
      }
    } else if (surface.status === "running") {
      ceremony = {
        label: "FIRST SIGNAL",
        detail: isBranchTurn
          ? "opening branch answer crossing the lane"
          : "opening answer crossing the bay",
      }
    } else {
      ceremony = {}
    }
  }

  return {
    ...ceremony,
    roleLabel: deriveCeremonyRoleLabel(ceremony.label, message.role),
  }
}

export function deriveCeremonyRoleLabel(
  ceremonyLabel: string | undefined,
  fallbackRole: UserMessage["role"] | AssistantMessage["role"] = "assistant",
): TranscriptCeremonyRole {
  if (!ceremonyLabel) {
    return fallbackRole === "user" ? "uplink" : "organism"
  }

  if (ceremonyLabel.endsWith("UPLINK")) {
    return "uplink"
  }
  if (ceremonyLabel.endsWith("CONVOY")) {
    return "convoy"
  }
  if (ceremonyLabel.endsWith("HANDOFF")) {
    return "handoff"
  }
  if (ceremonyLabel.endsWith("HOLD")) {
    return "hold"
  }
  if (ceremonyLabel.endsWith("FRACTURE")) {
    return "fracture"
  }
  if (ceremonyLabel.endsWith("RETURN")) {
    return "return"
  }
  if (ceremonyLabel.endsWith("SIGNAL")) {
    return "signal"
  }
  if (ceremonyLabel === "AFTERGLOW") {
    return "afterglow"
  }

  return fallbackRole === "user" ? "uplink" : "organism"
}

export function deriveAssistantCeremonyCopy(input: {
  state: AssistantCeremonyState
  isBranchTurn?: boolean
  toolLabel?: string
}): TranscriptTurnCeremony {
  const toolLabel = input.toolLabel ?? "tool convoy"
  const withRole = (label: string, detail: string): TranscriptTurnCeremony => ({
    label,
    detail,
    roleLabel: deriveCeremonyRoleLabel(label, "assistant"),
  })

  switch (input.state) {
    case "hold_operator":
      return withRole(
        "FIRST HOLD",
        input.isBranchTurn
          ? "the opening branch reach paused for operator input"
          : "the opening reach paused for operator input",
      )
    case "hold_safe":
      return withRole(
        "FIRST HOLD",
        input.isBranchTurn
          ? "the opening branch answer stopped at a safe boundary"
          : "the opening answer stopped at a safe boundary",
      )
    case "fracture":
      return withRole(
        "FIRST FRACTURE",
        input.isBranchTurn
          ? "the opening branch answer fractured before it could settle"
          : "the opening answer fractured before it could settle",
      )
    case "convoy_start":
      return withRole(
        "FIRST CONVOY",
        input.isBranchTurn
          ? `${toolLabel} · the opening branch reach is moving through the lane`
          : `${toolLabel} · the organism is making its first outward reach`,
      )
    case "convoy_queue":
      return withRole(
        "FIRST CONVOY",
        input.isBranchTurn ? `${toolLabel} · the opening branch reach is queuing` : `${toolLabel} · the opening reach is queuing`,
      )
    case "convoy_hold":
      return withRole(
        "FIRST HOLD",
        input.isBranchTurn
          ? `${toolLabel} · the opening branch reach is waiting for the next clear signal`
          : `${toolLabel} · the opening reach is waiting for the next clear signal`,
      )
    case "convoy_long":
      return withRole(
        "FIRST HOLD",
        input.isBranchTurn
          ? `${toolLabel} · the opening branch reach is taking longer than usual`
          : `${toolLabel} · the organism's first reach is taking longer than usual`,
      )
    case "handoff_wait":
      return withRole(
        "FIRST HANDOFF",
        input.isBranchTurn ? "opening branch reach awaiting return" : "opening reach awaiting return",
      )
    case "handoff_hold":
      return withRole(
        "FIRST HANDOFF",
        input.isBranchTurn
          ? "the opening branch reach is listening for convoy return"
          : "the opening reach is listening for tool return",
      )
    case "handoff_long":
      return withRole(
        "FIRST HOLD",
        input.isBranchTurn
          ? "the opening branch reach is still listening for return"
          : "the opening reach is still listening for return",
      )
    case "signal_stream":
      return withRole(
        "FIRST SIGNAL",
        input.isBranchTurn ? "opening branch answer crossing the lane" : "opening answer crossing the bay",
      )
    case "signal_settled":
      return withRole(
        "FIRST SIGNAL",
        input.isBranchTurn
          ? "opening branch answer settled cleanly off the main stem"
          : "opening answer settled into the central body",
      )
    case "signal_afterglow":
      return withRole(
        "AFTERGLOW",
        input.isBranchTurn
          ? "first branch answer cooling into a steady side trace"
          : "first answer cooling into the central trace",
      )
    case "signal_quiet":
      return {
        label: "QUIET",
        detail: input.isBranchTurn
          ? "the branch trace is resting off the main stem"
          : "sealed and resting in the central body",
        roleLabel: deriveCeremonyRoleLabel("QUIET"),
      }
    case "return_settled":
      return withRole("FIRST RETURN", "the swarm's first answer folded back into the central body")
    case "return_afterglow":
      return withRole("AFTERGLOW", "first swarm return cooling into the central trace")
  }
}

export function formatTranscript(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions,
): string {
  const providers = Model.index(options.providers)
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  for (const msg of messages) {
    transcript += formatMessage(msg.info, msg.parts, options, providers)
    transcript += `---\n\n`
  }

  return transcript
}

export function formatMessage(
  msg: UserMessage | AssistantMessage,
  parts: Part[],
  options: TranscriptOptions,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
): string {
  let result = ""

  if (msg.role === "user") {
    result += `## User\n\n`
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata, providers ?? options.providers)
  }

  for (const part of parts) {
    result += formatPart(part, options)
  }

  return result
}

export function formatAssistantHeader(
  msg: AssistantMessage,
  includeMetadata: boolean,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""

  const modelName = Model.name(providers, msg.providerID, msg.modelID)

  return `## Assistant (${Locale.titlecase(msg.agent)} · ${modelName}${duration ? ` · ${duration}` : ""})\n\n`
}

export function formatPart(part: Part, options: TranscriptOptions): string {
  if (part.type === "text" && !part.synthetic) {
    return `${part.text}\n\n`
  }

  if (part.type === "reasoning") {
    if (options.thinking) {
      return `_Thinking:_\n\n${part.text}\n\n`
    }
    return ""
  }

  if (part.type === "tool") {
    let result = `**Tool: ${part.tool}**\n`
    if (options.toolDetails && part.state.input) {
      result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n`
    }
    if (options.toolDetails && part.state.status === "completed" && part.state.output) {
      result += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\`\n`
    }
    if (options.toolDetails && part.state.status === "error" && part.state.error) {
      result += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\`\n`
    }
    result += `\n`
    return result
  }

  return ""
}
