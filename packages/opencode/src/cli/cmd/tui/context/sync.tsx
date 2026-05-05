import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@opencode-ai/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs, type Args } from "./args"
import { batch, onCleanup, onMount } from "solid-js"
import { Log } from "@/util/log"
import type { Path } from "@opencode-ai/sdk"
import type { Workspace } from "@opencode-ai/sdk/v2"
import { ConsoleState, emptyConsoleState, type ConsoleState as ConsoleStateType } from "@/config/console-state"
import type { TrackerTask } from "@/tracker/types"

type RootSurfaceName =
  | "controlSnapshot"
  | "mission"
  | "operator"
  | "plannerPreview"
  | "timeline"
  | "planState"
  | "tracker"
  | "workgraph"

const ROOT_SURFACE_NAMES: RootSurfaceName[] = [
  "controlSnapshot",
  "mission",
  "operator",
  "plannerPreview",
  "timeline",
  "planState",
  "tracker",
  "workgraph",
]

type RootSurfaceDiagnostics = {
  count: number
  errorCount: number
  lastDurationMS: number
  maxDurationMS: number
  averageDurationMS: number
}

type RootSurfaceRefreshDiagnostics = {
  refreshCount: number
  slowRefreshCount: number
  lastDurationMS: number
  maxDurationMS: number
  averageDurationMS: number
  lastCompletedAt?: number
  lastSessionID?: string
  lastRootSessionID?: string
  lastSlowestSurface?: RootSurfaceName
  lastSlowestDurationMS?: number
  surfaces: Record<RootSurfaceName, RootSurfaceDiagnostics>
}

const ROOT_SURFACE_SLOW_REFRESH_MS = 250
const ROOT_SURFACE_EVENT_REFRESH_DEBOUNCE_MS = 120

type SessionRootState = "idle" | "accepting" | "responding" | "steering" | "blocked"

type SessionPlanStateSurface = {
  rootSessionID: string
  sessionID: string
  mode: "planning" | "awaiting_approval" | "approved"
  pendingPlanPath?: string
  approvedPlanPath?: string
  feedback?: string
  updatedAt: number
}

type SessionPlannerPreviewSurface = {
  rootSessionID: string
  sessionID: string
  mode: "plan" | "build"
  planPath: string
  exists: boolean
  hint: string
  updatedAt: number
}

type SessionWorkGraphSurface = {
  rootSessionID: string
  sessionID: string
  objectiveCount: number
  activeObjectiveCount: number
  laneCount: number
  activeLaneCount: number
  artifactCount: number
  latestObjective?: string
  objectives?: unknown[]
  lanes?: unknown[]
  artifacts?: unknown[]
  digest?: unknown
  updatedAt: number
}

type SessionMissionSurface = {
  rootSessionID: string
  sessionID: string
  state: SessionRootState
  latestUserIntent: string
  todoCount: number
  childCount: number
  activeChildCount: number
  pendingSteer: number
  updatedAt: number
}

type SessionOperatorSurface = {
  rootSessionID: string
  sessionID: string
  state: SessionRootState
  latestUserIntent: string
  pendingPermissionCount: number
  pendingQuestionCount: number
  pendingInboxCount: number
  activeChildCount: number
  scheduler?: {
    mode: string
    queuedTotal: number
    runningTotal: number
  }
  capabilityCount: number
  updatedAt: number
}

type SessionTimelineSurface = {
  rootSessionID: string
  sessionID: string
  count: number
  events: unknown[]
}

type SessionTrackerSummarySurface = {
  rootSessionID: string
  sessionID: string
  taskCount: number
  openCount: number
  inProgressCount: number
  blockedCount: number
  closedCount: number
  recentCount: number
  latestTasks?: TrackerTask[]
  tasks?: TrackerTask[]
  trackerPath: string
  updatedAt: number
}

type RootSurfaceStoreKey =
  | "mission"
  | "operator"
  | "planner_preview"
  | "timeline"
  | "plan_state"
  | "tracker_summary"
  | "workgraph"

type RootSurfaceDataByStoreKey = {
  mission: SessionMissionSurface
  operator: SessionOperatorSurface
  planner_preview: SessionPlannerPreviewSurface
  timeline: SessionTimelineSurface
  plan_state: SessionPlanStateSurface
  tracker_summary: SessionTrackerSummarySurface
  workgraph: SessionWorkGraphSurface
}

type RootSurfaceFetchSpec<K extends RootSurfaceStoreKey = RootSurfaceStoreKey> = {
  name: RootSurfaceName
  storeKey: K
  path: string
  query?: Record<string, unknown>
}

