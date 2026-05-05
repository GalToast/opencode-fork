import { submittedPreviewLabel, type SubmittedPreviewState } from "./prompt-submit"

export type PromptStatusSurfaceInput = {
  statusType?: string
  pendingInboxCount: number
  steerPending: number
  steerStage?: "received" | "applied"
  hasPendingAssistant: boolean
  submitLabel: "send" | "steer"
  submittedPreview?: {
    mode: "normal" | "shell"
    state: SubmittedPreviewState
  }
  pendingPermissionCount?: number
  pendingQuestionCount?: number
  pendingSupervisorCount?: number
  contextPercent?: number
  childCount?: number
  isChildSession?: boolean
  showIdleNarrative?: boolean
}

export type PromptStatusSurface = {
  visible: boolean
  label: string
  actionLabel?: string
  tone: "muted" | "primary" | "warning" | "success"
  showSpinner: boolean
  detail?: string
  blockerCount?: number
}

function blockerText(input: PromptStatusSurfaceInput): string {
  const permissionCount = input.pendingPermissionCount ?? 0
  const questionCount = input.pendingQuestionCount ?? 0
  const supervisorCount = input.pendingSupervisorCount ?? 0

  const bits = []
  if (permissionCount > 0)
    bits.push(`${permissionCount} permission request${permissionCount === 1 ? "" : "s"}`)
  if (questionCount > 0) bits.push(`${questionCount} question${questionCount === 1 ? "" : "s"}`)
  if (supervisorCount > 0)
    bits.push(`${supervisorCount} supervisor request${supervisorCount === 1 ? "" : "s"}`)

  if (bits.length === 0) return "operator block"
  if (bits.length === 1) return bits[0]
  if (bits.length === 2) return `${bits[0]} and ${bits[1]}`
  return `${bits.slice(0, -1).join(", ")}, and ${bits[bits.length - 1]}`
}

function summarizeInputPressure(input: PromptStatusSurfaceInput): string {
  if (!input.isChildSession) {
    const childCount = input.childCount ?? 0
    if (childCount > 0) return `${childCount} subagent lanes`
    return "main deck"
  }

  return "nested lane"
}

function summarizeContext(input: PromptStatusSurfaceInput): string {
  const contextPercent = input.contextPercent
  if (contextPercent === undefined) return summarizeInputPressure(input)
  const pressure = contextPercent >= 90 ? "hot" : contextPercent >= 70 ? "warm" : "cool"
  return `${pressure} context ${contextPercent}%`
}

function deriveSharedPromptSurface(input: PromptStatusSurfaceInput): PromptStatusSurface {
  if (input.statusType === "retry") {
    return {
      visible: true,
      label: "Retry protocol active",
      detail: "Backoff sequence stabilizing context",
      tone: "warning",
      showSpinner: false,
      actionLabel: "resolve blocker",
    }
  }

  if (input.pendingInboxCount > 0) {
    const blockerSummary = blockerText(input)
    const blockerPrefix = `${input.pendingInboxCount} blocker${
      input.pendingInboxCount === 1 ? "" : "s"
    } ${input.pendingInboxCount === 1 ? "is" : "are"} pending`
    return {
      visible: true,
      label: "Waiting on operator input",
      detail:
        blockerSummary === "operator block"
          ? blockerPrefix
          : `${blockerPrefix}: ${blockerSummary}`,
      actionLabel: "resolve blocker",
      tone: "warning",
      showSpinner: false,
      blockerCount: input.pendingInboxCount,
    }
  }

  if (input.submittedPreview) {
    const ignitionDetail =
      input.submittedPreview.mode === "shell"
        ? `Command lane warming through the bay; ${summarizeContext(input)}`
        : `Intent uplink crossing the ignition rail; ${summarizeContext(input)}`
    return {
      visible: true,
      label: submittedPreviewLabel(input.submittedPreview),
      detail: ignitionDetail,
      actionLabel: input.submitLabel,
      tone: "primary",
      showSpinner: true,
      blockerCount: input.pendingInboxCount,
    }
  }

  if (input.steerStage === "applied") {
    return {
      visible: true,
      label: "Merging steer update",
      detail: `Swarm sync in progress; ${summarizeInputPressure(input)}`,
      actionLabel: "steer",
      tone: "success",
      showSpinner: true,
      blockerCount: input.pendingInboxCount,
    }
  }

  if (input.steerPending > 0) {
    return {
      visible: true,
      label: "Steering current reply",
      detail: `Steer queue ${input.steerPending}; ${summarizeInputPressure(input)}`,
      actionLabel: "steer",
      tone: "primary",
      showSpinner: true,
      blockerCount: input.pendingInboxCount,
    }
  }

  if (input.statusType === "queued") {
    return {
      visible: true,
      label: "Prompt queued",
      detail: `Queued for dispatch; ${summarizeInputPressure(input)}`,
      actionLabel: input.submitLabel,
      tone: "primary",
      showSpinner: false,
      blockerCount: input.pendingInboxCount,
    }
  }

  if (input.hasPendingAssistant || input.statusType === "busy") {
    return {
      visible: true,
      label: input.submitLabel === "steer" ? "Agent is responding" : "Dispatching current lane",
      detail: `Live exchange active; ${summarizeContext(input)}`,
      actionLabel: input.submitLabel,
      tone: "primary",
      showSpinner: true,
      blockerCount: input.pendingInboxCount,
    }
  }

  if (input.showIdleNarrative) {
    if (input.isChildSession) {
      return {
        visible: true,
        label: "Branch hold",
        detail: `Nested lane listening; ${summarizeContext(input)}`,
        actionLabel: input.submitLabel,
        tone: "muted",
        showSpinner: false,
        blockerCount: input.pendingInboxCount,
      }
    }

    return {
      visible: true,
      label: "Central body",
      detail: `Main lane listening; ${summarizeContext(input)}`,
      actionLabel: input.submitLabel,
      tone: "primary",
      showSpinner: false,
      blockerCount: input.pendingInboxCount,
    }
  }

  return {
    visible: false,
    label: "",
    tone: "muted",
    showSpinner: false,
    detail: summarizeInputPressure(input),
    blockerCount: input.pendingInboxCount,
  }
}

export function derivePromptStatusSurface(input: PromptStatusSurfaceInput): PromptStatusSurface {
  return deriveSharedPromptSurface(input)
}

export function deriveSessionForegroundSurface(
  input: PromptStatusSurfaceInput,
): PromptStatusSurface {
  return deriveSharedPromptSurface(input)
}
