export function submitText(live: string, saved: string) {
  return live || saved
}

export function capturePromptSnapshot<TPart>(input: {
  input: string
  parts: TPart[]
  mode: "normal" | "shell"
}) {
  return {
    prompt: {
      input: input.input,
      parts: JSON.parse(JSON.stringify(input.parts)) as TPart[],
    },
    mode: input.mode,
  }
}

export function submitAsync(input: { sessionID?: string; async: boolean }) {
  return true
}

export type SubmittedPreviewState = "sending" | "creating" | "opening" | "submitting" | "queued"

export function submittedPreviewLabel(input: {
  mode: "normal" | "shell"
  state: SubmittedPreviewState
}) {
  if (input.mode === "shell") {
    if (input.state === "queued") return "Command in queue"
    return "Igniting command lane"
  }
  if (input.state === "creating") return "Igniting session body"
  if (input.state === "opening") return "Opening fresh lane"
  if (input.state === "submitting") return "Casting intent uplink"
  if (input.state === "queued") return "Intent in queue"
  return "Launching intent uplink"
}

export function shouldDismissSubmittedPreview(input: {
  currentInput: string
  submittedAt: number
  latestUserCreatedAt?: number
}) {
  if (input.currentInput.trim().length > 0) return true
  if (input.latestUserCreatedAt === undefined) return false
  return input.latestUserCreatedAt >= input.submittedAt
}

type PromptPartLike = unknown

export type SubmitFingerprint = {
  sessionID?: string
  text: string
  agent: string
  providerID: string
  modelID: string
  at: number
}

function normalizePromptText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

export function shouldAppendToStash(input: {
  current: { input: string; parts: PromptPartLike[] }
  previous?: { input: string; parts: PromptPartLike[] }
}) {
  const previous = input.previous
  if (!previous) return true
  return (
    normalizePromptText(input.current.input) !== normalizePromptText(previous.input) ||
    JSON.stringify(input.current.parts) !== JSON.stringify(previous.parts)
  )
}

export function shouldDropDuplicateSubmit(
  current: Omit<SubmitFingerprint, "at"> & { at?: number },
  previous?: SubmitFingerprint,
  options?: { now?: number; windowMS?: number },
) {
  if (!previous) return false

  const now = options?.now ?? current.at ?? Date.now()
  const windowMS = options?.windowMS ?? 1200
  if (now - previous.at > windowMS) return false

  return (
    (current.sessionID ?? "") === (previous.sessionID ?? "") &&
    normalizePromptText(current.text) === normalizePromptText(previous.text) &&
    current.agent === previous.agent &&
    current.providerID === previous.providerID &&
    current.modelID === previous.modelID
  )
}
