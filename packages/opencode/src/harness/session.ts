import path from "path"
import { randomBytes } from "crypto"
import { mkdir, readdir, rm } from "fs/promises"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"
import { PermissionNext } from "@/permission/next"
import { Provider } from "@/provider/provider"
import { isPreferredModel } from "@/provider/preferred"
import { Server } from "@/server/server"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Identifier } from "@/id/id"
import { MessageV2 } from "@/session/message-v2"
import { Filesystem } from "@/util/filesystem"
import { HarnessExperience } from "./experience"
import { canonicalHarnessSourceRoot } from "./paths"
import { TimeoutError, SessionError, NetworkError, classifyError } from "./errors"
import { Lock } from "@/util/lock"
import { ChromeInstancePool, type ChromeInstance } from "@/mcp/chrome-instance-pool"

// Type guards and helpers for SDK client access patterns
type SdkClientWithSession = {
  client?: {
    session?: {
      messages?: {
        bind: (ctx: any) => (params: { sessionID: string; limit?: number }) => Promise<any>
      }
      list?: {
        bind: (ctx: any) => () => Promise<any>
      }
    }
  }
  session?: {
    messages?: {
      bind: (ctx: any) => (params: { sessionID: string; limit?: number }) => Promise<any>
    }
    list?: {
      bind: (ctx: any) => () => Promise<any>
    }
  }
}

type SessionListResult = {
  data?: Array<{
    id?: string
    parentID?: string
    [key: string]: unknown
  }>
}

type MessageListResult = {
  data?: Array<{
    id?: string
    info?: {
      role?: string
      time?: {
        created?: number
        updated?: number
        completed?: number
        start?: number
      }
      [key: string]: unknown
    }
    parts?: Array<{
      type?: string
      text?: string
      id?: string
      time?: {
        start?: number
        end?: number
      }
      [key: string]: unknown
    }>
    [key: string]: unknown
  }>
}

type AssistantMessage = {
  info?: {
    role?: string
    time?: {
      created?: number
      updated?: number
      completed?: number
      start?: number
      [key: string]: unknown
    }
    structured?: unknown
    model?: {
      providerID?: string
      modelID?: string
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  parts?: Array<{
    type?: string
    text?: string
    reasoning?: string
    id?: string
    time?: {
      start?: number
      end?: number
      [key: string]: unknown
    }
    [key: string]: unknown
  }>
  [key: string]: unknown
}

type StreamEvent = {
  type: string
  properties: {
    info?: {
      id?: string
      sessionID: string
      role?: string
      parentID?: string
      finish?: boolean
      error?: unknown
      structured?: unknown
      time?: {
        completed?: number
      }
      [key: string]: unknown
    }
    part?: {
      id?: string
      type?: string
      text?: string
      sessionID: string
      time?: {
        start?: number
        end?: number
      }
      [key: string]: unknown
    }
    sessionID?: string
    error?: unknown
    id?: string
    status?: {
      type?: string
    }
    [key: string]: unknown
  }
}

type StreamEventDelta = {
  type: string
  properties: {
    sessionID: string
    partID?: string
    field?: string
    delta?: string
    [key: string]: unknown
  }
}

// Type guard for session list results
export function isSessionListResult(result: unknown): result is SessionListResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "data" in result &&
    Array.isArray((result as SessionListResult).data)
  )
}

// Type guard for message list results
export function isMessageListResult(result: unknown): result is MessageListResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "data" in result &&
    Array.isArray((result as MessageListResult).data)
  )
}

// Type guard for assistant messages
export function isAssistantMessage(msg: unknown): msg is AssistantMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "info" in msg &&
    typeof (msg as AssistantMessage).info === "object"
  )
}

// Helper to extract session list data safely
export function extractSessionList(result: unknown): Array<{ id?: string; parentID?: string }> {
  if (!isSessionListResult(result)) return []
  return (result.data ?? []).filter(
    (item): item is { id?: string; parentID?: string } =>
      typeof item === "object" && item !== null
  )
}

// Helper to extract message list data safely
export function extractMessageList(result: unknown): NonNullable<MessageListResult["data"]> {
  if (!isMessageListResult(result)) return []
  return (result.data ?? []).filter(
    (item): item is NonNullable<MessageListResult["data"]>[number] =>
      typeof item === "object" && item !== null
  )
}

// Singleton Chrome instance pool for browser isolation
const chromePool = new ChromeInstancePool({
  basePort: 9222,
  instanceCount: 3,
  healthCheckInterval: 30000,
  spawnTimeout: 30000,
  maxSpawnAttempts: 3,
})

export type HarnessModelLane = "author" | "reviewer" | "healer"

type HarnessModelStats = {
  attempts: number
  success: number
  failure: number
  repairs: number
  fallbacks: number
  lastSuccessAt?: number
  lastFailureAt?: number
}

type HarnessModelScorecard = {
  version: 1
  updatedAt: number
  lanes: Record<HarnessModelLane, Record<string, HarnessModelStats>>
}

export type HarnessModelRoute = {
  lane: HarnessModelLane
  requestedModel: string
  selectedModel: string
  baseScore: number
  empiricalScore: number
  totalScore: number
  reason: string
  policy?: "exact-output-safe"
}

export type HarnessPreferredRoute = {
  model: string
  variant?: string
  agent?: string
  source: "completed" | "accepted"
}

export type HarnessReadOnlySessionInput = {
  title: string
  prompt: string
  model?: string
  preferredModel?: string
  lane?: HarnessModelLane
  stage?: "explore" | "patch" | "review" | "research"
  variant?: string
  avoidModel?: string
  agent?: string
  artifactFiles?: string[]
  permission?: PermissionNext.Ruleset
  format?: MessageV2.OutputFormat
  system?: string
  timeoutMS?: number
  stallMS?: number
  startupStallMS?: number
  onProgress?: (progress: HarnessSessionProgress) => void | Promise<void>
  tracePath?: string
}

export type HarnessSessionProgress = {
  rootSessionID?: string
  sessionID?: string
  requestedModel?: string
  selectedModel?: string
  resolvedModel?: string
  routing?: HarnessModelRoute
  kind: string
  timestamp: number
  partialRaw?: string
  partialChars?: number
  reasoningRaw?: string
  reasoningChars?: number
  error?: string
}

type HarnessSessionTraceEvent = {
  time: number
  kind: string
  stage?: string
  lane?: HarnessModelLane
  rootSessionID?: string
  sessionID?: string
  requestedModel?: string
  selectedModel?: string
  resolvedModel?: string
  progress?: string
  eventType?: string
  role?: string
  finish?: boolean
  partType?: string
  partChars?: number
  hasStructured?: boolean
  statusType?: string
  messageCount?: number
  hasAssistant?: boolean
  requestMethod?: string
  requestUrl?: string
  browserUrl?: string
  instanceId?: string
  reasoningChars?: number
  responseStatus?: number
  error?: string
}

