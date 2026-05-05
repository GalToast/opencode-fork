import { Bus } from "@/bus"
import { BusEvent, type BusEventDefinition } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { RetrievalBaton, RetrievalService, type RetrievalSourceType } from "@/retrieval"
import { AgentOperatingState } from "@/session/agent-state"
import { Session } from "@/session"
import { SessionWorldState } from "@/session/world-state"
import { ReasoningLedger as SessionReasoningLedger } from "@/session/reasoning-ledger"
import { SessionSocialMemory } from "@/session/social-memory"
import { Storage } from "@/storage/storage"
import { createHash } from "crypto"
import z from "zod"

/* eslint-disable-next-line @typescript-eslint/no-namespace */
export namespace SessionWorkGraph {
  const maxObjectives = 24
  const maxLanes = 64
  const maxArtifacts = 64
  const semanticCacheMax = 48
  const semanticCacheTTL = 20 * 60 * 1000
  const emptyObjective = "No active objective recorded yet."
  const semanticStopwords = new Set([
    "a",
    "an",
    "and",
    "are",
    "artifacts",
    "attempt",
    "at",
    "be",
    "blocked",
    "build",
    "can",
    "constraints",
    "current",
    "did",
    "do",
    "does",
    "existing",
    "for",
    "free",
    "from",
    "have",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "just",
    "lane",
    "lanes",
    "let",
    "like",
    "make",
    "me",
    "model",
    "my",
    "not",
    "objective",
    "of",
    "on",
    "option",
    "or",
    "our",
    "out",
    "recent",
    "right",
    "same",
    "so",
    "stay",
    "task",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "to",
    "try",
    "trying",
    "up",
    "use",
    "was",
    "we",
    "what",
    "with",
    "work",
    "would",
    "you",
    "your",
  ])
  type Entry<T> = {
    at: number
    value: T
  }

  let semanticCacheMaxForTest: number | undefined
  let semanticCacheTTLForTest: number | undefined

  const semanticArtifactIndexState = new Map<string, Entry<string>>()
  const semanticSessionIndexState = new Map<string, Entry<number>>()
  const semanticDigestState = new Map<
    string,
    Entry<{
      fingerprint: string
      result: {
        patterns: SemanticPattern[]
        planningPolicy?: PlanningPolicy
        decompositionPolicy?: DecompositionPolicy
        relevantSessionCount: number
        indexedSessionCount: number
        artifactIndexRefreshed: boolean
      }
    }>
  >()
  const semanticSearchState = new Map<
    string,
    Entry<{
      fingerprint: string
      result: {
        candidates: Awaited<ReturnType<typeof RetrievalService.search>>["candidates"]
        runID: string
        relevantSessionCount: number
        indexedSessionCount: number
        artifactIndexRefreshed: boolean
      }
    }>
  >()
  const semanticSearchInflight = new Map<
    string,
    {
      fingerprint: string
      promise: Promise<{
        candidates: Awaited<ReturnType<typeof RetrievalService.search>>["candidates"]
        runID: string
        relevantSessionCount: number
        indexedSessionCount: number
        artifactIndexRefreshed: boolean
      }>
    }
  >()

  function semanticCacheMaxValue() {
    return semanticCacheMaxForTest ?? semanticCacheMax
  }

  function semanticCacheTTLValue() {
    return semanticCacheTTLForTest ?? semanticCacheTTL
  }

  function trim<T>(map: Map<string, Entry<T>>) {
    while (map.size > semanticCacheMaxValue()) {
      const first = map.keys().next().value
      if (!first) return
      map.delete(first)
    }
  }

  function readCache<T>(map: Map<string, Entry<T>>, key: string) {
    const item = map.get(key)
    if (!item) return
    if (Date.now() - item.at > semanticCacheTTLValue()) {
      map.delete(key)
      return
    }
    map.delete(key)
    map.set(key, {
      at: item.at,
      value: item.value,
    })
    return item.value
  }

  function writeCache<T>(map: Map<string, Entry<T>>, key: string, value: T) {
    map.delete(key)
    map.set(key, {
      at: Date.now(),
      value,
    })
    trim(map)
    return value
  }

  function clearSemanticCacheForSession(sessionID: string): void {
    semanticArtifactIndexState.delete(sessionID)
    for (const key of semanticSessionIndexState.keys()) {
      if (key === sessionID || key.endsWith(`:${sessionID}`)) {
        semanticSessionIndexState.delete(key)
      }
    }
    for (const key of semanticDigestState.keys()) {
      if (key === sessionID || key.endsWith(`:${sessionID}`)) {
        semanticDigestState.delete(key)
      }
    }
    for (const key of semanticSearchState.keys()) {
      if (key === sessionID || key.endsWith(`:${sessionID}`)) {
        semanticSearchState.delete(key)
      }
    }
    for (const key of semanticSearchInflight.keys()) {
      if (key === sessionID || key.endsWith(`:${sessionID}`)) {
        semanticSearchInflight.delete(key)
      }
    }
  }

  export function clearSessionCache(sessionID: string): void {
    clearSemanticCacheForSession(sessionID)
  }

  export function resetCaches(): void {
    semanticArtifactIndexState.clear()
    semanticSessionIndexState.clear()
    semanticDigestState.clear()
    semanticSearchState.clear()
    semanticSearchInflight.clear()
  }

  export function setSemanticCachePolicyForTest(input?: { max?: number; ttl?: number }) {
    semanticCacheMaxForTest = input?.max
    semanticCacheTTLForTest = input?.ttl
  }

  export function collectSessionFamilyIDs(rootSessionID: string) {
    const byParent = new Map<string, string[]>()
    for (const session of Session.list({ limit: 10_000 })) {
      if (!session.parentID) continue
      const children = byParent.get(session.parentID) ?? []
      children.push(session.id)
      byParent.set(session.parentID, children)
    }
    const family: string[] = []
    const queue = [rootSessionID]
    const seen = new Set<string>()
    while (queue.length > 0) {
      const current = queue.shift()!
      if (seen.has(current)) continue
      seen.add(current)
      family.push(current)
      queue.push(...(byParent.get(current) ?? []))
    }
    return family
  }

  export const ObjectiveStatus = z.enum(["active", "blocked", "completed", "canceled"]).meta({
    ref: "SessionWorkGraphObjectiveStatus",
  })
  export type ObjectiveStatus = z.infer<typeof ObjectiveStatus>