type RootSurfaceFetchPlanItem = RootSurfaceFetchSpec & {
  url: string
}

type RootSurfaceFetchResult<K extends RootSurfaceStoreKey = RootSurfaceStoreKey> = {
  name: RootSurfaceName
  storeKey: K
  durationMS: number
  ok: boolean
  data?: RootSurfaceDataByStoreKey[K]
}

type RootSurfaceRawClient = {
  get<TData = unknown>(options: {
    url: string
    query?: Record<string, unknown>
    throwOnError?: boolean
  }): Promise<{ data?: TData }>
}

type RootSurfaceRefreshEvent = {
  type: string
  properties?: Record<string, unknown>
}

type RootSurfaceTimer = ReturnType<typeof setTimeout>

const ROOT_SURFACE_FETCH_SPECS: RootSurfaceFetchSpec[] = [
  { name: "mission", storeKey: "mission", path: "mission" },
  { name: "operator", storeKey: "operator", path: "operator" },
  { name: "plannerPreview", storeKey: "planner_preview", path: "planner-preview" },
  { name: "timeline", storeKey: "timeline", path: "timeline", query: { limit: 20 } },
  { name: "planState", storeKey: "plan_state", path: "plan-state" },
  { name: "tracker", storeKey: "tracker_summary", path: "tracker" },
  { name: "workgraph", storeKey: "workgraph", path: "workgraph" },
]

export function createRootSurfaceFetchPlan(sessionID: string): RootSurfaceFetchPlanItem[] {
  const encodedSessionID = encodeURIComponent(sessionID)
  return ROOT_SURFACE_FETCH_SPECS.map((spec) => ({
    ...spec,
    url: `/session/${encodedSessionID}/${spec.path}`,
  }))
}

export async function fetchRootSurfacePayloads(client: RootSurfaceRawClient | undefined, sessionID: string) {
  if (!client) return [] satisfies RootSurfaceFetchResult[]
  return Promise.all(
    createRootSurfaceFetchPlan(sessionID).map(async (spec): Promise<RootSurfaceFetchResult> => {
      const startedAt = Date.now()
      try {
        const response = await client.get({ url: spec.url, query: spec.query })
        return {
          name: spec.name,
          storeKey: spec.storeKey,
          durationMS: Date.now() - startedAt,
          ok: response.data !== undefined,
          data: response.data as RootSurfaceFetchResult["data"],
        }
      } catch {
        return {
          name: spec.name,
          storeKey: spec.storeKey,
          durationMS: Date.now() - startedAt,
          ok: false,
        }
      }
    }),
  )
}

export function applyRootSurfaceFetchResults(
  store: Record<string, unknown>,
  results: RootSurfaceFetchResult[],
) {
  for (const result of results) {
    if (!result.ok || !result.data?.rootSessionID) continue
    const surfaces = (store[result.storeKey] as Record<string, unknown> | undefined) ?? {}
    ;(surfaces)[result.data.rootSessionID] = result.data
    store[result.storeKey] = surfaces
  }
}

export function getRootSurfaceRefreshSessionID(
  event: RootSurfaceRefreshEvent,
  lookupMessageSessionID?: (messageID: string) => string | undefined,
) {
  const p = event.properties
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
  const obj = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined)

  switch (event.type) {
    case "permission.asked":
    case "question.asked":
    case "todo.updated":
    case "session.diff":
    case "session.status":
    case "message.removed":
      return str(p?.sessionID)
    case "permission.replied":
    case "question.replied":
    case "question.rejected":
      return str(p?.sessionID)
    case "session.created":
    case "session.updated": {
      const info = obj(p?.info)
      return str(info?.id)
    }
    case "message.updated": {
      const info = obj(p?.info)
      return str(info?.sessionID)
    }
    case "message.part.updated": {
      const part = obj(p?.part)
      const messageID = str(part?.messageID)
      return str(part?.sessionID) ?? (messageID ? lookupMessageSessionID?.(messageID) : undefined)
    }
    case "message.part.delta":
    case "message.part.removed":
      {
        const messageID = str(p?.messageID)
        return messageID ? lookupMessageSessionID?.(messageID) : undefined
      }
    default:
      return undefined
  }
}

