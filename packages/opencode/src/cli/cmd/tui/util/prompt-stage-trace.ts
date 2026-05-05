import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"

export type PromptStageState = {
  sessionID: string
  messageID: string
  submittedAt: number
  dispatchAckAt?: number
  assistantMessageID?: string
  firstPartAt?: number
  firstVisibleAt?: number
  completedAt?: number
}

type PromptStageEvent = {
  stage: string
  sessionID?: string
  messageID?: string
  assistantMessageID?: string
  submittedAt?: number
  at?: number
  data?: Record<string, unknown>
}

const live = new Map<string, PromptStageState>()
const dirs = new Set<string>()
let queue = Promise.resolve()

export function promptStageTraceEnabled() {
  return process.env.OPENCODE_TUI_PROMPT_STAGE_TRACE !== "0"
}

export function promptStageTracePath(root = Global.Path.state) {
  return path.join(root, "tui", "prompt-stage-timing.jsonl")
}

export function createPromptStageRecord(input: PromptStageEvent) {
  const at = input.at ?? Date.now()
  return {
    at: new Date(at).toISOString(),
    epochMS: at,
    pid: process.pid,
    instance: process.env.OPENCODE_INSTANCE || "default",
    stage: input.stage,
    sessionID: input.sessionID,
    messageID: input.messageID,
    assistantMessageID: input.assistantMessageID,
    elapsedMS: typeof input.submittedAt === "number" ? Math.max(0, at - input.submittedAt) : undefined,
    ...(input.data ?? {}),
  }
}

export function serializePromptStageRecord(input: PromptStageEvent) {
  return JSON.stringify(createPromptStageRecord(input))
}

export function summarizePromptStageTrace(state: PromptStageState) {
  const submittedAt = state.submittedAt
  const dispatchAckMS =
    typeof state.dispatchAckAt === "number" ? Math.max(0, state.dispatchAckAt - submittedAt) : undefined
  const assistantMessageVisibleMS =
    typeof state.assistantMessageID === "string" && typeof state.dispatchAckAt === "number"
      ? dispatchAckMS
      : undefined
  const firstPartMS = typeof state.firstPartAt === "number" ? Math.max(0, state.firstPartAt - submittedAt) : undefined
  const firstVisiblePartMS =
    typeof state.firstVisibleAt === "number" ? Math.max(0, state.firstVisibleAt - submittedAt) : undefined
  const completedMS =
    typeof state.completedAt === "number" ? Math.max(0, state.completedAt - submittedAt) : undefined

  return {
    dispatchAckMS,
    assistantMessageVisibleMS,
    firstPartMS,
    firstVisiblePartMS,
    completedMS,
    dispatchToFirstPartMS:
      typeof state.dispatchAckAt === "number" && typeof state.firstPartAt === "number"
        ? Math.max(0, state.firstPartAt - state.dispatchAckAt)
        : undefined,
    dispatchToFirstVisibleMS:
      typeof state.dispatchAckAt === "number" && typeof state.firstVisibleAt === "number"
        ? Math.max(0, state.firstVisibleAt - state.dispatchAckAt)
        : undefined,
    firstPartToFirstVisibleMS:
      typeof state.firstPartAt === "number" && typeof state.firstVisibleAt === "number"
        ? Math.max(0, state.firstVisibleAt - state.firstPartAt)
        : undefined,
    firstVisibleToCompletedMS:
      typeof state.firstVisibleAt === "number" && typeof state.completedAt === "number"
        ? Math.max(0, state.completedAt - state.firstVisibleAt)
        : undefined,
    dispatchToCompletedMS:
      typeof state.dispatchAckAt === "number" && typeof state.completedAt === "number"
        ? Math.max(0, state.completedAt - state.dispatchAckAt)
        : undefined,
  }
}

export function recordPromptStage(input: PromptStageEvent) {
  if (!promptStageTraceEnabled()) return Promise.resolve()
  const file = promptStageTracePath()
  const dir = path.dirname(file)
  queue = queue
    .catch(() => undefined)
    .then(async () => {
      if (!dirs.has(dir)) {
        await fs.mkdir(dir, { recursive: true })
        dirs.add(dir)
      }
      await fs.appendFile(file, serializePromptStageRecord(input) + "\n", "utf8")
    })
  return queue
}

export function beginPromptStageTrace(input: PromptStageState) {
  live.set(input.sessionID, input)
  return input
}

export function getPromptStageTrace(sessionID?: string) {
  if (!sessionID) return undefined
  return live.get(sessionID)
}

export function updatePromptStageTrace(
  sessionID: string,
  next: Partial<PromptStageState> | ((curr: PromptStageState) => PromptStageState),
) {
  const curr = live.get(sessionID)
  if (!curr) return undefined
  const value = typeof next === "function" ? next(curr) : { ...curr, ...next }
  live.set(sessionID, value)
  return value
}

export function clearPromptStageTrace(sessionID: string) {
  live.delete(sessionID)
}
