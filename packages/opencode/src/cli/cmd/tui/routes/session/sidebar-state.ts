import type { AssistantMessage, Message, Part, Provider } from "@opencode-ai/sdk/v2"

export type ModelContextSnapshot = {
  label: string
  contextPercent: number | undefined
  contextUsed: number
  contextLimit: number | undefined
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  spend: number
}

export type AssistantTokenSummary = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

type TaskLaunchState = {
  metadata?: Record<string, unknown>
  input?: Record<string, unknown>
  status?: string
}

function readStringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function readAssistantTokens(message: AssistantMessage): AssistantTokenSummary {
  const tokens = message.tokens
  if (!tokens) {
    return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  }

  const cache = tokens.cache
  return {
    input: tokens.input ?? 0,
    output: tokens.output ?? 0,
    reasoning: tokens.reasoning ?? 0,
    cacheRead: cache?.read ?? 0,
    cacheWrite: cache?.write ?? 0,
  }
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export type FamilySessionLike = {
  id: string
  parentID?: string | null
  title?: string | null
  time?: {
    updated?: number | null
    created?: number | null
  } | null
}

export type FlattenedFamilySession<T extends FamilySessionLike> = T & {
  depth: number
}

export type ChildTaskLaunch = {
  sessionID: string
  status: string
  title: string
  updatedAt: number
}

export function resolveSidebarDeckTitle(args: {
  sessionTitle?: string | null
  rootSessionTitle?: string | null
}) {
  const sessionTitle = args.sessionTitle?.trim()
  if (sessionTitle) return sessionTitle

  const rootSessionTitle = args.rootSessionTitle?.trim()
  if (rootSessionTitle) return rootSessionTitle

  return "Session"
}

export function flattenFamilySessions<T extends FamilySessionLike>(args: {
  sessions: T[]
  rootSessionID: string
}) {
  const childrenByParent = new Map<string, T[]>()
  const sessionMap = new Map(args.sessions.map((session) => [session.id, session]))

  for (const session of args.sessions) {
    if (session.id === args.rootSessionID) continue
    if (!session.parentID) continue
    const current = childrenByParent.get(session.parentID) ?? []
    current.push(session)
    childrenByParent.set(session.parentID, current)
  }

  const compare = (left: T, right: T) => {
    const leftTime = left.time?.updated ?? left.time?.created ?? 0
    const rightTime = right.time?.updated ?? right.time?.created ?? 0
    if (leftTime !== rightTime) return rightTime - leftTime
    return left.id.localeCompare(right.id)
  }

  const flattened: Array<FlattenedFamilySession<T>> = []
  const visited = new Set<string>()
  const totalSessions = args.sessions.filter((session) => session.id !== args.rootSessionID).length

  const visitSession = (session: T, depth: number) => {
    if (visited.has(session.id)) return
    visited.add(session.id)
    flattened.push({
      ...session,
      depth,
    })
    visitChildren(session.id, depth + 1)
  }

  function visitChildren(parentID: string, depth: number) {
    const children = (childrenByParent.get(parentID) ?? []).toSorted(compare)
    for (const child of children) {
      visitSession(child, depth)
    }
  }

  visitChildren(args.rootSessionID, 0)

  while (visited.size < totalSessions) {
    const remaining = args.sessions
      .filter((session) => session.id !== args.rootSessionID && !visited.has(session.id))
      .filter((session) => !session.parentID || !sessionMap.has(session.parentID) || visited.has(session.parentID))
      .toSorted(compare)

    const nextRoots = remaining.length > 0 ? remaining : args.sessions.filter((session) => session.id !== args.rootSessionID && !visited.has(session.id)).toSorted(compare)
    if (nextRoots.length === 0) break
    for (const session of nextRoots) {
      visitSession(session, 0)
    }
  }

  return flattened
}

export function resolveChildTaskLaunches(
  messages: Message[],
  partsByMessage: Record<string, Part[] | undefined>,
) {
  const launches = new Map<string, ChildTaskLaunch>()

  for (const message of messages) {
    const parts = partsByMessage[message.id] ?? []
    for (const part of parts) {
      if (part.type !== "tool" || part.tool !== "task") continue
      const state = part.state as TaskLaunchState | undefined
      if (!state) continue

      const metadata = state.metadata ?? {}
      const sessionID = readStringField(metadata, "sessionId")
      if (!sessionID) continue

      const subagentInput = state.input ?? {}
      const subagentType = readStringField(subagentInput, "subagent_type")
      const description = readStringField(metadata, "title") ?? readStringField(subagentInput, "description")

      launches.set(sessionID, {
        sessionID,
        status: state.status ?? "",
        title: description ?? `${(subagentType && subagentType.trim()) || "Unknown"} task`,
        updatedAt: message.time.created,
      })
    }
  }

  return launches
}

export function buildLatestAssistant(messages: Message[]) {
  return messages.findLast((item): item is AssistantMessage => item.role === "assistant")
}

export function hasMeaningfulUsage(message: AssistantMessage) {
  return tokensUsed(message) > 0 || (message.cost ?? 0) > 0
}

export function tokensUsed(message: AssistantMessage) {
  const values = readAssistantTokens(message)
  return values.input + values.output + values.reasoning + values.cacheRead + values.cacheWrite
}

export function buildLatestAssistantWithUsage(messages: Message[]) {
  return messages.findLast((item): item is AssistantMessage => item.role === "assistant" && hasMeaningfulUsage(item))
}

export function pickModelContextAssistant(messages: Message[]) {
  return buildLatestAssistantWithUsage(messages) ?? buildLatestAssistant(messages)
}

export function getAssistantTokenSummary(message: AssistantMessage | undefined): AssistantTokenSummary {
  if (!message) return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  return readAssistantTokens(message)
}

export function buildModelContextSummary(args: {
  messages: Message[]
  providers: Provider[]
}) {
  const latestAssistant = pickModelContextAssistant(args.messages)
  if (!latestAssistant) return undefined

  const provider = args.providers.find((entry) => entry.id === latestAssistant.providerID)
  const model = latestAssistant.modelID ? provider?.models[latestAssistant.modelID] : undefined
  const contextLimit = typeof model?.limit?.context === "number" ? model.limit.context : undefined
  const tokenSummary = getAssistantTokenSummary(latestAssistant)
  const contextUsed = tokensUsed(latestAssistant)
  const contextPercent = contextLimit === undefined ? undefined : clampPercent((contextUsed * 100) / contextLimit)
  const spend = typeof latestAssistant.cost === "number" ? latestAssistant.cost : 0

  return {
    label:
      provider && latestAssistant.modelID
        ? `${provider.id}/${latestAssistant.modelID}`
        : `${latestAssistant.providerID ?? "provider"}/${latestAssistant.modelID ?? "model"}`,
    contextPercent,
    contextUsed,
    contextLimit,
    input: tokenSummary.input,
    output: tokenSummary.output,
    reasoning: tokenSummary.reasoning,
    cacheRead: tokenSummary.cacheRead,
    cacheWrite: tokenSummary.cacheWrite,
    spend,
  }
}