async function appendTraceLine(path: string, line: string) {
  const existing = await Bun.file(path).text().catch(() => "")
  const content = existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`
  await Filesystem.write(path, content)
}

export function callerHarnessRoot() {
  return process.env.OPENCODE_HARNESS_ROOT || process.cwd()
}

export function sourceRoot() {
  return canonicalHarnessSourceRoot(process.env.OPENCODE_HARNESS_SOURCE_ROOT, process.cwd())
}

function sourceRootPattern() {
  const normalized = sourceRoot().replaceAll("\\", "/").replace(/\/+$/, "")
  return `${normalized}/*`
}

function routingPath() {
  return path.join(callerHarnessRoot(), ".opencode", "runtime", "harness", "model-routing.json")
}

function emptyScorecard(): HarnessModelScorecard {
  return {
    version: 1,
    updatedAt: 0,
    lanes: {
      author: {},
      reviewer: {},
      healer: {},
    },
  }
}

function normalizeLimit(value: number | undefined, max: number) {
  if (!value || value <= 0) return 0
  return Math.min(value, max) / max
}

function shouldAdaptiveRoute(model?: string) {
  if (!model) return true
  const parsed = Provider.parseModel(model)
  return parsed.providerID === "auto" && parsed.modelID === "quality"
}

function modelRef(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

function gptFamily(model: Provider.Model) {
  const provider = model.providerID.toLowerCase()
  const id = model.id.toLowerCase()
  if (provider === "openai") return true
  if (id.startsWith("gpt-")) return true
  if (id.includes("/gpt-")) return true
  return false
}

function codexFamily(model: Provider.Model) {
  return model.id.toLowerCase().includes("codex")
}

function codexSpark(model: Provider.Model) {
  const id = model.id.toLowerCase()
  return id.includes("codex-spark") || (id.includes("codex") && id.includes("spark"))
}

function exactOutputSafeProvider(providerID: string) {
  const provider = providerID.toLowerCase()
  if (provider === "alibaba-coding-plan") return true
  return false
}

function allowedHarnessFamily(model: Provider.Model, lane: HarnessModelLane, preferred = false) {
  const provider = model.providerID.toLowerCase()
  const modelID = model.id.toLowerCase()
  if (provider === "fixture") return true
  if (provider === "openai" && codexSpark(model)) return true
  if (provider === "alibaba-coding-plan") return true
  if (lane !== "author" && provider === "opencode" && modelID.includes("free")) return true
  if (lane !== "author" && provider === "openrouter" && modelID.includes(":free")) return true
  if (lane !== "author" && exactOutputSafeProvider(provider)) return true
  return false
}

function isAllowedHarnessModelRef(modelRef: string | undefined, lane: HarnessModelLane) {
  if (!modelRef) return false
  const parsed = Provider.parseModel(modelRef)
  if (parsed.providerID === "fixture") return true
  if (parsed.providerID === "alibaba-coding-plan") return true
  if (lane !== "author" && parsed.providerID === "opencode" && parsed.modelID.toLowerCase().includes("free")) return true
  if (lane !== "author" && parsed.providerID === "openrouter" && parsed.modelID.toLowerCase().includes(":free")) return true
  if (lane !== "author" && exactOutputSafeProvider(parsed.providerID)) return true
  if (parsed.providerID === "openai") {
    return codexSpark({
      providerID: parsed.providerID,
      id: parsed.modelID,
    } as Provider.Model)
  }
  return false
}

function fallbackHarnessModelRef(
  providers: Record<string, Provider.Info>,
  lane: HarnessModelLane,
  avoidModel?: string,
) {
  const curated = [
    "alibaba-coding-plan/qwen3.5-plus",
    "alibaba-coding-plan/glm-5",
    "alibaba-coding-plan/kimi-k2.5",
    "alibaba-coding-plan/MiniMax-M2.5",
    "openai/codex-spark",
  ]

  for (const candidate of curated) {
    if (candidate === avoidModel) continue
    if (!isAllowedHarnessModelRef(candidate, lane)) continue
    const parsed = Provider.parseModel(candidate)
    const provider = providers[parsed.providerID]
    if (provider?.models?.[parsed.modelID]) return candidate
  }

  const fixtureProvider = providers.fixture
  if (!fixtureProvider) return
  return Object.keys(fixtureProvider.models)
    .sort()
    .map((modelID) => `fixture/${modelID}`)
    .find((candidate) => candidate !== avoidModel)
}

function baseScore(model: Provider.Model, lane: HarnessModelLane, preferred = false) {
  if (!allowedHarnessFamily(model, lane, preferred)) return Number.NEGATIVE_INFINITY
  if (!preferred && gptFamily(model) && !codexSpark(model)) return Number.NEGATIVE_INFINITY

  const text = Number(model.capabilities.input.text && model.capabilities.output.text)
  if (!text) return Number.NEGATIVE_INFINITY

  const tool = Number(model.capabilities.toolcall)
  if (lane === "author" && !tool) return Number.NEGATIVE_INFINITY

  const reasoning = Number(model.capabilities.reasoning)
  const context = normalizeLimit(model.limit.context, 262_144)
  const output = normalizeLimit(model.limit.output, 65_536)
  const cost = model.cost.input + model.cost.output + model.cost.cache.read + model.cost.cache.write
  const cheap = 1 / (1 + cost)

  if (lane === "author") {
    return text * 6 + tool * 4 + reasoning * 3.5 + context * 2 + output + cheap * 0.25
  }

  if (lane === "healer") {
    return text * 6 + reasoning * 5.5 + context * 3 + output * 1.5 + cheap * 0.25
  }

  return text * 6 + reasoning * 5 + context * 3 + tool * 0.25 + output * 1.5 + cheap * 0.25
}

function empiricalScore(stats?: HarnessModelStats) {
  if (!stats || stats.attempts <= 0) return 0

  const attempts = Math.max(stats.attempts, 1)
  const successRate = stats.success / attempts
  const failureRate = stats.failure / attempts
  const repairRate = stats.repairs / attempts
  const fallbackRate = stats.fallbacks / attempts
  const trendingUp =
    stats.lastSuccessAt && (!stats.lastFailureAt || stats.lastSuccessAt >= stats.lastFailureAt) ? 0.35 : 0
  const trendingDown =
    stats.lastFailureAt && (!stats.lastSuccessAt || stats.lastFailureAt > stats.lastSuccessAt) ? 0.35 : 0

  return successRate * 2.5 - failureRate * 2 - repairRate * 0.75 - fallbackRate * 0.5 + Math.min(stats.success, 4) * 0.1 + trendingUp - trendingDown
}

export async function readHarnessPreferredModel(lane: HarnessModelLane) {
  return (await readHarnessPreferredRoute(lane))?.model
}

export async function readHarnessPreferredRoute(lane: HarnessModelLane): Promise<HarnessPreferredRoute | undefined> {
  if (lane !== "author") return undefined
  return HarnessExperience.preferred().catch(() => undefined)
}

export function pickHarnessSessionModel(input: {
  lane: HarnessModelLane
  providers: Record<string, Provider.Info>
  scorecard?: HarnessModelScorecard
  requestedModel?: string
  avoidModel?: string
  preferredModel?: string
}): HarnessModelRoute | undefined {
  const requestedModel = input.requestedModel ?? "auto/quality"
  if (!shouldAdaptiveRoute(requestedModel)) {
    if (!isAllowedHarnessModelRef(requestedModel, input.lane)) {
      const fallback = pickHarnessSessionModel({
        ...input,
        requestedModel: "auto/quality",
      })
      if (!fallback) return
      return {
        ...fallback,
        requestedModel,
        reason: "policy-filtered",
      }
    }
    return {
      lane: input.lane,
      requestedModel,
      selectedModel: requestedModel,
      baseScore: 0,
      empiricalScore: 0,
      totalScore: 0,
      reason: "explicit",
      policy: input.lane === "author" ? undefined : "exact-output-safe",
    }
  }

  const stats = input.scorecard?.lanes[input.lane] ?? {}
  const ranked = Object.values(input.providers)
    .flatMap((provider) =>
      Object.values(provider.models).map((model) => {
        const ref = modelRef(provider.id, model.id)
        const preferred = input.preferredModel === ref && !codexSpark(model)
        const base = baseScore(model, input.lane, preferred)
        const empirical = empiricalScore(stats[ref])
        const affinity =
          preferred
            ? input.lane === "author"
              ? 1.75
              : -0.5
            : 0
        return {
          selectedModel: ref,
          baseScore: base,
          empiricalScore: empirical,
          totalScore: base + empirical + affinity,
          affinity,
        }
      }),
    )
    .filter((item) => Number.isFinite(item.baseScore))
    .sort((a, b) => {
      if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore
      if (a.empiricalScore !== b.empiricalScore) return b.empiricalScore - a.empiricalScore
      if (a.baseScore !== b.baseScore) return b.baseScore - a.baseScore
      return a.selectedModel.localeCompare(b.selectedModel)
    })
  const preferredRanked = ranked.filter((item) => isPreferredModel(Provider.parseModel(item.selectedModel).modelID))
  const scoped = preferredRanked.length ? preferredRanked : ranked

  const filtered =
    input.avoidModel && scoped.some((item) => item.selectedModel !== input.avoidModel)
      ? scoped.filter((item) => item.selectedModel !== input.avoidModel)
      : scoped
  const pick = filtered[0] ?? scoped[0]
  if (!pick) return

  return {
    lane: input.lane,
    requestedModel,
    selectedModel: pick.selectedModel,
    baseScore: pick.baseScore,
    empiricalScore: pick.empiricalScore,
    totalScore: pick.totalScore,
    reason:
      input.lane !== "author"
        ? "exact-output-safe"
        : pick.affinity > 0
          ? "main-session-affinity"
          : pick.empiricalScore !== 0
            ? "adaptive-scorecard"
            : "capability-first",
    policy: input.lane === "author" ? undefined : "exact-output-safe",
  }
}

export async function readHarnessModelScorecard() {
  const data = await Filesystem.readJson<HarnessModelScorecard>(routingPath()).catch(() => undefined)
  if (!data || typeof data !== "object") return emptyScorecard()
  return {
    version: 1,
    updatedAt: data.updatedAt ?? 0,
    lanes: {
      author: data.lanes?.author ?? {},
      reviewer: data.lanes?.reviewer ?? {},
      healer: data.lanes?.healer ?? {},
    },
  } satisfies HarnessModelScorecard
}

async function writeHarnessModelScorecard(scorecard: HarnessModelScorecard) {
  await Filesystem.writeJson(routingPath(), {
    ...scorecard,
    version: 1,
    updatedAt: Date.now(),
  })
}

export async function recordHarnessModelOutcome(input: {
  lane: HarnessModelLane
  model?: string
  success: boolean
  repair?: boolean
  fallback?: boolean
}) {
  if (!input.model) return

  const scorecard = await readHarnessModelScorecard()
  const lane = scorecard.lanes[input.lane]
  const current = lane[input.model] ?? {
    attempts: 0,
    success: 0,
    failure: 0,
    repairs: 0,
    fallbacks: 0,
  }

  current.attempts += 1
  if (input.success) {
    current.success += 1
    current.lastSuccessAt = Date.now()
  } else {
    current.failure += 1
    current.lastFailureAt = Date.now()
  }
  if (input.repair) current.repairs += 1
  if (input.fallback) current.fallbacks += 1

  lane[input.model] = current
  await writeHarnessModelScorecard(scorecard)
}

function readOnlyRules(): PermissionNext.Ruleset {
  return [
    // Interactive control-flow tools would stall autonomous harness runs.
    { permission: "question", action: "deny", pattern: "*" },
    { permission: "plan_enter", action: "deny", pattern: "*" },
    { permission: "plan_exit", action: "deny", pattern: "*" },
    { permission: "enter_plan_mode", action: "deny", pattern: "*" },
    { permission: "exit_plan_mode", action: "deny", pattern: "*" },
    { permission: "edit", action: "deny", pattern: "*" },
    { permission: "bash", action: "deny", pattern: "*" },
    { permission: "task", action: "allow", pattern: "*" },
    { permission: "todowrite", action: "allow", pattern: "*" },
    { permission: "todoread", action: "allow", pattern: "*" },
    { permission: "webfetch", action: "allow", pattern: "*" },
    { permission: "websearch", action: "allow", pattern: "*" },
    { permission: "searxng_*", action: "allow", pattern: "*" },
    { permission: "websearch-stacked_*", action: "allow", pattern: "*" },
    { permission: "playwright_*", action: "allow", pattern: "*" },
    { permission: "chrome-devtools_*", action: "allow", pattern: "*" },
    { permission: "external_directory", action: "allow", pattern: sourceRootPattern() },
    { permission: "glob", action: "allow", pattern: "*" },
    { permission: "grep", action: "allow", pattern: "*" },
    { permission: "list", action: "allow", pattern: "*" },
    { permission: "read", action: "allow", pattern: "*" },
    { permission: "codesearch", action: "allow", pattern: "*" },
  ]
}

function noToolRules(): PermissionNext.Ruleset {
  return [
    { permission: "*", action: "deny", pattern: "*" },
    { permission: "question", action: "deny", pattern: "*" },
    { permission: "plan_enter", action: "deny", pattern: "*" },
    { permission: "plan_exit", action: "deny", pattern: "*" },
    { permission: "enter_plan_mode", action: "deny", pattern: "*" },
    { permission: "exit_plan_mode", action: "deny", pattern: "*" },
    { permission: "edit", action: "deny", pattern: "*" },
    { permission: "bash", action: "deny", pattern: "*" },
    { permission: "task", action: "deny", pattern: "*" },
    { permission: "webfetch", action: "deny", pattern: "*" },
    { permission: "websearch", action: "deny", pattern: "*" },
    { permission: "external_directory", action: "deny", pattern: "*" },
    { permission: "glob", action: "deny", pattern: "*" },
    { permission: "grep", action: "deny", pattern: "*" },
    { permission: "list", action: "deny", pattern: "*" },
    { permission: "read", action: "deny", pattern: "*" },
    { permission: "codesearch", action: "deny", pattern: "*" },
  ]
}

export const HarnessSessionRules = {
  readOnly: readOnlyRules,
  noTools: noToolRules,
}

export type HarnessSessionCheckpointState = 
  | "starting"
  | "model_routed"
  | "root_session_created"
  | "child_session_created"
  | "event_stream_ready"
  | "prompt_dispatched"
  | "processing"
  | "completed"
  | "error"

export type HarnessSessionCheckpoint = {
  version: 1
  checkpointID: string
  state: HarnessSessionCheckpointState
  input: HarnessReadOnlySessionInput
  rootSessionID?: string
  sessionID?: string
  route?: HarnessModelRoute
  textParts: string[]
  streamedPartOrder: string[]
  streamedPartTexts: Record<string, string>
  seenPartIDs: string[]
  lastEmittedPartial: string
  lastEmittedReasoning: string
  structuredOutput?: unknown
  error?: string
  progressKind: string
  trackedSessionIDs: string[]
  createdAt: number
  updatedAt: number
}

function checkpointsDir() {
  return path.join(callerHarnessRoot(), ".opencode", "runtime", "harness", "checkpoints")
}

function checkpointPath(checkpointID: string) {
  return path.join(checkpointsDir(), `${checkpointID}.json`)
}

function generateCheckpointID(input: HarnessReadOnlySessionInput): string {
  const timestamp = Date.now()
  const titleHash = input.title.slice(0, 32).replace(/[^a-zA-Z0-9]/g, "_")
  return `harness_${titleHash}_${timestamp}`
}

async function saveCheckpoint(checkpoint: HarnessSessionCheckpoint): Promise<void> {
  const target = checkpointPath(checkpoint.checkpointID)
  await mkdir(checkpointsDir(), { recursive: true })
  using _ = await Lock.write(target)
  await Filesystem.writeJson(target, {
    ...checkpoint,
    updatedAt: Date.now(),
  })
}

async function loadCheckpoint(checkpointID: string): Promise<HarnessSessionCheckpoint | undefined> {
  const target = checkpointPath(checkpointID)
  using _ = await Lock.read(target)
  const raw = await Filesystem.readJson<HarnessSessionCheckpoint>(target).catch(() => undefined)
  if (!raw || raw.version !== 1) return undefined
  return raw
}

async function findLatestCheckpointForInput(
  input: HarnessReadOnlySessionInput
): Promise<HarnessSessionCheckpoint | undefined> {
  const dir = checkpointsDir()
  const entries = await readdir(dir).catch(() => [] as string[])

  let latest: HarnessSessionCheckpoint | undefined
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    const checkpoint = await loadCheckpoint(entry.replace(".json", "")).catch(() => undefined)
    if (!checkpoint) continue
    if (checkpoint.input.title !== input.title) continue
    if (checkpoint.state === "completed" || checkpoint.state === "error") continue
    if (!latest || checkpoint.updatedAt > latest.updatedAt) {
      latest = checkpoint
    }
  }
  return latest
}

async function cleanupCheckpoint(checkpointID: string): Promise<void> {
  const target = checkpointPath(checkpointID)
  await rm(target, { force: true }).catch(() => {})
}

function createInitialCheckpoint(
  checkpointID: string,
  input: HarnessReadOnlySessionInput,
): HarnessSessionCheckpoint {
  return {
    version: 1,
    checkpointID,
    state: "starting",
    input,
    textParts: [],
    streamedPartOrder: [],
    streamedPartTexts: {},
    seenPartIDs: [],
    lastEmittedPartial: "",
    lastEmittedReasoning: "",
    progressKind: "session_start",
    trackedSessionIDs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function extractCompleteApplyPatch(raw: string) {
  const begin = raw.indexOf("*** Begin Patch")
  if (begin === -1) return
  const endMarker = "*** End Patch"
  const end = raw.indexOf(endMarker, begin)
  if (end === -1) return
  const body = raw.slice(begin, end + endMarker.length).trim()
  if (!body.startsWith("*** Begin Patch") || !body.endsWith("*** End Patch")) return
  return body
}

function earlyCompletionGraceMS(timeoutMS?: number) {
  if (!timeoutMS || timeoutMS <= 0) return 2_500
  return Math.max(750, Math.min(3_000, Math.floor(timeoutMS / 12)))
}

async function harnessArtifactParts(files: string[]) {
  const parts: Array<{ type: "text"; text: string }> = []
  for (const file of files) {
    const content = await Filesystem.readText(file).catch(() => undefined)
    if (content == null) continue
    parts.push({
      type: "text",
      text: [`Artifact file: ${file}`, "", "```text", content, "```"].join("\n"),
    })
  }
  return parts
}

async function withSourceBootstrap<T>(fn: () => Promise<T>) {
  const root = sourceRoot()
  if (Instance.active()?.directory === root) {
    return fn()
  }
  return Instance.provide({
    directory: root,
    init: InstanceBootstrap,
    fn,
  })
}

export async function runReadOnlyHarnessSession(input: HarnessReadOnlySessionInput) {
  return withSourceBootstrap(async () => {
    if (input.tracePath) {
      await Filesystem.write(input.tracePath, "")
    }

    const checkpointID = generateCheckpointID(input)
    let checkpoint: HarnessSessionCheckpoint | undefined
    
    const existingCheckpoint = await findLatestCheckpointForInput(input)
    if (existingCheckpoint) {
      checkpoint = existingCheckpoint
    } else {
      checkpoint = createInitialCheckpoint(checkpointID, input)
      await saveCheckpoint(checkpoint)
    }

    const shouldResume = checkpoint.state !== "starting" && checkpoint.state !== "completed" && checkpoint.state !== "error"

    let traceEvent: (
      patch: Omit<
        HarnessSessionTraceEvent,
        "time" | "stage" | "lane" | "rootSessionID" | "sessionID" | "requestedModel" | "selectedModel" | "resolvedModel"
      >,
    ) => void = () => {}
    const fetchFn = (async (requestInfo: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(requestInfo, init)
      traceEvent({
        kind: "fetch_started",
        requestMethod: request.method,
        requestUrl: request.url,
      })
      try {
        const response = await Server.App().fetch(request)
        traceEvent({
          kind: "fetch_resolved",
          requestMethod: request.method,
          requestUrl: request.url,
          responseStatus: response.status,
        })
        return response
      } catch (error) {
        traceEvent({
          kind: "fetch_failed",
          requestMethod: request.method,
          requestUrl: request.url,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }) as typeof globalThis.fetch

    const sdk = createOpencodeClient({
      baseUrl: "http://opencode.internal",
      fetch: fetchFn,
    })
    let rootSessionID: string | undefined
    let sessionID: string | undefined
    let events: Awaited<ReturnType<typeof sdk.event.subscribe>> | undefined
    const timeoutMS = input.timeoutMS && input.timeoutMS > 0 ? input.timeoutMS : undefined
    const stallMS = input.stallMS && input.stallMS > 0 ? input.stallMS : undefined
    const startupStallMS =
      stallMS !== undefined && input.startupStallMS && input.startupStallMS > 0
        ? Math.max(stallMS, input.startupStallMS)
        : stallMS
    let timedOut = false
    let stalled = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    let stallHandle: ReturnType<typeof setTimeout> | undefined
    let completionHandle: ReturnType<typeof setTimeout> | undefined
    let earlyCompleted = false
    let lastProgressKind = "session_start"
    let stallReject: ((error: Error) => void) | undefined
    let route: HarnessModelRoute | undefined
    let lastEmittedPartial = ""
    let lastEmittedReasoning = ""
    let traceWrite = Promise.resolve()
    let chromeInstance: ChromeInstance | undefined
    let messagesPollHandle: ReturnType<typeof setInterval> | undefined
    
    // Variables for tracking assistant message output (declared early for hasVisibleOutput)
    let structuredOutput: unknown | undefined
    let textParts: string[] = []
    let latestAssistantMessage: AssistantMessage | undefined
    let resultTapID: string | undefined
    let promptModule: (typeof import("@/session/prompt")) | undefined
    
    // Cleanup function to clear all timers - must be called on all exit paths
    const clearAllTimers = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        timeoutHandle = undefined
      }
      if (stallHandle) {
        clearTimeout(stallHandle)
        stallHandle = undefined
      }
      if (completionHandle) {
        clearTimeout(completionHandle)
        completionHandle = undefined
      }
    }
    
    // Helper functions for assistant message handling (must be defined before hasVisibleOutput)
    const assistantResponseParts = (assistant: AssistantMessage | undefined) =>
      Array.isArray(assistant?.parts) ? assistant.parts : []
    
    const assistantResponseText = (assistant: AssistantMessage | undefined) =>
      assistantResponseParts(assistant)
        .filter((part) => part?.type === "text")
        .map((part) => String(part.text ?? "").trim())
        .filter(Boolean)
        .join("\n\n")
        .trim()
    
    const assistantResponseReasoning = (assistant: AssistantMessage | undefined) =>
      assistantResponseParts(assistant)
        .filter((part) => part?.type === "reasoning")
        .map((part) => String(part.text ?? "").trim())
        .filter(Boolean)
        .join("\n\n")
        .trim()
    
    const assistantHasVisiblePayload = (assistant: AssistantMessage | undefined) => {
      const responseInfo = assistant?.info
      if (responseInfo?.role !== "assistant") return false
      return assistantResponseText(assistant).length > 0 || assistantResponseReasoning(assistant).length > 0 || responseInfo?.structured !== undefined
    }
    
    const stallLabel = input.stage ?? input.lane ?? "session"
    const currentStallMS = (kind: string) =>
      kind === "session_start" && startupStallMS !== undefined ? startupStallMS : stallMS
    const routeSuffix = () => (route?.selectedModel ? ` Route: ${route.selectedModel}.` : "")
    const emitProgress = (patch: Partial<HarnessSessionProgress>) => {
      if (!input.onProgress) return
      void Promise.resolve(
        input.onProgress({
          rootSessionID,
          sessionID,
          requestedModel: route?.requestedModel ?? input.model,
          selectedModel: route?.selectedModel ?? input.model,
          resolvedModel: route?.selectedModel ?? input.model,
          routing: route,
          kind: patch.kind ?? lastProgressKind,
          timestamp: Date.now(),
          partialRaw: patch.partialRaw,
          partialChars: patch.partialChars,
          reasoningRaw: patch.reasoningRaw,
          reasoningChars: patch.reasoningChars,
          error: patch.error,
        }),
      ).catch(() => {})
    }
    const trace = (
      patch: Omit<
        HarnessSessionTraceEvent,
        "time" | "stage" | "lane" | "rootSessionID" | "sessionID" | "requestedModel" | "selectedModel" | "resolvedModel"
      >,
    ) => {
      if (!input.tracePath) return
      traceWrite = traceWrite
        .then(() =>
          appendTraceLine(
            input.tracePath!,
            JSON.stringify({
              time: Date.now(),
              stage: input.stage,
              lane: input.lane,
              rootSessionID,
              sessionID,
              requestedModel: route?.requestedModel ?? input.model,
              selectedModel: route?.selectedModel ?? input.model,
              resolvedModel: route?.selectedModel ?? input.model,
              ...patch,
            } satisfies HarnessSessionTraceEvent),
          ),
        )
        .catch(() => {})
    }
    traceEvent = trace
    const buildStallError = () =>
      new TimeoutError(
        `Harness ${stallLabel} stalled after ${currentStallMS(lastProgressKind)}ms without visible progress. Last progress: ${lastProgressKind}.${routeSuffix()}`,
        {
          lane: input.lane,
          model: route?.selectedModel ?? input.model,
          sessionID,
          timeoutMS: currentStallMS(lastProgressKind),
          lastProgress: lastProgressKind,
        }
      )
    const buildTimeoutError = () =>
      new TimeoutError(
        `Harness session timed out after ${timeoutMS}ms. Last progress: ${lastProgressKind}.${routeSuffix()}`,
        {
          lane: input.lane,
          model: route?.selectedModel ?? input.model,
          sessionID,
          timeoutMS,
          lastProgress: lastProgressKind,
        }
      )
    const abortSession = () => {
      if (sessionID) {
        void sdk.session.abort({ sessionID }).catch(() => {})
      }
      if (rootSessionID) {
        void sdk.session.abort({ sessionID: rootSessionID }).catch(() => {})
      }
      void events?.stream.return?.(undefined).catch(() => {})
      // Release Chrome instance immediately on abort
      if (chromeInstance) {
        void chromePool.release(chromeInstance.id).catch(() => {})
        delete process.env.OPENCODE_CHROME_DEVTOOLS_URL
      }
    }
    const triggerStall = () => {
      if (stalled) return
      stalled = true
      abortSession()
      stallReject?.(buildStallError())
    }
    const armStallTimer = (kind: string) => {
      const budget = currentStallMS(kind)
      if (!budget) return
      if (stallHandle) clearTimeout(stallHandle)
      stallHandle = setTimeout(triggerStall, budget)
    }
    const withTimeout = async <T>(promise: Promise<T>): Promise<T> => {
      if (timeoutMS === undefined && stallMS === undefined) {
        return promise
      }

      let timeoutReject: ((error: Error) => void) | undefined
      let stallRejectLocal: ((error: Error) => void) | undefined
      let timeoutResolved = false
      let stallResolved = false
      let mainResolved = false

      const timeoutProm =
        timeoutMS !== undefined
          ? new Promise<never>((_, reject) => {
              timeoutReject = reject
              timeoutHandle = setTimeout(() => {
                timedOut = true
                abortSession()
                timeoutResolved = true
                reject(buildTimeoutError())
              }, timeoutMS)
            })
          : undefined

      const stallProm =
        stallMS !== undefined
          ? new Promise<never>((_, reject) => {
              stallRejectLocal = reject
              stallReject = reject
              armStallTimer(lastProgressKind)
            })
          : undefined

      const cleanup = () => {
        if (timeoutHandle && !timeoutResolved) {
          clearTimeout(timeoutHandle)
          timeoutHandle = undefined
        }
        if (stallHandle && !stallResolved) {
          clearTimeout(stallHandle)
          stallHandle = undefined
        }
      }

      try {
        const promises: Promise<never | T>[] = [promise]
        if (timeoutProm) promises.push(timeoutProm)
        if (stallProm) promises.push(stallProm)

        const result = await Promise.race(promises)
        mainResolved = true
        cleanup()
        return result as T
      } catch (error) {
        if (!mainResolved) {
          cleanup()
        }
        throw error
      }
    }
    const markProgress = (kind: string) => {
      lastProgressKind = kind
      emitProgress({ kind })
      trace({ kind: "progress", progress: kind })
      if (!stallMS) return
      armStallTimer(kind)
    }
    const hasVisibleOutput = () =>
      structuredOutput !== undefined ||
      textParts.length > 0 ||
      lastEmittedPartial.length > 0 ||
      assistantHasVisiblePayload(latestAssistantMessage)
    const scheduleEarlyCompletion = () => {
      if (timedOut || earlyCompleted) return
      if (completionHandle) clearTimeout(completionHandle)
      completionHandle = setTimeout(() => {
        earlyCompleted = true
        void events?.stream.return?.(undefined).catch(() => {})
      }, earlyCompletionGraceMS(timeoutMS))
    }
    const scheduleEmptyCompletionProbe = (reason: string) => {
      if (timedOut || earlyCompleted || hasVisibleOutput()) return
      if (completionHandle) clearTimeout(completionHandle)
      completionHandle = setTimeout(() => {
        if (timedOut || earlyCompleted || hasVisibleOutput()) return
        trace({
          kind: "prompt_result_settled",
          eventType: reason,
          hasStructured: structuredOutput !== undefined,
          partChars: lastEmittedPartial.length || undefined,
        })
        earlyCompleted = true
        void events?.stream.return?.(undefined).catch(() => {})
      }, earlyCompletionGraceMS(timeoutMS))
    }
    const closeStreamIfVisibleOutputSettled = async (reason: string) => {
      if (!hasVisibleOutput() || earlyCompleted) return
      earlyCompleted = true
      if (completionHandle) {
        clearTimeout(completionHandle)
        completionHandle = undefined
      }
      trace({
        kind: "prompt_result_settled",
        eventType: reason,
        hasStructured: structuredOutput !== undefined,
        partChars: lastEmittedPartial.length || undefined,
      })
      try {
        await events?.stream.return?.(undefined)
      } catch {}
    }

    try {
    const providers = await withTimeout(Provider.list().catch(() => ({})))
    route = pickHarnessSessionModel({
      lane: input.lane ?? "author",
      providers,
      scorecard: await readHarnessModelScorecard().catch(() => emptyScorecard()),
      requestedModel: input.model,
      avoidModel: input.avoidModel,
      preferredModel:
        input.preferredModel ?? (await readHarnessPreferredModel(input.lane ?? "author").catch(() => undefined)),
    })
    markProgress("model_routed")

    // Acquire Chrome instance for isolated browser operations
    try {
      chromeInstance = await chromePool.acquire({
        workerId: input.lane ?? 'author',
        timeout: 30000,
      })
      // Inject browser URL into environment for MCP chrome-devtools
      const browserUrl = `http://localhost:${chromeInstance.port}`
      process.env.OPENCODE_CHROME_DEVTOOLS_URL = browserUrl
      trace({ kind: "chrome_instance_acquired", browserUrl, instanceId: chromeInstance.id })
    } catch (chromeError) {
      // Fall back to existing mutex behavior if instance acquisition fails
      trace({
        kind: "chrome_instance_failed",
        error: chromeError instanceof Error ? chromeError.message : String(chromeError),
      })
      // Continue without isolated Chrome - existing mutex will handle concurrency
    }

    const rootSession = await withTimeout(
      sdk.session.create({
        title: `${input.title} (harness root)`,
        permission: input.permission ?? readOnlyRules(),
      }),
    )
    rootSessionID = rootSession.data?.id
    if (!rootSessionID) throw new Error("Failed to create harness root session.")
    markProgress("root_session_created")

    // Child sessions bypass the normal root-session auto-heavy-subtask promotion,
    // which keeps harness generation/review pinned to the explicitly requested model.
    const session = await withTimeout(
      sdk.session.create({
        title: input.title,
        parentID: rootSessionID,
        permission: input.permission ?? readOnlyRules(),
      }),
    )
    sessionID = session.data?.id
    if (!sessionID) throw new Error("Failed to create harness session.")
    markProgress("child_session_created")
    const trackedSessionIDs = new Set<string>([rootSessionID, sessionID].filter((item): item is string => !!item))

    events = await withTimeout(sdk.event.subscribe())
    markProgress("event_stream_ready")
    const seenPartIDs = new Set<string>()
    const streamedPartTexts = new Map<string, string>()
    const streamedPartOrder: string[] = []
    const streamedReasoningTexts = new Map<string, string>()
    const streamedReasoningOrder: string[] = []
    const tracedUnmatchedStreamSessions = new Set<string>()
    let error: string | undefined
    let assistantFinished = false
    // Access SDK client methods with type-safe fallback pattern
    // The SDK has two possible client structures, so we try both
    const sdkTyped = sdk as unknown as SdkClientWithSession
    const messagesClient =
      sdkTyped.client?.session?.messages?.bind(sdkTyped.client.session ?? {}) ??
      sdkTyped.session?.messages?.bind(sdkTyped.session ?? {})
    const listSessionsClient =
      sdkTyped.client?.session?.list?.bind(sdkTyped.client.session ?? {}) ??
      sdkTyped.session?.list?.bind(sdkTyped.session ?? {})

    const pollSessionFamilyIDs = async () => {
      const family = new Set<string>(trackedSessionIDs)
      if (!listSessionsClient) return [...family]
      const listResult = await listSessionsClient().catch(() => undefined)
      const sessionList = extractSessionList(listResult)
      let added = true
      while (added) {
        added = false
        for (const item of sessionList) {
          const candidateID = typeof item?.id === "string" ? item.id : undefined
          const candidateParentID = typeof item?.parentID === "string" ? item.parentID : undefined
          if (!candidateID || !candidateParentID || !family.has(candidateParentID) || family.has(candidateID)) continue
          family.add(candidateID)
          trackedSessionIDs.add(candidateID)
          added = true
          trace({
            kind: "session_family_discovered",
            eventType: "session.list",
          })
        }
      }
      return [...family]
    }

    const messageTime = (message: any) =>
      Number(
        message?.info?.time?.completed ??
          message?.info?.time?.updated ??
          message?.info?.time?.created ??
          message?.info?.time?.start ??
          0,
      ) || 0

    const applyAssistantMessage = (assistant: unknown, patch?: { traceKind?: string; rootSessionID?: string; completed?: boolean }) => {
      if (!assistant || typeof assistant !== "object") return ""
      const assistantMsg = assistant as AssistantMessage
      if (patch?.rootSessionID && patch.rootSessionID !== sessionID) {
        trace({
          kind: patch.traceKind ?? "assistant_message_observed",
          eventType: "assistant_message",
        })
      }
      const responseInfo = assistantMsg.info
      const responseText = assistantResponseText(assistantMsg)
      const reasoningText = assistantResponseReasoning(assistantMsg)
      if (responseInfo?.structured !== undefined) structuredOutput = responseInfo.structured
      if (assistantHasVisiblePayload(assistantMsg)) latestAssistantMessage = assistantMsg
      if ((responseText && responseText !== lastEmittedPartial) || (reasoningText && reasoningText !== lastEmittedReasoning)) {
        lastEmittedPartial = responseText || lastEmittedPartial
        lastEmittedReasoning = reasoningText || lastEmittedReasoning
        emitProgress({
          kind: "partial_output",
          partialRaw: lastEmittedPartial,
          partialChars: lastEmittedPartial.length,
          reasoningRaw: lastEmittedReasoning,
          reasoningChars: lastEmittedReasoning.length,
        })
        trace({ 
          kind: patch?.traceKind ?? "assistant_message_partial", 
          partChars: responseText.length,
          reasoningChars: reasoningText.length,
        })
      }
      if (
        assistantHasVisiblePayload(assistantMsg) &&
        (patch?.completed || (responseInfo?.time?.completed && (responseText || reasoningText || structuredOutput !== undefined)))
      ) {
        assistantFinished = true
        scheduleEarlyCompletion()
      } else if (patch?.completed || responseInfo?.time?.completed) {
        scheduleEmptyCompletionProbe("assistant_completed_without_visible_output")
      }
      if (input.lane === "author" && responseText && extractCompleteApplyPatch(responseText)) {
        scheduleEarlyCompletion()
      }
      return responseText
    }

    let polling = false
    const pollLatestAssistantMessage = async () => {
      if (!messagesClient || polling) return
      polling = true
      try {
        const candidateSessionIDs = await pollSessionFamilyIDs()
        let assistant: any
        let assistantSessionID: string | undefined
        for (const candidateSessionID of candidateSessionIDs) {
          const messageResult = await messagesClient({ sessionID: candidateSessionID, limit: 20 }).catch(() => undefined)
          const messageList = extractMessageList(messageResult)
          const candidateAssistant = messageList ? [...messageList].reverse().find((message) => message?.info?.role === "assistant") : undefined
          if (!candidateAssistant) continue
          if (!assistant || messageTime(candidateAssistant) >= messageTime(assistant)) {
            assistant = candidateAssistant
            assistantSessionID = candidateSessionID
          }
        }
        if (!assistant) return
        applyAssistantMessage(assistant, {
          traceKind: assistantSessionID && assistantSessionID !== sessionID ? "messages_poll_family_hit" : "messages_poll_partial",
        })
      } finally {
        polling = false
      }
    }

    const consume = (async () => {
      for await (const event of events.stream) {
        if (event.type === "session.created") {
          const info = event.properties.info as { id?: string; parentID?: string } & Record<string, unknown>
          const createdSessionID = typeof info?.id === "string" ? info.id : undefined
          const parentID = typeof info?.parentID === "string" ? info.parentID : undefined
          if (!createdSessionID || !parentID || !trackedSessionIDs.has(parentID)) continue
          if (trackedSessionIDs.has(createdSessionID)) continue
          trackedSessionIDs.add(createdSessionID)
          trace({
            kind: "stream_event",
            eventType: event.type,
          })
          markProgress("descendant_session_created")
        }

        if (event.type === "message.updated") {
          const info = event.properties.info as { sessionID?: string; role?: string; finish?: boolean; error?: unknown; structured?: unknown } & Record<string, unknown>
          const sessionID = typeof info?.sessionID === "string" ? info.sessionID : undefined
          if (!info || !sessionID || !trackedSessionIDs.has(sessionID)) {
            if (info && sessionID && !tracedUnmatchedStreamSessions.has(sessionID)) {
              tracedUnmatchedStreamSessions.add(sessionID)
              trace({
                kind: "stream_event_ignored",
                eventType: event.type,
                role: String(info.role ?? ""),
              })
            }
            continue
          }
          if (info.role !== "assistant") continue
          trace({
            kind: "stream_event",
            eventType: event.type,
            role: String(info.role ?? ""),
            finish: !!info.finish,
            hasStructured: info.structured !== undefined,
          })
          markProgress("assistant_message")
          if (info.structured !== undefined) structuredOutput = info.structured
          if (info.finish && !info.error) {
            assistantFinished = true
            if (hasVisibleOutput()) {
              scheduleEarlyCompletion()
            } else {
              scheduleEmptyCompletionProbe("message_finish_without_visible_output")
            }
          }
        }

        if (event.type === "message.part.updated") {
          const part = event.properties.part as { sessionID?: string; type?: string; text?: string; id?: string; time?: { start?: number; end?: number } } & Record<string, unknown>
          const sessionID = typeof part?.sessionID === "string" ? part.sessionID : undefined
          if (!part || !sessionID || !trackedSessionIDs.has(sessionID)) {
            if (part && sessionID && !tracedUnmatchedStreamSessions.has(sessionID)) {
              tracedUnmatchedStreamSessions.add(sessionID)
              trace({
                kind: "stream_event_ignored",
                eventType: event.type,
                partType: String(part.type ?? "unknown"),
              })
            }
            continue
          }
          trace({
            kind: "stream_event",
            eventType: event.type,
            partType: String(part.type ?? "unknown"),
            partChars: typeof part.text === "string" ? part.text.length : undefined,
          })
          markProgress(`message_part:${String(part.type ?? "unknown")}`)
          if (part.type === "text" || part.type === "reasoning") {
            const isReasoning = part.type === "reasoning"
            const texts = isReasoning ? streamedReasoningTexts : streamedPartTexts
            const order = isReasoning ? streamedReasoningOrder : streamedPartOrder
            
            const partID =
              typeof part.id === "string"
                ? part.id
                : `anon:${String(part.time?.start ?? part.time?.end ?? order.length)}`
            const text = String(part.text ?? "").trim()
            if (text) {
              if (!texts.has(partID)) order.push(partID)
              texts.set(partID, text)
              if (part.time?.end && !seenPartIDs.has(partID)) {
                seenPartIDs.add(partID)
                if (!isReasoning) textParts.push(text)
              }
              const partialRaw = streamedPartOrder
                .map((id) => streamedPartTexts.get(id) ?? "")
                .filter(Boolean)
                .join("\n\n")
                .trim()
              const reasoningRaw = streamedReasoningOrder
                .map((id) => streamedReasoningTexts.get(id) ?? "")
                .filter(Boolean)
                .join("\n\n")
                .trim()
              
              if (
                (partialRaw && partialRaw !== lastEmittedPartial) || 
                (reasoningRaw && reasoningRaw !== lastEmittedReasoning)
              ) {
                lastEmittedPartial = partialRaw || lastEmittedPartial
                lastEmittedReasoning = reasoningRaw || lastEmittedReasoning
                emitProgress({
                  kind: "partial_output",
                  partialRaw: lastEmittedPartial,
                  partialChars: lastEmittedPartial.length,
                  reasoningRaw: lastEmittedReasoning,
                  reasoningChars: lastEmittedReasoning.length,
                })
              }
              if (!isReasoning && input.lane === "author" && extractCompleteApplyPatch(partialRaw)) {
                scheduleEarlyCompletion()
                continue
              }
              if (assistantFinished) scheduleEarlyCompletion()
            }
          }
        }

        if (event.type === "message.part.delta") {
          const part = event.properties as { sessionID?: string; partID?: string; field?: string; delta?: string } & Record<string, unknown>
          const sessionID = typeof part.sessionID === "string" ? part.sessionID : undefined
          if (!sessionID || !trackedSessionIDs.has(sessionID)) {
            if (sessionID && !tracedUnmatchedStreamSessions.has(sessionID)) {
              tracedUnmatchedStreamSessions.add(sessionID)
              trace({
                kind: "stream_event_ignored",
                eventType: event.type,
                partType: typeof part.field === "string" ? part.field : "delta",
              })
            }
            continue
          }
          const partID = typeof part.partID === "string" ? part.partID : undefined
          const delta = typeof part.delta === "string" ? part.delta : ""
          trace({
            kind: "stream_event",
            eventType: event.type,
            partType: typeof part.field === "string" ? part.field : "delta",
            partChars: delta.length || undefined,
          })
          markProgress(`message_part_delta:${String(part.field ?? "unknown")}`)
          if (!partID || (part.field !== "text" && part.field !== "reasoning") || !delta) continue
          
          const isReasoning = part.field === "reasoning"
          const texts = isReasoning ? streamedReasoningTexts : streamedPartTexts
          const order = isReasoning ? streamedReasoningOrder : streamedPartOrder
          
          if (!texts.has(partID)) order.push(partID)
          texts.set(partID, `${texts.get(partID) ?? ""}${delta}`)
          
          const partialRaw = streamedPartOrder
            .map((id) => streamedPartTexts.get(id) ?? "")
            .filter(Boolean)
            .join("\n\n")
            .trim()
          const reasoningRaw = streamedReasoningOrder
            .map((id) => streamedReasoningTexts.get(id) ?? "")
            .filter(Boolean)
            .join("\n\n")
            .trim()
            
          if (
            (partialRaw && partialRaw !== lastEmittedPartial) || 
            (reasoningRaw && reasoningRaw !== lastEmittedReasoning)
          ) {
            lastEmittedPartial = partialRaw || lastEmittedPartial
            lastEmittedReasoning = reasoningRaw || lastEmittedReasoning
            emitProgress({
              kind: "partial_output",
              partialRaw: lastEmittedPartial,
              partialChars: lastEmittedPartial.length,
              reasoningRaw: lastEmittedReasoning,
              reasoningChars: lastEmittedReasoning.length,
            })
          }
          if (!isReasoning && input.lane === "author" && extractCompleteApplyPatch(partialRaw)) {
            scheduleEarlyCompletion()
            continue
          }
          if (assistantFinished) scheduleEarlyCompletion()
        }

        if (event.type === "session.error" && event.properties.sessionID === sessionID && event.properties.error) {
          const payload = event.properties.error
          const nextError = 
            typeof payload === "object" && payload !== null && "data" in payload && 
            typeof (payload as any).data === "object" && (payload as any).data !== null &&
            "message" in (payload as any).data
              ? String(((payload as any).data as any).message)
              : String((payload as any)?.name ?? "Session error")
          trace({
            kind: "stream_event",
            eventType: event.type,
            error: nextError,
          })
          markProgress("session_error")
          error = nextError
          emitProgress({
            kind: "session_error",
            error,
            partialRaw: lastEmittedPartial || undefined,
            partialChars: lastEmittedPartial.length || undefined,
          })
        }

        if (event.type === "permission.asked" && event.properties.sessionID === sessionID) {
          trace({
            kind: "stream_event",
            eventType: event.type,
          })
          markProgress("permission_prompt")
          await sdk.permission.reply({
            requestID: event.properties.id,
            reply: "reject",
          })
        }

        if (
          event.type === "session.status" &&
          event.properties.sessionID === sessionID &&
          event.properties.status.type === "idle"
        ) {
          trace({
            kind: "stream_event",
            eventType: event.type,
            statusType: String(event.properties.status.type ?? ""),
          })
          if (!assistantFinished && !hasVisibleOutput()) {
            markProgress("session_idle_pending")
            scheduleEmptyCompletionProbe("session_idle_without_visible_output")
            continue
          }
          markProgress("session_idle")
          break
        }
      }
    })()

    const harnessLane = input.lane ?? "author"
    const selectedModel =
      route?.selectedModel ??
      (isAllowedHarnessModelRef(input.model, harnessLane) ? input.model : undefined) ??
      fallbackHarnessModelRef(providers, harnessLane, input.avoidModel)
    const model = selectedModel ? Provider.parseModel(selectedModel) : undefined
    const artifactParts = await harnessArtifactParts(input.artifactFiles ?? [])
    resultTapID = `hrt_${randomBytes(16).toString("hex")}`
    const promptInput = {
      sessionID,
      agent: input.agent,
      model,
      priority: "background" as const,
      variant: input.variant,
      format: input.format,
      system: input.system,
      resultTapID,
      parts: [
        ...artifactParts,
        {
          type: "text" as const,
          text: input.prompt,
        },
      ],
    }
    try {
      promptModule = await import("@/session/prompt")
      const { SessionPrompt } = promptModule
      SessionPrompt.registerHarnessResultTap(resultTapID, async (event: any) => {
        trace({
          kind: "prompt_result_tap",
          eventType: event.type,
          partType: "partType" in event ? event.partType : undefined,
          step: "step" in event && typeof event.step === "number" ? event.step : undefined,
          result: "result" in event && typeof event.result === "string" ? event.result : undefined,
          finish: "finish" in event && typeof event.finish === "string" ? event.finish : undefined,
          hasError: "hasError" in event && typeof event.hasError === "boolean" ? event.hasError : undefined,
          messageID: "messageID" in event && typeof event.messageID === "string" ? event.messageID : undefined,
          partChars:
            "snapshot" in event
              ? event.snapshot.length
              : "text" in event
                ? event.text.length
                : undefined,
          hasStructured: event.type === "assistant.structured",
        } as any)
        switch (event.type) {
          case "prompt.user_created":
          case "prompt.no_reply":
          case "prompt.loop_start":
          case "prompt.loop_step":
          case "prompt.history_loaded":
          case "prompt.model_resolved":
          case "prompt.agent_resolved":
          case "prompt.assistant_created":
          case "prompt.processor_start":
          case "prompt.processor_done":
            markProgress(event.type)
            break
          case "assistant.delta":
            markProgress(`prompt_tap_delta:${event.partType}`)
            if (event.partType === "text" && event.snapshot && event.snapshot !== lastEmittedPartial) {
              lastEmittedPartial = event.snapshot
              emitProgress({
                kind: "partial_output",
                partialRaw: event.snapshot,
                partialChars: event.snapshot.length,
              })
              if (input.lane === "author" && extractCompleteApplyPatch(event.snapshot)) {
                scheduleEarlyCompletion()
              }
            }
            if (event.partType === "reasoning" && event.snapshot && event.snapshot !== lastEmittedReasoning) {
              lastEmittedReasoning = event.snapshot
              emitProgress({
                reasoningRaw: event.snapshot,
                reasoningChars: event.snapshot.length,
              })
            }
            break
          case "assistant.part":
            markProgress(`prompt_tap_part:${event.partType}`)
            if (event.partType === "reasoning" && event.text && event.text !== lastEmittedReasoning) {
              lastEmittedReasoning = event.text
              emitProgress({
                reasoningRaw: event.text,
                reasoningChars: event.text.length,
              })
            }
            break
          case "assistant.structured":
            structuredOutput = event.structured
            markProgress("prompt_tap_structured")
            scheduleEarlyCompletion()
            break
          case "assistant.completed":
            markProgress("prompt_tap_completed")
            applyAssistantMessage(event.reply, {
              traceKind: "prompt_result_completed",
              completed: true,
            })
            if (!hasVisibleOutput()) {
              scheduleEmptyCompletionProbe("prompt_tap_completed_without_visible_output")
            }
            break
        }
      })
      trace({ kind: "prompt_started" })
      const promptRequest = SessionPrompt.prompt(promptInput as any)
      markProgress("prompt_dispatched")
      if (messagesClient) {
        messagesPollHandle = setInterval(() => {
          void pollLatestAssistantMessage().catch((pollError) => {
            trace({
              kind: "messages_poll_failed",
              error: pollError instanceof Error ? pollError.message : String(pollError),
            })
          })
        }, 3_000)
        messagesPollHandle.unref?.()
      }
      const promptResult = await withTimeout(promptRequest)
      trace({ kind: "prompt_resolved" })
      if (isAssistantMessage(promptResult) && promptResult.info?.role === "assistant") {
        applyAssistantMessage(promptResult, {
          traceKind: "prompt_result_resolved",
          completed: true,
        })
      }
      if (!hasVisibleOutput()) {
        earlyCompleted = true
        trace({
          kind: "prompt_result_settled",
          eventType: "prompt_resolved_without_visible_output",
          hasStructured: structuredOutput !== undefined,
          partChars: lastEmittedPartial.length || undefined,
        })
        try {
          await events?.stream.return?.(undefined)
        } catch {}
      }
      await closeStreamIfVisibleOutputSettled("prompt_resolved")
    } catch (error) {
      trace({
        kind: "prompt_failed",
        error: error instanceof Error ? error.message : String(error),
      })
      try {
        await events.stream.return?.(undefined)
      } catch {}
      throw error
    }
    await withTimeout(consume)
    if (error) {
      emitProgress({
        kind: "session_error",
        error,
        partialRaw: lastEmittedPartial || undefined,
        partialChars: lastEmittedPartial.length || undefined,
      })
      trace({ kind: "session_error", error })
      await traceWrite
      throw classifyError(error, { lane: input.lane, model: route?.selectedModel ?? input.model, sessionID })
    }
    if (timedOut) {
      const timeoutError = buildTimeoutError()
      emitProgress({
        kind: "session_timeout",
        error: timeoutError.message,
        partialRaw: lastEmittedPartial || undefined,
        partialChars: lastEmittedPartial.length || undefined,
      })
      trace({ kind: "session_timeout", error: timeoutError.message })
      await traceWrite
      throw timeoutError
    }
    if (stalled) {
      const stallError = buildStallError()
      emitProgress({
        kind: "session_stalled",
        error: stallError.message,
        partialRaw: lastEmittedPartial || undefined,
        partialChars: lastEmittedPartial.length || undefined,
      })
      trace({ kind: "session_stalled", error: stallError.message })
      await traceWrite
      throw stallError
    }

    const streamedRaw = (textParts.join("\n\n").trim() || lastEmittedPartial).trim()
    if (streamedRaw && structuredOutput === undefined) {
      emitProgress({
        kind: "session_completed",
        partialRaw: streamedRaw,
        partialChars: streamedRaw.length,
      })
      trace({ kind: "session_completed", partChars: streamedRaw.length })
      await traceWrite
      return {
        rootSessionID,
        sessionID,
        raw: streamedRaw,
        structured: structuredOutput,
        requestedModel: route?.requestedModel ?? input.model,
        selectedModel,
        routing: route,
        resolvedModel: selectedModel,
      }
    }

    const messageFetchTimeoutMS =
      timeoutMS !== undefined ? Math.max(1_500, Math.min(8_000, Math.floor(timeoutMS / 12))) : 3_000
    let latestAssistant: AssistantMessage | undefined = assistantHasVisiblePayload(latestAssistantMessage) ? latestAssistantMessage : undefined
    if (messagesClient && !latestAssistant) {
      trace({ kind: "messages_fetch_started" })
      const deadline = Date.now() + messageFetchTimeoutMS
      while (Date.now() <= deadline && !latestAssistant) {
        const candidateSessionIDs = await pollSessionFamilyIDs()
        for (const candidateSessionID of candidateSessionIDs) {
          const messageResult = await messagesClient({ sessionID: candidateSessionID, limit: 20 }).catch(() => undefined)
          const messageList = extractMessageList(messageResult)
          const candidateAssistant = messageList ? [...messageList].reverse().find((message) => message?.info?.role === "assistant") : undefined
          if (!candidateAssistant) continue
          if (!assistantHasVisiblePayload(candidateAssistant)) continue
          if (!latestAssistant || messageTime(candidateAssistant) >= messageTime(latestAssistant)) {
            latestAssistant = candidateAssistant
          }
        }
        trace({
          kind: "messages_fetch_result",
          messageCount: latestAssistant ? 1 : 0,
          hasAssistant: !!latestAssistant,
          role: latestAssistant?.info?.role ? String(latestAssistant.info.role) : undefined,
        })
        if (latestAssistant) break
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
    const responseInfo = latestAssistant?.info
    const responseText = assistantResponseText(latestAssistant)
    if (responseInfo?.structured !== undefined) structuredOutput = responseInfo.structured

    const raw = responseText || streamedRaw
    if (!raw && structuredOutput === undefined) {
      throw new SessionError("Harness session produced no assistant text or structured output.", {
        lane: input.lane,
        model: route?.selectedModel ?? input.model,
        sessionID,
      })
    }
    emitProgress({
      kind: "session_completed",
      partialRaw: raw || undefined,
      partialChars: raw.length || undefined,
    })
    trace({ kind: "session_completed", partChars: raw.length || undefined })
    await traceWrite
    return {
      rootSessionID,
      sessionID,
      raw: raw || JSON.stringify(structuredOutput, null, 2),
      structured: structuredOutput,
      requestedModel: route?.requestedModel ?? input.model,
      selectedModel,
      routing: route,
      resolvedModel:
        responseInfo?.model?.providerID && responseInfo?.model?.modelID
          ? `${responseInfo.model.providerID}/${responseInfo.model.modelID}`
          : selectedModel,
    }
  } catch (error) {
    throw error
  } finally {
    clearAllTimers()
    await traceWrite
    if (chromeInstance && chromeInstance.status === 'acquired') {
      try {
        await chromePool.release(chromeInstance.id)
        trace({ kind: "chrome_instance_released", instanceId: chromeInstance.id })
      } catch (releaseError) {
        trace({
          kind: "chrome_instance_release_failed",
          instanceId: chromeInstance.id,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        })
      }
    }
    delete process.env.OPENCODE_CHROME_DEVTOOLS_URL
    if (completionHandle) clearTimeout(completionHandle)
    if (timeoutHandle) clearTimeout(timeoutHandle)
    if (stallHandle) clearTimeout(stallHandle)
    if (messagesPollHandle) clearInterval(messagesPollHandle)
    if (promptModule && resultTapID) {
      promptModule.SessionPrompt.unregisterHarnessResultTap(resultTapID)
    }
    try {
      await events?.stream.return?.(undefined)
    } catch {}
  }
  })
}
