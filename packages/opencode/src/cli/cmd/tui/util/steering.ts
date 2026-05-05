import { deriveOperatorDigest } from "./orchestration"

type MessageLike = {
  role?: string
  error?: unknown
  time?: {
    completed?: number
    [key: string]: unknown
  }
}

type QueueLabelInput = {
  isQueued: boolean
  isLatestUserMessage: boolean
  statusType?: string
  hasPendingAssistant: boolean
}

type PromptSubmitPolicy = {
  async: boolean
  steer: boolean
  label: "send" | "steer"
}

export function hasPendingAssistantMessage(messages: MessageLike[]) {
  return messages.some((message) => message.role === "assistant" && !message.time?.completed && !message.error)
}

export function shouldSteerPrompt(statusType: string | undefined, hasPendingAssistant: boolean) {
  return statusType !== "idle" || hasPendingAssistant
}

export function promptSubmitPolicy(
  statusType: string | undefined,
  hasPendingAssistant: boolean,
  options?: {
    pendingInboxCount?: number
    pendingSupervisorCount?: number
    steerPending?: number
  },
): PromptSubmitPolicy {
  const digest = deriveOperatorDigest({
    pendingInboxCount:
      (options?.pendingInboxCount ?? 0) + (options?.pendingSupervisorCount ?? 0),
    steerPending: options?.steerPending ?? 0,
    ingressQueued: 0,
    ingressRunning: 0,
    mainRunning: hasPendingAssistant ? 1 : 0,
    sessionStatusType: statusType,
    hasPendingAssistant,
    orchestratorRunning: 0,
    adversarialRunning: 0,
    workerRunning: 0,
    actionableUpdateCount: 0,
    mainConcurrency: 1,
  })
  const steer = digest.submitMode === "steer"
  return {
    async: steer,
    steer,
    label: digest.submitMode,
  }
}

export function describeInterruptability(
  interruptability: "idle" | "ready" | "boundary",
  armed: boolean,
) {
  if (interruptability === "idle") return "idle"
  if (interruptability === "ready") return armed ? "again to interrupt" : "interrupt ready"
  return armed ? "again to interrupt" : "interrupt after boundary"
}

export function getQueuedUserMessageLabel(input: QueueLabelInput) {
  if (!input.isQueued) return undefined
  if (input.isLatestUserMessage && shouldSteerPrompt(input.statusType, input.hasPendingAssistant)) {
    return "STEERING"
  }
  return "QUEUED"
}