  export const LaneStatus = z.enum(["queued", "running", "blocked", "completed", "error", "canceled"]).meta({
    ref: "SessionWorkGraphLaneStatus",
  })
  export type LaneStatus = z.infer<typeof LaneStatus>

  export const Objective = z
    .object({
      id: Identifier.schema("part"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
      title: z.string(),
      constraintsSummary: z.string().optional(),
      status: ObjectiveStatus,
      createdAt: z.number(),
      updatedAt: z.number(),
    })
    .meta({
      ref: "SessionWorkGraphObjective",
    })
  export type Objective = z.infer<typeof Objective>

  export const Lane = z
    .object({
      id: z.string(),
      sessionID: Identifier.schema("session"),
      taskID: Identifier.schema("session").optional(),
      title: z.string(),
      status: LaneStatus,
      schedulerLane: z.string().optional(),
      discipline: z.string().optional(),
      priority: z.string().optional(),
      subagentType: z.string().optional(),
      lastMessageID: Identifier.schema("message").optional(),
      updatedAt: z.number(),
      createdAt: z.number(),
    })
    .meta({
      ref: "SessionWorkGraphLane",
    })
  export type Lane = z.infer<typeof Lane>

export const Artifact = z
    .object({
      id: Identifier.schema("part"),
      sessionID: Identifier.schema("session"),
      taskID: Identifier.schema("session").optional(),
      messageID: Identifier.schema("message").optional(),
      type: z.string(),
      summary: z.string(),
      outcome: z.enum(["success", "failure", "partial"]).optional(),
      createdAt: z.number(),
    })
    .meta({
      ref: "SessionWorkGraphArtifact",
    })
  export type Artifact = z.infer<typeof Artifact>

  export const Info = z
    .object({
      rootSessionID: Identifier.schema("session"),
      createdAt: z.number(),
      updatedAt: z.number(),
      latestSessionID: Identifier.schema("session"),
      objectives: z.array(Objective),
      lanes: z.array(Lane),
      artifacts: z.array(Artifact),
    })
    .meta({
      ref: "SessionWorkGraph",
    })
  export type Info = z.infer<typeof Info>

  export const Block = z
    .object({
      type: z.literal("text"),
      title: z.string(),
      text: z.string(),
    })
    .meta({
      ref: "SessionWorkGraphBlock",
    })
  export type Block = z.infer<typeof Block>

  export const SemanticPattern = z
    .object({
      sourceType: z.string(),
      title: z.string().optional(),
      signal: z.number(),
      scope: z.string().optional(),
      text: z.string(),
    })
    .meta({
      ref: "SessionWorkGraphSemanticPattern",
    })
  export type SemanticPattern = z.infer<typeof SemanticPattern>

  export const PlanningPolicy = z
    .object({
      mode: z.enum(["baseline", "semantic"]),
      query: z.string(),
      runID: z.string().optional(),
      scopeMix: z.string(),
      patternCount: z.number().int().min(0),
      topPatternSummaries: z.array(z.string()).max(3),
    })
    .meta({
      ref: "SessionWorkGraphPlanningPolicy",
    })
  export type PlanningPolicy = z.infer<typeof PlanningPolicy>

  export const DecompositionPolicy = z
    .object({
      mode: z.enum(["baseline", "semantic"]),
      query: z.string(),
      runID: z.string().optional(),
      scopeMix: z.string(),
      patternCount: z.number().int().min(0),
      suggestedLaneCount: z.number().int().min(1).max(6),
      parallelStrategy: z.enum(["serial", "parallel", "hybrid"]),
      checkpointHints: z.array(z.string()).max(3),
      expectedArtifacts: z.array(z.string()).max(4),
      topTopologySummaries: z.array(z.string()).max(3),
    })
    .meta({
      ref: "SessionWorkGraphDecompositionPolicy",
    })
  export type DecompositionPolicy = z.infer<typeof DecompositionPolicy>

  export const AgentState = AgentOperatingState
  export type AgentState = z.infer<typeof AgentState>

  export const Materialized = z
    .object({
      rootSessionID: Identifier.schema("session"),
      blocks: z.array(Block),
      semanticPatterns: z.array(SemanticPattern).optional(),
      worldState: SessionWorldState.Materialized.optional(),
      socialMemory: SessionSocialMemory.Materialized.optional(),
      reasoningLedger: SessionReasoningLedger.Materialized.optional(),
      planningPolicy: PlanningPolicy.optional(),
      decompositionPolicy: DecompositionPolicy.optional(),
      agentState: AgentState.optional(),
      text: z.string(),
    })
    .meta({
      ref: "SessionWorkGraphMaterialized",
    })
  export type Materialized = z.infer<typeof Materialized>

  export type MaterializeDiagnostics = {
    reasoningLedgerDurationMS?: number
    semanticDurationMS?: number
    worldStateDurationMS?: number
    socialMemoryDurationMS?: number
    digestDurationMS?: number
    relevantSemanticSessionCount?: number
    indexedSemanticSessionCount?: number
    semanticArtifactIndexRefreshed?: boolean
    semanticPatternCount?: number
  }

  export const Event = {
    Updated: BusEvent.define(
      "session.workgraph.updated",
      z.object({
        info: Info,
      }),
    ),
    LaneUpdateFailed: BusEvent.define(
      "session.workgraph.lane.update.failed",
      z.object({
        taskID: z.string(),
        status: z.string(),
        error: z.string(),
        errorCount: z.number(),
      }),
    ),
    ArtifactUpdateFailed: BusEvent.define(
      "session.workgraph.artifact.update.failed",
      z.object({
        taskID: z.string(),
        type: z.string(),
        error: z.string(),
        errorCount: z.number(),
      }),
    ),
  }

  export async function recordLane(input: {
    sessionID: string
    rootSessionID: string
    laneID: string
    title: string
    status: LaneStatus
    schedulerLane?: string
    discipline?: string
    priority?: string
    subagentType?: string
    lastMessageID?: string
    updatedAt?: number
  }) {
    const at = input.updatedAt ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
    const existingLane = current.lanes.find((lane) => lane.id === input.laneID)
    const lane: Lane = {
      id: input.laneID,
      sessionID: input.sessionID,
      title: input.title,
      status: input.status,
      updatedAt: at,
      createdAt: existingLane?.createdAt ?? at,
      schedulerLane: input.schedulerLane,
      discipline: input.discipline,
      priority: input.priority,
      subagentType: input.subagentType,
      lastMessageID: input.lastMessageID,
    }
    const next: Info = {
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      lanes: trimLog(
        [...current.lanes.filter((l) => l.id !== input.laneID), lane].sort(
          (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
        ),
        maxLanes,
      ),
    }
    return write(next)
  }

  export function init(events: { LaneUpdated: BusEventDefinition }) {
    Bus.subscribe(events.LaneUpdated, (payload) => {
      const p = payload.properties as { latest?: { sessionID: string; supervisorSessionID?: string; jobID: string; description: string; lane?: string; priority?: string; status: string } }
      if (!p.latest) return

      const job = p.latest
      // Job description often has format "[discipline:priority] description" or similar
      const match = job.description.match(/^\[([^:]+):([^\]]+)\]\s*(.*)$/)
      const discipline = match ? match[1] : undefined
      const priority = match ? match[2] : job.priority
      const title = match ? match[3] : job.description

      void recordLane({
        sessionID: job.sessionID,
        rootSessionID: job.supervisorSessionID || job.sessionID,
        laneID: job.jobID,
        title: title || job.jobID,
        status: job.status as LaneStatus,
        schedulerLane: job.lane,
        discipline,
        priority,
      })
    })
  }

  function key(rootSessionID: string) {
    return ["session_workgraph", rootSessionID]
  }

  function trimLog<T>(items: T[], limit: number) {
    return items.slice(Math.max(0, items.length - limit))
  }

  function fallback(input: { rootSessionID: string; sessionID: string; at: number }): Info {
    return {
      rootSessionID: input.rootSessionID,
      createdAt: input.at,
      updatedAt: input.at,
      latestSessionID: input.sessionID,
      objectives: [],
      lanes: [],
      artifacts: [],
    }
  }

  async function write(info: Info) {
    await Storage.write(key(info.rootSessionID), info)
    await Bus.publish(Event.Updated, { info })
    return info
  }

  function block(title: string, lines: Array<string | undefined>) {
    const text = lines
      .map((line) => line?.trim())
      .filter((line): line is string => !!line)
      .join("\n")
      .trim()
    if (!text) return undefined
    return {
      type: "text" as const,
      title,
      text,
    }
  }

  function semanticIndexKey(projectID: string, sessionID: string) {
    return `${projectID}:${sessionID}`
  }

  function semanticArtifactIndexFingerprint(info: Info) {
    const latestArtifactAt = info.artifacts.reduce((max, artifact) => Math.max(max, artifact.createdAt), 0)
    return JSON.stringify({
      artifactCount: info.artifacts.length,
      latestArtifactAt,
    })
  }

  function relevantSemanticSessionActivityAt(info: Info, sessionID: string) {
    let latest = sessionID === info.rootSessionID || sessionID === info.latestSessionID ? info.createdAt : 0
    for (const objective of info.objectives) {
      if (objective.sessionID !== sessionID) continue
      latest = Math.max(latest, objective.updatedAt, objective.createdAt)
    }
    for (const lane of info.lanes) {
      if (lane.sessionID !== sessionID) continue
      latest = Math.max(latest, lane.updatedAt, lane.createdAt)
    }
    for (const artifact of info.artifacts) {
      if (artifact.sessionID !== sessionID) continue
      latest = Math.max(latest, artifact.createdAt)
    }
    return latest
  }

  function collectRelevantSemanticSessionIDs(input: {
    info: Info
    preferredSessionIDs?: string[]
  }) {
    const ordered = [
      input.info.rootSessionID,
      input.info.latestSessionID,
      ...input.info.objectives
        .filter((item) => item.status === "active" || item.status === "blocked")
        .slice(-3)
        .map((item) => item.sessionID),
      ...input.info.lanes
        .filter((item) => ["queued", "running", "blocked"].includes(item.status))
        .slice(-4)
        .map((item) => item.sessionID),
      ...input.info.artifacts.slice(-3).map((item) => item.sessionID),
      ...(input.preferredSessionIDs ?? []),
    ]

    const seen = new Set<string>()
    const result: string[] = []
    for (const sessionID of ordered) {
      if (!sessionID || seen.has(sessionID)) continue
      const activityAt = relevantSemanticSessionActivityAt(input.info, sessionID)
      if (activityAt <= 0 && sessionID !== input.info.rootSessionID && sessionID !== input.info.latestSessionID) continue
      seen.add(sessionID)
      result.push(sessionID)
      if (result.length >= 6) break
    }
    return result
  }

  async function ensureSemanticSessionsIndexed(input: {
    projectID: string
    info: Info
    preferredSessionIDs?: string[]
  }) {
    const relevantSessionIDs = collectRelevantSemanticSessionIDs(input)
    let indexedCount = 0
    await Promise.all(
      relevantSessionIDs.map(async (sessionID) => {
        const activityAt = relevantSemanticSessionActivityAt(input.info, sessionID)
        const cacheKey = semanticIndexKey(input.projectID, sessionID)
        if ((readCache(semanticSessionIndexState, cacheKey) ?? 0) >= activityAt && activityAt > 0) return
        await RetrievalService.indexSession({
          projectID: input.projectID,
          sessionID,
        })
        writeCache(semanticSessionIndexState, cacheKey, Math.max(activityAt, Date.now()))
        indexedCount += 1
      }),
    )
    return {
      relevantSessionIDs,
      indexedCount,
    }
  }

  async function ensureSemanticArtifactsIndexed(input: {
    projectID: string
    info: Info
  }) {
    const fingerprint = semanticArtifactIndexFingerprint(input.info)
    if (readCache(semanticArtifactIndexState, input.info.rootSessionID) === fingerprint) return false
    await RetrievalService.indexTaskArtifacts({
      projectID: input.projectID,
      rootSessionID: input.info.rootSessionID,
      workgraph: input.info,
    })
    writeCache(semanticArtifactIndexState, input.info.rootSessionID, fingerprint)
    return true
  }

  function semanticText(value?: string) {
    return value
      ?.replace(/\s+/g, " ")
      .trim()
      .replace(/^(current objective|constraints|active lanes|recent artifacts):\s*/i, "")
      .trim()
      .toLowerCase()
  }

  function semanticArtifactText(value?: string) {
    if (!value) return undefined
    const text = value
      .replace(/\s+/g, " ")
      .replace(/\*\*/g, "")
      .replace(/`+/g, "")
      .trim()
    if (!text) return undefined
    const summary =
      text.match(/artifact summary:\s*([^|.;:\n]+(?:[: -][^|.;:\n]+)?)/i)?.[1]?.trim() ??
      text.match(/^([^|.;:\n]+(?:[: -][^|.;:\n]+)?)/)?.[1]?.trim()
    if (!summary) return undefined
    return summary.slice(0, 96)
  }

  function objectiveNeedsArtifactSupport(input: {
    title?: string
    constraints?: string
    querySeed?: string
  }) {
    const objectiveText = [input.title, input.constraints]
      .map((item) => item?.trim())
      .filter(Boolean)
      .join("\n")
      .trim()
    if (!objectiveText) return true
    if (semanticQueryIsLowSignal(objectiveText)) return true

    const objectiveTerms = semanticSignalTerms(objectiveText)
    if (objectiveTerms.length < 3) return true

    const querySeedTerms = semanticSignalTerms(input.querySeed ?? "")
    if (objectiveTerms.length >= 3) return false
    if (querySeedTerms.length > objectiveTerms.length) return true
    return false
  }

  function semanticQuery(input: {
    info: Info
    querySeed?: string
  }) {
    const activeObjectives = input.info.objectives.filter((item) => item.status === "active" || item.status === "blocked")
    const objectiveFocus = activeObjectives.at(-1) ?? input.info.objectives.at(-1)
    const title = objectiveFocus?.title?.trim()
    const constraints = objectiveFocus?.constraintsSummary?.trim()
    const parts = input.querySeed
      ?.split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => {
        const normalized = semanticText(item)
        if (!normalized) return false
        if (normalized === semanticText(title)) return false
        if (normalized === semanticText(constraints)) return false
        return true
      }) ?? []
    if (title) parts.push(`current objective: ${title}`)
    if (constraints) parts.push(`constraints: ${constraints}`)

      const includeArtifacts = objectiveNeedsArtifactSupport({
        title,
        constraints,
        querySeed: input.querySeed,
      })
      const notableArtifacts = includeArtifacts
        ? input.info.artifacts
            .filter((item) => item.outcome === "failure" || item.outcome === "partial" || /fail|error|blocked|constraint|artifact|patch/i.test(item.type))
            .slice(-1)
        : []
      if (notableArtifacts.length > 0) {
        const summaries = notableArtifacts
          .map((item) => {
            const summary = semanticArtifactText(item.summary)
            if (!summary) return undefined
            return `${item.type}: ${summary}`
          })
        .filter(Boolean)
      parts.push(
        `recent artifacts: ${summaries.join(" ; ")}`,
      )
    }

    const seen = new Set<string>()
    const uniqueParts = parts.filter((part) => {
      const normalized = part?.replace(/\s+/g, " ").trim().toLowerCase()
      if (!normalized || seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })

    return uniqueParts.join("\n\n").trim()
  }

  function semanticDigestFingerprint(input: {
    info: Info
    query: string
    preferredSessionIDs: string[]
    currentSourceID?: string
    limit?: number
  }) {
    const relevantSessionIDs = collectRelevantSemanticSessionIDs({
      info: input.info,
      preferredSessionIDs: input.preferredSessionIDs,
    })
    const relevantSessionActivity = relevantSessionIDs.map((sessionID) => ({
      sessionID,
      activityAt: relevantSemanticSessionActivityAt(input.info, sessionID),
    }))

    return createHash("sha1")
      .update(
        JSON.stringify({
          query: input.query,
          rootSessionID: input.info.rootSessionID,
          preferredSessionIDs: input.preferredSessionIDs,
          relevantSessionActivity,
          artifactFingerprint: semanticArtifactIndexFingerprint(input.info),
          currentSourceID: input.currentSourceID ?? null,
          limit: input.limit ?? 3,
        }),
      )
      .digest("hex")
  }

  function semanticSearchFingerprint(input: {
    info: Info
    query: string
    preferredSessionIDs: string[]
    limit?: number
  }) {
    const relevantSessionIDs = collectRelevantSemanticSessionIDs({
      info: input.info,
      preferredSessionIDs: input.preferredSessionIDs,
    })
    const relevantSessionActivity = relevantSessionIDs.map((sessionID) => ({
      sessionID,
      activityAt: relevantSemanticSessionActivityAt(input.info, sessionID),
    }))

    return createHash("sha1")
      .update(
        JSON.stringify({
          query: input.query,
          rootSessionID: input.info.rootSessionID,
          preferredSessionIDs: input.preferredSessionIDs,
          relevantSessionActivity,
          artifactFingerprint: semanticArtifactIndexFingerprint(input.info),
          limit: input.limit ?? 3,
        }),
      )
      .digest("hex")
  }

  function semanticSignalTerms(query: string) {
    const seen = new Set<string>()
    const terms: string[] = []
    for (const match of query.toLowerCase().matchAll(/[a-z0-9][a-z0-9._-]*/g)) {
      const term = match[0].replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
      if (!term) continue
      if (semanticStopwords.has(term)) continue
      const hasDigit = /\d/.test(term)
      if (!hasDigit && term.length < 4) continue
      if (seen.has(term)) continue
      seen.add(term)
      terms.push(term)
    }
    return terms
  }

  function semanticQueryIsLowSignal(query: string) {
    const signalTerms = semanticSignalTerms(query)
    if (signalTerms.length >= 2) return false
    if (signalTerms.some((term) => term.includes(".") || term.includes("_") || /\d/.test(term))) return false
    return true
  }

  function worldStateQuery(input: { info: Info; semanticPatterns?: SemanticPattern[] }) {
    const parts: string[] = []
    const focus = input.info.objectives
      .filter((item) => item.status === "active" || item.status === "blocked")
      .at(-1) ?? input.info.objectives.at(-1)
    if (focus?.title) parts.push(`objective: ${focus.title}`)
    if (focus?.constraintsSummary) parts.push(`constraints: ${focus.constraintsSummary}`)
    const patternFocus = input.semanticPatterns?.slice(0, 3).map((item) => item.text).filter(Boolean) ?? []
    if (patternFocus.length > 0) parts.push(`semantic patterns: ${patternFocus.join(" ; ")}`)
    const recentArtifacts = input.info.artifacts.slice(-3).map((item) => `${item.type}: ${item.summary}`).filter(Boolean)
    if (recentArtifacts.length > 0) parts.push(`artifacts: ${recentArtifacts.join(" ; ")}`)
    return parts.join("\n\n").trim()
  }

  async function materializeWorldState(input: {
    info: Info
    semanticPatterns?: SemanticPattern[]
  }): Promise<SessionWorldState.Materialized | undefined> {
    const reasoningLedger = await SessionWorldState.materialize({
      rootSessionID: input.info.rootSessionID,
    }).catch(() => undefined)
    const query = worldStateQuery({
      info: input.info,
      semanticPatterns: input.semanticPatterns,
    })
    if (!reasoningLedger && !query) return reasoningLedger
    const blocks = [
      ...(reasoningLedger?.blocks ?? []),
      ...(
        (input.semanticPatterns?.length ?? 0) > 0
          ? [
              {
                type: "text" as const,
                title: "Semantic world-state cues",
                text: input.semanticPatterns!
                  .map((item) => [item.scope, item.sourceType, item.title, item.text].filter(Boolean).join(" | "))
                  .join("\n"),
              },
            ]
          : []
      ),
      ...(query
        ? [
            {
              type: "text" as const,
              title: "World-state query",
              text: query,
            },
          ]
        : []),
    ]
    if (blocks.length === 0) return reasoningLedger
    return {
      ...reasoningLedger,
      rootSessionID: input.info.rootSessionID,
      blocks,
      text: blocks.map((item) => `## ${item.title}\n${item.text}`).join("\n\n"),
    }
  }

  function blockLineCount(blocks: Array<{ title: string; text: string }> | undefined, title: string) {
    const block = blocks?.find((item) => item.title === title)
    if (!block) return 0
    return block.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-")).length
  }

  function blockSummary(blocks: Array<{ title: string; text: string }> | undefined) {
    return blocks?.find((item) => item.title === "Latest summary")?.text?.trim()
  }

  function deriveAgentState(input: {
    worldState?: SessionWorldState.Materialized
    socialMemory?: SessionSocialMemory.Materialized
    reasoningLedger?: z.infer<typeof SessionReasoningLedger.Materialized>
    planningPolicy?: PlanningPolicy
    decompositionPolicy?: DecompositionPolicy
  }): AgentState | undefined {
    const layers: string[] = []
    const worldState = input.worldState
      ? {
          summary: blockSummary(input.worldState.blocks),
          riskCount: blockLineCount(input.worldState.blocks, "Open risks"),
          openLoopCount: blockLineCount(input.worldState.blocks, "Open loops"),
          closedLoopCount: blockLineCount(input.worldState.blocks, "Closed loops"),
        }
      : undefined
    if (worldState) layers.push("world_state")

    const reasoning = input.reasoningLedger
      ? {
          summary: blockSummary(input.reasoningLedger.blocks),
          commitmentCount: blockLineCount(input.reasoningLedger.blocks, "Active commitments"),
          assumptionCount: blockLineCount(input.reasoningLedger.blocks, "Risky assumptions"),
          falsifierCount: blockLineCount(input.reasoningLedger.blocks, "Armed falsifiers"),
          transitionCount: blockLineCount(input.reasoningLedger.blocks, "Recent transitions"),
        }
      : undefined
    if (reasoning) layers.push("reasoning_ledger")

    const social = input.socialMemory
      ? {
          summary: blockSummary(input.socialMemory.blocks),
          pairingCount: blockLineCount(input.socialMemory.blocks, "Successful pairings"),
          handoffCount: blockLineCount(input.socialMemory.blocks, "Handoff patterns"),
          stallCount: blockLineCount(input.socialMemory.blocks, "Stall patterns"),
        }
      : undefined
    if (social) layers.push("social_memory")

    const planning = input.planningPolicy
      ? {
          mode: input.planningPolicy.mode,
          patternCount: input.planningPolicy.patternCount,
        }
      : undefined
    if (planning) layers.push("planning_policy")

    const decomposition = input.decompositionPolicy
      ? {
          mode: input.decompositionPolicy.mode,
          suggestedLaneCount: input.decompositionPolicy.suggestedLaneCount,
          parallelStrategy: input.decompositionPolicy.parallelStrategy,
        }
      : undefined
    if (decomposition) layers.push("decomposition_policy")

    if (layers.length === 0) return undefined

    const summaryParts = [
      worldState
        ? `world: risks=${worldState.riskCount}, open_loops=${worldState.openLoopCount}, closed_loops=${worldState.closedLoopCount}`
        : undefined,
      reasoning
        ? `reasoning: commitments=${reasoning.commitmentCount}, assumptions=${reasoning.assumptionCount}, falsifiers=${reasoning.falsifierCount}, transitions=${reasoning.transitionCount}`
        : undefined,
      social
        ? `social: pairings=${social.pairingCount}, handoffs=${social.handoffCount}, stalls=${social.stallCount}`
        : undefined,
      planning ? `planning: mode=${planning.mode}, patterns=${planning.patternCount}` : undefined,
      decomposition
        ? `decomposition: mode=${decomposition.mode}, lanes=${decomposition.suggestedLaneCount}, strategy=${decomposition.parallelStrategy}`
        : undefined,
    ].filter((item): item is string => !!item)

    return {
      summary: summaryParts.join(" | "),
      layers,
      ...(worldState ? { worldState } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(social ? { social } : {}),
      ...(planning ? { planning } : {}),
      ...(decomposition ? { decomposition } : {}),
    }
  }

  async function materializeSemanticPatterns(input: {
    info: Info
    projectID?: string
    preferredSessionIDs?: string[]
    currentSourceID?: string
    querySeed?: string
    limit?: number
  }): Promise<{
    patterns: SemanticPattern[]
    planningPolicy?: PlanningPolicy
    decompositionPolicy?: DecompositionPolicy
    relevantSessionCount: number
    indexedSessionCount: number
    artifactIndexRefreshed: boolean
  }> {
    if (!input.projectID) return { patterns: [], relevantSessionCount: 0, indexedSessionCount: 0, artifactIndexRefreshed: false }

    const query = semanticQuery({
      info: input.info,
      querySeed: input.querySeed,
    })
    if (query.length < 12) return { patterns: [], relevantSessionCount: 0, indexedSessionCount: 0, artifactIndexRefreshed: false }
    if (semanticQueryIsLowSignal(query)) {
      return { patterns: [], relevantSessionCount: 0, indexedSessionCount: 0, artifactIndexRefreshed: false }
    }
    const key = `${input.projectID}:${input.info.rootSessionID}`
    const preferredSessionIDs = input.preferredSessionIDs?.length ? input.preferredSessionIDs : [input.info.rootSessionID]
    const fingerprint = semanticDigestFingerprint({
      info: input.info,
      query,
      preferredSessionIDs,
      currentSourceID: input.currentSourceID,
      limit: input.limit,
    })
    const cached = readCache(semanticDigestState, key)
    if (cached?.fingerprint === fingerprint) return cached.result
    const searchFingerprint = semanticSearchFingerprint({
      info: input.info,
      query,
      preferredSessionIDs,
      limit: input.limit,
    })

    const sourceTypes: RetrievalSourceType[] = [
      "assistant_output",
      "tool_failure",
      "task_artifact",
      "doc",
      "note",
      "skill",
      "provenance",
      "code_chunk",
      "session_message",
    ]
    try {
      let search = readCache(semanticSearchState, key)
      if (!search || search.fingerprint !== searchFingerprint) {
        const inflight = semanticSearchInflight.get(key)
        const result =
          inflight && inflight.fingerprint === searchFingerprint
            ? await inflight.promise
            : await (() => {
                const promise = (async () => {
                  const semanticIndexing = await ensureSemanticSessionsIndexed({
                    projectID: input.projectID!,
                    info: input.info,
                    preferredSessionIDs,
                  })
                  const artifactIndexRefreshed = await ensureSemanticArtifactsIndexed({
                    projectID: input.projectID!,
                    info: input.info,
                  })

                  const result = await RetrievalService.search({
                    projectID: input.projectID!,
                    query,
                    policy: "auto",
                    limit: Math.max(input.limit ?? 3, 1) + 1,
                    sourceTypes,
                    metadata: {
                      trigger: "workgraph_digest",
                      rootSessionID: input.info.rootSessionID,
                      policyMode: "semantic",
                      skipRerank: true,
                    },
                  })

                  return {
                    candidates: result.candidates,
                    runID: result.runID,
                    relevantSessionCount: semanticIndexing.relevantSessionIDs.length,
                    indexedSessionCount: semanticIndexing.indexedCount,
                    artifactIndexRefreshed,
                  }
                })()
                semanticSearchInflight.set(key, {
                  fingerprint: searchFingerprint,
                  promise,
                })
                return promise.finally(() => {
                  const current = semanticSearchInflight.get(key)
                  if (current?.fingerprint === searchFingerprint) semanticSearchInflight.delete(key)
                })
              })()

        search = {
          fingerprint: searchFingerprint,
          result,
        }
        writeCache(semanticSearchState, key, search)
      }

      const candidates = RetrievalBaton.usefulCandidates({
        query,
        candidates: search.result.candidates,
        limit: input.limit ?? 3,
        currentSourceID: input.currentSourceID,
        preferredSessionIDs,
      })
      const selected =
        candidates.length > 0
          ? candidates
          : search.result.candidates
              .filter((candidate) => candidate.content.trim() && candidate.sourceID !== input.currentSourceID)
              .slice(0, input.limit ?? 3)
      const compacted = RetrievalBaton.compact(selected, input.limit ?? 3, preferredSessionIDs)
      const semanticPatternScope = (item: (typeof compacted)[number]) =>
        item.scope ?? (item.sessionID && preferredSessionIDs.includes(item.sessionID) ? "session family" : "project memory")
      const patterns = compacted.map((item) => ({
        sourceType: item.sourceType,
        title: item.title,
        signal: item.score ?? item.rerankScore ?? 0,
        scope: semanticPatternScope(item),
        text: (item.text ?? item.content ?? "").replace(/\s+/g, " ").trim(),
      }))
      const scopeCounts = compacted.reduce(
        (acc, item) => {
          const key = semanticPatternScope(item)
          acc.set(key, (acc.get(key) ?? 0) + 1)
          return acc
        },
        new Map<string, number>(),
      )
      const scopeMix = [...scopeCounts.entries()]
        .map(([scope, count]) => `${scope}:${count}`)
        .join(", ")
      const decompositionPolicy = patterns.length > 0 ? deriveDecompositionPolicy({
        info: input.info,
        query,
        runID: search.result.runID,
        scopeMix: scopeMix || "unknown",
        patterns,
      }) : undefined
      const next: {
        patterns: SemanticPattern[]
        planningPolicy?: PlanningPolicy
        decompositionPolicy?: DecompositionPolicy
        relevantSessionCount: number
        indexedSessionCount: number
        artifactIndexRefreshed: boolean
      } = {
        patterns,
        relevantSessionCount: search.result.relevantSessionCount,
        indexedSessionCount: search.result.indexedSessionCount,
        artifactIndexRefreshed: search.result.artifactIndexRefreshed,
        planningPolicy:
          patterns.length > 0
            ? {
                mode: "semantic" as const,
                query,
                runID: search.result.runID,
                scopeMix: scopeMix || "unknown",
                patternCount: patterns.length,
                topPatternSummaries: patterns
                  .map((item) => [item.scope, item.sourceType, item.title, item.text].filter(Boolean).join(" | "))
                  .slice(0, 3),
              }
            : undefined,
        decompositionPolicy,
      }
      writeCache(semanticDigestState, key, {
        fingerprint,
        result: next,
      })
      return next
    } catch {
      return { patterns: [], relevantSessionCount: 0, indexedSessionCount: 0, artifactIndexRefreshed: false }
    }
  }

  function uniqueStrings(items: Array<string | undefined>, limit: number) {
    const seen = new Set<string>()
    const result: string[] = []
    for (const item of items) {
      const normalized = item?.trim()
      if (!normalized) continue
      const key = normalized.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push(normalized)
      if (result.length >= limit) break
    }
    return result
  }

  function deriveDecompositionPolicy(input: {
    info: Info
    query: string
    runID?: string
    scopeMix: string
    patterns: SemanticPattern[]
  }): DecompositionPolicy {
    const texts = input.patterns.map((item) => `${item.title ?? ""} ${item.text}`.trim())
    const combined = [input.query, ...texts].join("\n").toLowerCase()
    const activeObjectives = input.info.objectives.filter((item) => item.status === "active" || item.status === "blocked")
    const activeLanes = input.info.lanes.filter((item) => ["queued", "running", "blocked"].includes(item.status))

    let suggestedLaneCount = Math.max(1, Math.min(6, activeLanes.length || 1))
    if (/parallel|fan[- ]?out|split|multiple lanes|worker.+explorer|explorer.+worker/.test(combined)) {
      suggestedLaneCount = Math.max(suggestedLaneCount, 2)
    }
    if (activeObjectives.length > 1) suggestedLaneCount = Math.max(suggestedLaneCount, Math.min(4, activeObjectives.length))

    let parallelStrategy: DecompositionPolicy["parallelStrategy"] = "serial"
    if (/parallel|fan[- ]?out|concurrently|in parallel/.test(combined)) parallelStrategy = "parallel"
    else if (/inspect|scan|ingress|research|explore/.test(combined) && /patch|implement|fix|recovery|orchestration/.test(combined)) {
      parallelStrategy = "hybrid"
    } else if (suggestedLaneCount > 1) {
      parallelStrategy = "hybrid"
    }
    if (parallelStrategy === "hybrid") suggestedLaneCount = Math.max(suggestedLaneCount, 2)

    const checkpointHints = uniqueStrings(
      [
        /inspect|scan|inventory|ingress|research|explore|archaeology/.test(combined)
          ? "Checkpoint after reconnaissance before mutation."
          : undefined,
        /recover|recovery|resume|continuity|watchdog|retry/.test(combined)
          ? "Checkpoint after risky lane transitions so recovery can resume cleanly."
          : undefined,
        /verify|validation|review|test|stabilize/.test(combined)
          ? "Checkpoint on verification before closing the objective."
          : undefined,
        parallelStrategy !== "serial" ? "Checkpoint when parallel lanes converge." : undefined,
      ],
      3,
    )

    const expectedArtifacts = uniqueStrings(
      [
        /plan|decomposition|brief|outline/.test(combined) ? "plan brief" : undefined,
        /patch|implement|fix|edit|mutation/.test(combined) ? "patch" : undefined,
        /review|verify|validation|test/.test(combined) ? "verification notes" : undefined,
        /inspect|scan|investigate|research|explore|ingress/.test(combined) ? "investigation notes" : undefined,
        ...input.info.artifacts
          .slice(-4)
          .map((artifact) => artifact.type.replace(/[_-]+/g, " ").trim())
          .filter(Boolean),
      ],
      4,
    )

    return {
      mode: "semantic",
      query: input.query,
      runID: input.runID,
      scopeMix: input.scopeMix,
      patternCount: input.patterns.length,
      suggestedLaneCount,
      parallelStrategy,
      checkpointHints,
      expectedArtifacts,
      topTopologySummaries: input.patterns
        .map((item) => [item.scope, item.sourceType, item.title, item.text].filter(Boolean).join(" | "))
        .slice(0, 3),
    }
  }

  export async function get(rootSessionID: string) {
    return Storage.read<Info>(key(rootSessionID)).catch((error) => {
      if (Storage.NotFoundError.isInstance(error)) return undefined
      throw error
    })
  }

  export async function recordObjective(input: {
    rootSessionID: string
    sessionID: string
    title: string
    messageID?: string
    constraintsSummary?: string
    status?: ObjectiveStatus
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ rootSessionID: input.rootSessionID, sessionID: input.sessionID, at })
    const existingIndex = current.objectives.findIndex((item) => item.messageID && item.messageID === input.messageID)
    const existing = existingIndex >= 0 ? current.objectives[existingIndex] : undefined
    const nextStatus = input.status ?? existing?.status ?? "active"
    const nextEntry: Objective = {
      id: existing?.id ?? Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: input.messageID,
      title: input.title,
      constraintsSummary: input.constraintsSummary,
      status: nextStatus,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    }
    const objectives =
      existingIndex >= 0
        ? current.objectives.map((item, index) => (index === existingIndex ? nextEntry : item))
        : trimLog(
            [
              ...current.objectives.map((item) => {
                if (
                  nextStatus === "active" &&
                  item.sessionID === input.sessionID &&
                  item.messageID !== input.messageID &&
                  (item.status === "active" || item.status === "blocked")
                ) {
                  return {
                    ...item,
                    status: "canceled" as const,
                    updatedAt: at,
                  }
                }
                return item
              }),
              nextEntry,
            ],
            maxObjectives,
          )
    return write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      objectives,
    })
  }

  export async function settleObjectives(input: {
    rootSessionID: string
    sessionID: string
    status: Extract<ObjectiveStatus, "blocked" | "completed" | "canceled">
    messageID?: string
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ rootSessionID: input.rootSessionID, sessionID: input.sessionID, at })
    let changed = false
    const objectives = current.objectives.map((item) => {
      if (item.sessionID !== input.sessionID) return item
      if (input.messageID && item.messageID !== input.messageID) return item
      if (!input.messageID && !["active", "blocked"].includes(item.status)) return item
      if (item.status === input.status) return item
      changed = true
      return {
        ...item,
        status: input.status,
        updatedAt: at,
      }
    })
    if (!changed) return current
    return write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      objectives,
    })
  }