export function createRootSurfaceRefreshScheduler(input: {
  refresh: (sessionID: string) => void | Promise<void>
  delayMS?: number
  setTimeoutFn?: (fn: () => void, delayMS: number) => RootSurfaceTimer
  clearTimeoutFn?: (timer: RootSurfaceTimer) => void
}) {
  const delayMS = input.delayMS ?? ROOT_SURFACE_EVENT_REFRESH_DEBOUNCE_MS
  const setTimer = input.setTimeoutFn ?? setTimeout
  const clearTimer = input.clearTimeoutFn ?? clearTimeout
  const timers = new Map<string, RootSurfaceTimer>()

  return {
    schedule(sessionID?: string) {
      if (!sessionID) return
      const existing = timers.get(sessionID)
      if (existing) clearTimer(existing)
      const timer = setTimer(() => {
        timers.delete(sessionID)
        void input.refresh(sessionID)
      }, delayMS)
      timers.set(sessionID, timer)
    },
    cancelAll() {
      for (const timer of timers.values()) clearTimer(timer)
      timers.clear()
    },
    pending() {
      return [...timers.keys()].sort()
    },
  }
}

function getRootSurfaceRawClient(client: unknown): RootSurfaceRawClient | undefined {
  const raw = (client as { client?: RootSurfaceRawClient } | undefined)?.client
  return typeof raw?.get === "function" ? raw : undefined
}

function emptyRootSurfaceDiagnostics(): RootSurfaceDiagnostics {
  return {
    count: 0,
    errorCount: 0,
    lastDurationMS: 0,
    maxDurationMS: 0,
    averageDurationMS: 0,
  }
}

function updateAverage(current: { count: number; averageDurationMS: number }, durationMS: number) {
  return Math.round((current.averageDurationMS * current.count + durationMS) / (current.count + 1))
}

export function getRootSessionID(sessions: Pick<Session, "id" | "parentID">[], sessionID: string) {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  let current = byID.get(sessionID)
  if (!current) return sessionID
  let highestLoadedID = current.id
  const visited = new Set<string>()
  while (current.parentID && !visited.has(current.parentID)) {
    visited.add(current.parentID)
    const parent = byID.get(current.parentID)
    if (!parent) return highestLoadedID
    highestLoadedID = parent.id
    current = parent
  }
  return highestLoadedID
}

export function listSessionDescendants(sessions: Pick<Session, "id" | "parentID">[], sessionID: string) {
  const children = new Map<string, string[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const list = children.get(session.parentID) ?? []
    list.push(session.id)
    children.set(session.parentID, list)
  }

  const result = new Set<string>([sessionID])
  const queue = [sessionID]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const child of children.get(current) ?? []) {
      if (result.has(child)) continue
      result.add(child)
      queue.push(child)
    }
  }
  return [...result].sort()
}

export function listRootScopedSessionIDs(sessions: Pick<Session, "id" | "parentID">[], sessionID: string) {
  return listSessionDescendants(sessions, getRootSessionID(sessions, sessionID))
}

export function collectRootScopedRequests<T>(
  sessions: Pick<Session, "id" | "parentID">[],
  requests: Record<string, T[] | undefined>,
  sessionID: string,
) {
  return listRootScopedSessionIDs(sessions, sessionID).flatMap((id) => requests[id] ?? [])
}

export function clearSessionCaches(
  store: Record<string, unknown>,
  sessionID: string,
  options?: {
    fullSyncedSessions?: Set<string>
    rootSessionID?: string
  },
) {
  const rootSessionID = options?.rootSessionID
  const sessionKeys = [sessionID]
  const rootKeys = rootSessionID ? [rootSessionID] : []
  const messageStore = store.message as Record<string, { id?: string }[] | undefined> | undefined
  const messageIDs = (messageStore?.[sessionID] ?? []).map((message) => message.id).filter(Boolean)

  for (const key of ["permission", "question", "supervisor_inbox", "steer", "session_status", "session_diff", "todo", "message"]) {
    for (const id of sessionKeys) {
      const subStore = store[key] as Record<string, unknown> | undefined
      if (subStore) delete subStore[id]
    }
  }
  for (const key of ["foreground", "mission", "operator", "planner_preview", "timeline", "plan_state", "tracker_summary", "workgraph"]) {
    for (const id of rootKeys) {
      const subStore = store[key] as Record<string, unknown> | undefined
      if (subStore) delete subStore[id]
    }
  }
  const partStore = store.part as Record<string, unknown> | undefined
  for (const messageID of messageIDs) {
    if (partStore) delete partStore[messageID as string]
  }
  options?.fullSyncedSessions?.delete(sessionID)
  if (rootSessionID) options?.fullSyncedSessions?.delete(rootSessionID)
}

export function upsertSupervisorInboxItem<T extends { taskID: string }>(items: T[] | undefined, item: T, limit = 100) {
  const next = [...(items ?? [])]
  const index = next.findIndex((entry) => entry.taskID === item.taskID)
  if (index >= 0) next[index] = item
  else {
    const insertAt = next.findIndex((entry) => ((entry as { time?: number }).time ?? 0) > ((item as { time?: number }).time ?? 0))
    if (insertAt >= 0) next.splice(insertAt, 0, item)
    else next.push(item)
  }
  return next.slice(Math.max(0, next.length - Math.max(1, limit)))
}