export async function recordArtifact(input: {
    rootSessionID: string
    sessionID: string
    type: string
    summary: string
    outcome?: "success" | "failure" | "partial"
    taskID?: string
    messageID?: string
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ rootSessionID: input.rootSessionID, sessionID: input.sessionID, at })
    const duplicate = current.artifacts.find(
      (item) =>
        item.sessionID === input.sessionID &&
        item.taskID === input.taskID &&
        item.messageID === input.messageID &&
        item.type === input.type &&
        item.summary === input.summary,
    )
const artifacts = duplicate
      ? current.artifacts
      : trimLog(
          [
            ...current.artifacts,
            {
              id: Identifier.ascending("part"),
              sessionID: input.sessionID,
              taskID: input.taskID,
              messageID: input.messageID,
              type: input.type,
              summary: input.summary,
              outcome: input.outcome,
              createdAt: at,
            } satisfies Artifact,
          ],
          maxArtifacts,
        )
    return write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      artifacts,
    })
  }

  export function digest(input: {
    info: Info
    maxObjectives?: number
    maxLanes?: number
    maxArtifacts?: number
    semanticPatterns?: SemanticPattern[]
    worldState?: SessionWorldState.Materialized
    socialMemory?: SessionSocialMemory.Materialized
    reasoningLedger?: z.infer<typeof SessionReasoningLedger.Materialized>
    planningPolicy?: PlanningPolicy
    decompositionPolicy?: DecompositionPolicy
  }): Materialized | undefined {
    const info = input.info
    const objectiveLimit = input.maxObjectives ?? 3
    const laneLimit = input.maxLanes ?? 4
    const artifactLimit = input.maxArtifacts ?? 3
    const blocks: Block[] = []

    const activeObjectives = info.objectives.filter((item) => item.status === "active" || item.status === "blocked")
    const focus = block("Objective focus", [
      activeObjectives.at(-1)?.title ?? info.objectives.at(-1)?.title ?? (info.objectives.length > 0 ? undefined : emptyObjective),
    ])
    if (focus) blocks.push(focus)

    const objectiveBlock = block(
      "Objectives",
      activeObjectives.slice(Math.max(0, activeObjectives.length - objectiveLimit)).map((item) => {
        const constraints = item.constraintsSummary ? ` | constraints: ${item.constraintsSummary}` : ""
        return `- [${item.status}] ${item.title}${constraints}`
      }),
    )
    if (objectiveBlock) blocks.push(objectiveBlock)

    const activeLanes = info.lanes
      .filter((item) => ["queued", "running", "blocked"].includes(item.status))
      .slice(Math.max(0, info.lanes.filter((item) => ["queued", "running", "blocked"].includes(item.status)).length - laneLimit))
    const laneBlock = block(
      "Active lanes",
      activeLanes.map((item) => {
        const bits = [`- [${item.status}] ${item.title}`]
        if (item.schedulerLane) bits.push(`lane=${item.schedulerLane}`)
        if (item.subagentType) bits.push(`agent=${item.subagentType}`)
        return bits.join(" | ")
      }),
    )
    if (laneBlock) blocks.push(laneBlock)

    const recentArtifacts = info.artifacts.slice(Math.max(0, info.artifacts.length - artifactLimit))
    const artifactBlock = block(
      "Recent artifacts",
      recentArtifacts.map((item) => `- [${item.type}] ${item.summary}`),
    )
    if (artifactBlock) blocks.push(artifactBlock)

    const agentState = deriveAgentState({
      worldState: input.worldState,
      socialMemory: input.socialMemory,
      reasoningLedger: input.reasoningLedger,
      planningPolicy: input.planningPolicy,
      decompositionPolicy: input.decompositionPolicy,
    })
    const agentStateBlock = agentState
      ? block("Agent state", [
          `- layers=${agentState.layers.join(", ")}`,
          `- ${agentState.summary}`,
        ])
      : undefined
    if (agentStateBlock) blocks.push(agentStateBlock)

    const reasoningLedger = input.reasoningLedger
    if (reasoningLedger) {
      blocks.push(...reasoningLedger.blocks)
    }

    const semanticPatterns = input.semanticPatterns?.filter((item) => item.text.trim()) ?? []
    const semanticBlock = block(
      "Reusable patterns",
      semanticPatterns.map((item) => {
        const bits = [`- [${item.sourceType}]${item.title ? ` ${item.title}` : ""}`]
        bits.push(`signal=${item.signal.toFixed(3)}`)
        if (item.scope) bits.push(`scope=${item.scope}`)
        bits.push(item.text)
        return bits.join(" | ")
      }),
    )
    if (semanticBlock) blocks.push(semanticBlock)

    if (input.worldState) {
      blocks.push(...input.worldState.blocks)
    }

    if (input.socialMemory) {
      blocks.push(...input.socialMemory.blocks)
    }

    const decomposition = input.decompositionPolicy
    const decompositionBlock = decomposition
      ? block("Decomposition policy", [
          `- mode=${decomposition.mode} | lanes=${decomposition.suggestedLaneCount} | strategy=${decomposition.parallelStrategy} | scope=${decomposition.scopeMix}`,
          ...decomposition.checkpointHints.map((item) => `- checkpoint: ${item}`),
          ...decomposition.expectedArtifacts.map((item) => `- artifact: ${item}`),
          ...decomposition.topTopologySummaries.map((item) => `- topology: ${item}`),
        ])
      : undefined
    if (decompositionBlock) blocks.push(decompositionBlock)

    if (blocks.length === 0) return undefined
    return {
      rootSessionID: info.rootSessionID,
      blocks,
      semanticPatterns: semanticPatterns.length > 0 ? semanticPatterns : undefined,
      worldState: input.worldState,
      socialMemory: input.socialMemory,
      reasoningLedger,
      planningPolicy: input.planningPolicy,
      decompositionPolicy: input.decompositionPolicy,
      agentState,
      text: blocks.map((item) => `## ${item.title}\n${item.text}`).join("\n\n"),
    }
  }

  export async function materialize(input: {
    rootSessionID: string
    info?: Info
    diagnostics?: MaterializeDiagnostics
    maxObjectives?: number
    maxLanes?: number
    maxArtifacts?: number
    projectID?: string
    preferredSessionIDs?: string[]
    currentSourceID?: string
    semanticQuery?: string
    semanticLimit?: number
  }) {
    const info = input.info ?? (await get(input.rootSessionID))
    if (!info) return undefined
    const reasoningLedgerStartedAt = Date.now()
    const reasoningLedger = await SessionReasoningLedger.materialize({
      rootSessionID: input.rootSessionID,
    })
    if (input.diagnostics) input.diagnostics.reasoningLedgerDurationMS = Date.now() - reasoningLedgerStartedAt
    const semanticStartedAt = Date.now()
    const semantic = await materializeSemanticPatterns({
      info,
      projectID: input.projectID,
      preferredSessionIDs: input.preferredSessionIDs,
      currentSourceID: input.currentSourceID,
      querySeed: input.semanticQuery,
      limit: input.semanticLimit,
    })
    if (input.diagnostics) {
      input.diagnostics.semanticDurationMS = Date.now() - semanticStartedAt
      input.diagnostics.relevantSemanticSessionCount = semantic.relevantSessionCount
      input.diagnostics.indexedSemanticSessionCount = semantic.indexedSessionCount
      input.diagnostics.semanticArtifactIndexRefreshed = semantic.artifactIndexRefreshed
      input.diagnostics.semanticPatternCount = semantic.patterns.length
    }
    const worldStateStartedAt = Date.now()
    const worldState = await materializeWorldState({
      info,
      semanticPatterns: semantic.patterns,
    })
    if (input.diagnostics) input.diagnostics.worldStateDurationMS = Date.now() - worldStateStartedAt
    const socialMemoryStartedAt = Date.now()
    const socialMemory = await SessionSocialMemory.materialize({
      rootSessionID: input.rootSessionID,
    })
    if (input.diagnostics) input.diagnostics.socialMemoryDurationMS = Date.now() - socialMemoryStartedAt
    const digestStartedAt = Date.now()
    const materialized = digest({
      info,
      maxObjectives: input.maxObjectives,
      maxLanes: input.maxLanes,
      maxArtifacts: input.maxArtifacts,
      semanticPatterns: semantic.patterns,
      worldState,
      socialMemory,
      reasoningLedger,
      planningPolicy: semantic.planningPolicy,
      decompositionPolicy: semantic.decompositionPolicy,
    })
    if (input.diagnostics) input.diagnostics.digestDurationMS = Date.now() - digestStartedAt
    return materialized
  }
}