export function createRootSurfaceRefreshDiagnostics(): RootSurfaceRefreshDiagnostics {
  return {
    refreshCount: 0,
    slowRefreshCount: 0,
    lastDurationMS: 0,
    maxDurationMS: 0,
    averageDurationMS: 0,
    surfaces: Object.fromEntries(ROOT_SURFACE_NAMES.map((name) => [name, emptyRootSurfaceDiagnostics()])) as Record<
      RootSurfaceName,
      RootSurfaceDiagnostics
    >,
  }
}

export function recordRootSurfaceRefreshDiagnostics(
  diagnostics: RootSurfaceRefreshDiagnostics,
  input: {
    durationMS: number
    completedAt: number
    sessionID: string
    rootSessionID: string
    surfaces: Array<{ name: RootSurfaceName; durationMS: number; ok: boolean }>
  },
) {
  diagnostics.averageDurationMS = Math.round(
    (diagnostics.averageDurationMS * diagnostics.refreshCount + input.durationMS) / (diagnostics.refreshCount + 1),
  )
  diagnostics.refreshCount += 1
  diagnostics.lastDurationMS = input.durationMS
  diagnostics.maxDurationMS = Math.max(diagnostics.maxDurationMS, input.durationMS)
  diagnostics.lastCompletedAt = input.completedAt
  diagnostics.lastSessionID = input.sessionID
  diagnostics.lastRootSessionID = input.rootSessionID
  if (input.durationMS > ROOT_SURFACE_SLOW_REFRESH_MS) diagnostics.slowRefreshCount += 1

  const slowest = [...input.surfaces].sort((a, b) => b.durationMS - a.durationMS)[0]
  if (slowest) {
    diagnostics.lastSlowestSurface = slowest.name
    diagnostics.lastSlowestDurationMS = slowest.durationMS
  }

  for (const surface of input.surfaces) {
    const current = diagnostics.surfaces[surface.name] ?? emptyRootSurfaceDiagnostics()
    current.averageDurationMS = updateAverage(current, surface.durationMS)
    current.count += 1
    current.errorCount += surface.ok ? 0 : 1
    current.lastDurationMS = surface.durationMS
    current.maxDurationMS = Math.max(current.maxDurationMS, surface.durationMS)
    diagnostics.surfaces[surface.name] = current
  }
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: (_props: { args?: Args }) => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleStateType
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      plan_state: {
        [rootSessionID: string]: SessionPlanStateSurface
      }
      planner_preview: {
        [rootSessionID: string]: SessionPlannerPreviewSurface
      }
      workgraph: {
        [rootSessionID: string]: SessionWorkGraphSurface
      }
      foreground: {
        [rootSessionID: string]: {
          rootSessionID: string
          latestSessionID: string
          latestUserIntent: string
          state: "idle" | "responding" | "planning"
          awaitingPromotion: boolean
          activeSessionID: string
        }
      }
      mission: {
        [rootSessionID: string]: SessionMissionSurface
      }
      operator: {
        [rootSessionID: string]: SessionOperatorSurface
      }
      timeline: {
        [rootSessionID: string]: SessionTimelineSurface
      }
      tracker_summary: {
        [rootSessionID: string]: SessionTrackerSummarySurface
      }
      root_surface_refresh_diagnostics: RootSurfaceRefreshDiagnostics
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
      path: Path
      workspaceList: Workspace[]
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      plan_state: {},
      planner_preview: {},
      workgraph: {},
      foreground: {},
      mission: {},
      operator: {},
      timeline: {},
      tracker_summary: {},
      root_surface_refresh_diagnostics: createRootSurfaceRefreshDiagnostics(),
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      path: { state: "", config: "", worktree: "", directory: "" },
      workspaceList: [],
    })

    const sdk = useSDK()

    async function syncWorkspaces() {
      const result = await sdk.client.experimental.workspace.list().catch(() => undefined)
      if (!result?.data) return
      setStore("workspaceList", reconcile(result.data))
    }

    function findMessageSessionID(messageID?: string) {
      if (!messageID) return undefined
      for (const messages of Object.values(store.message)) {
        const match = messages?.find((message) => message.id === messageID)
        if (match?.sessionID) return match.sessionID
      }
      return undefined
    }

    const rootSurfaceRefreshScheduler = createRootSurfaceRefreshScheduler({
      refresh: (sessionID) => syncRootSurfaces(sessionID),
    })

    onCleanup(() => {
      rootSurfaceRefreshScheduler.cancelAll()
    })

    sdk.event.listen((e) => {
      const event = e.details
      switch (event.type) {
        case "server.instance.disposed":
          rootSurfaceRefreshScheduler.cancelAll()
          void bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (!result.found) break
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field
              if (field === "text" && "text" in part) {
                part.text = (part.text ?? "") + event.properties.delta
              }
            }),
          )
          break
        }

        case "message.part.removed": {
          const parts = store.part[event.properties.messageID]
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "lsp.updated": {
          void sdk.client.lsp.status().then((x) => setStore("lsp", x.data!))
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
      rootSurfaceRefreshScheduler.schedule(getRootSurfaceRefreshSessionID(event, findMessageSessionID))
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap() {
      console.log("bootstrapping")
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      const sessionListPromise = sdk.client.session
        .list({ start: start })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({}, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({}, { throwOnError: true })
      const consoleStatePromise = sdk.client.experimental.console
        .get({}, { throwOnError: true })
        .then((x) => ConsoleState.parse(x.data))
        .catch(() => emptyConsoleState)
      const agentsPromise = sdk.client.app.agents({}, { throwOnError: true })
      const configPromise = sdk.client.config.get({}, { throwOnError: true })
      const blockingRequests: Promise<unknown>[] = [
        providersPromise,
        providerListPromise,
        agentsPromise,
        configPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ]

      await Promise.all(blockingRequests)
        .then(() => {
          const providersResponse = providersPromise.then((x) => x.data)
          const providerListResponse = providerListPromise.then((x) => x.data)
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            consoleStateResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const consoleState = responses[2]
            const agents = responses[3]
            const config = responses[4]
            const sessions = responses[5]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("console_state", reconcile(consoleState))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          void Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            sdk.client.command.list().then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status().then((x) => setStore("lsp", reconcile(x.data!))),
            sdk.client.mcp.status().then((x) => setStore("mcp", reconcile(x.data!))),
            sdk.client.experimental.resource.list().then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status().then((x) => setStore("formatter", reconcile(x.data!))),
            sdk.client.session.status().then((x) => {
              setStore("session_status", reconcile(x.data!))
            }),
            sdk.client.provider.auth().then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get().then((x) => setStore("vcs", reconcile(x.data))),
            sdk.client.path.get().then((x) => setStore("path", reconcile(x.data!))),
            syncWorkspaces(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          await exit(e)
        })
    }

    onMount(() => {
      void bootstrap()
    })

    const fullSyncedSessions = new Set<string>()
    async function syncRootSurfaces(sessionID: string) {
      const startedAt = Date.now()
      const results = await fetchRootSurfacePayloads(getRootSurfaceRawClient(sdk.client), sessionID)
      if (results.length === 0) return
      const completedAt = Date.now()
      const rootSessionID = results.find((result) => result.data?.rootSessionID)?.data?.rootSessionID ?? sessionID
      setStore(
        produce((draft) => {
          applyRootSurfaceFetchResults(draft, results)
          recordRootSurfaceRefreshDiagnostics(draft.root_surface_refresh_diagnostics, {
            durationMS: completedAt - startedAt,
            completedAt,
            sessionID,
            rootSessionID,
            surfaces: results.map((result) => ({
              name: result.name,
              durationMS: result.durationMS,
              ok: result.ok,
            })),
          })
        }),
      )
    }

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) {
            await syncRootSurfaces(sessionID)
            return
          }
          const [session, messages, todo, diff] = await Promise.all([
            sdk.client.session.get({ sessionID }, { throwOnError: true }),
            sdk.client.session.messages({ sessionID, limit: 100 }),
            sdk.client.session.todo({ sessionID }),
            sdk.client.session.diff({ sessionID }),
          ])
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = session.data
              if (!match.found) draft.session.splice(match.index, 0, session.data)
              draft.todo[sessionID] = todo.data ?? []
              const sessionMessages = messages.data ?? []
              draft.message[sessionID] = sessionMessages.map((x) => x.info)
              for (const message of sessionMessages) {
                draft.part[message.info.id] = message.parts
              }
              draft.session_diff[sessionID] = diff.data ?? []
            }),
          )
          await syncRootSurfaces(sessionID)
          fullSyncedSessions.add(sessionID)
        },
      },
      workspace: {
        get(workspaceID: string) {
          return store.workspaceList.find((workspace) => workspace.id === workspaceID)
        },
        sync: syncWorkspaces,
      },
      bootstrap,
    }
    return result
  },
})
