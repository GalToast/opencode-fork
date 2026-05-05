import { Provider } from "@/provider/provider"
import { HarnessState } from "./state"

/* eslint-disable @typescript-eslint/no-namespace */
type Model = {
  providerID?: string
  modelID?: string
  variant?: string
  agent?: string
}

type Route = {
  model: string
  variant?: string
  agent?: string
  source: "completed" | "accepted"
}

function on() {
  return process.env.OPENCODE_HARNESS_ACTIVE === "1" || process.env.OPENCODE_HARNESS_OBSERVER === "1"
}

function clip(input: string | undefined, max: number) {
  const value = input?.trim()
  if (!value) return undefined
  if (value.length <= max) return value
  return value.slice(0, Math.max(1, max - 3)).trimEnd() + "..."
}

function norm(input: string) {
  return input.replace(/\s+/g, " ").trim()
}

export function text(parts: Array<{ type: string; text?: string; synthetic?: boolean }>) {
  return parts
    .filter((part): part is { type: "text"; text: string; synthetic?: boolean } => part.type === "text" && !!part.text)
    .filter((part) => !part.synthetic)
    .map((part) => part.text)
    .join("\n")
}

export function intent(input: string, max = 96) {
  const value = norm(input)
  if (!value) return "No user intent captured yet."
  return clip(value, max) ?? "No user intent captured yet."
}

export function constraints(input: string, max = 160) {
  const value = norm(input)
  if (!value) return undefined
  const items = value
    .split(/[\n.!?]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const hits = items.filter((item) =>
    /\b(must|need to|should|avoid|don't|do not|only|without|with|keep|prefer|never|always|limit)\b/i.test(item),
  )
  const picked = (hits.length > 0 ? hits : items.slice(0, 1)).slice(0, 3).join("; ")
  if (!picked) return undefined
  return clip(picked, max)
}

export function cues(input: string) {
  const value = norm(input).toLowerCase()
  const words = value ? value.split(/\s+/).length : 0
  return {
    words,
    correction:
      /\b(wrong|incorrect|instead|actually|rather|not that|that's not|should have|meant|i said|no,|no\.)\b/i.test(
        value,
      ),
    frustration:
      /\b(fuck|fucking|damn|annoying|frustrating|broken|stuck|hanging|hang|loop|looping|crash|crashing|why are you|why is this)\b/i.test(
        value,
      ),
    ui: /\b(terminal|tui|ui|interface|prompt|popup|restart|session|conversation|chat)\b/i.test(value),
    restart: /\b(restart|relaunch|rebuild|reload)\b/i.test(value),
  }
}

function modelRef(input: Model) {
  if (!input.providerID || !input.modelID) return
  return `${input.providerID}/${input.modelID}`
}

function allowed(model: string) {
  const parsed = Provider.parseModel(model)
  if (parsed.providerID === "fixture") return true
  if (parsed.providerID.startsWith("bailian-coding-plan")) return true
  if (parsed.providerID !== "openai") return false
  return parsed.modelID.includes("codex-spark")
}

function isRootSessionObservation(item: HarnessState.Observation) {
  const rootSessionID = typeof item.data?.rootSessionID === "string" ? item.data.rootSessionID : undefined
  const sessionID = typeof item.data?.sessionID === "string" ? item.data.sessionID : undefined
  return !!rootSessionID && rootSessionID === sessionID
}

function route(item: HarnessState.Observation, source: Route["source"]) {
  if (source === "accepted" && !isRootSessionObservation(item)) return
  const model = modelRef({
    providerID: typeof item.data?.providerID === "string" ? item.data.providerID : undefined,
    modelID: typeof item.data?.modelID === "string" ? item.data.modelID : undefined,
  })
  if (!model || !allowed(model)) return
  return {
    model,
    variant: typeof item.data?.variant === "string" ? item.data.variant : undefined,
    agent: typeof item.data?.agent === "string" ? item.data.agent : undefined,
    source,
  } satisfies Route
}

function terminalRunRoute(item: HarnessState.Observation) {
  const models = Array.isArray(item.data?.models) ? item.data.models : []
  const picked = models.find((entry): entry is string => typeof entry === "string" && allowed(entry))
  if (!picked) return
  const parsed = Provider.parseModel(picked)
  return {
    model: `${parsed.providerID}/${parsed.modelID}`,
    source: "completed",
  } satisfies Route
}

export namespace HarnessExperience {
  export async function accept(input: {
    rootSessionID: string
    sessionID: string
    messageID?: string
    intent: string
    constraintsSummary?: string
    providerID?: string
    modelID?: string
    variant?: string
    agent?: string
  }) {
    if (!on()) return false
    await HarnessState.appendObservation({
      source: "runtime",
      kind: "dialog.turn_ingress",
      message: `Accepted user turn for ${input.agent ?? "unknown"} using ${modelRef(input) ?? "unknown model"}.`,
      data: {
        rootSessionID: input.rootSessionID,
        sessionID: input.sessionID,
        messageID: input.messageID,
        intent: clip(input.intent, 160),
        constraintsSummary: clip(input.constraintsSummary, 220),
        providerID: input.providerID,
        modelID: input.modelID,
        variant: input.variant,
        agent: input.agent,
        ui: true,
      },
    })
    return true
  }

  export async function steer(input: {
    rootSessionID: string
    sessionID: string
    stage: "received" | "applied"
    pending: number
    messageID?: string
    latencyMS?: number
  }) {
    if (!on()) return false
    await HarnessState.appendObservation({
      source: "runtime",
      kind: "main.steer_applied",
      message:
        input.stage === "applied"
          ? "Applied steer to the active foreground turn."
          : "Queued steer for the active foreground turn.",
      data: {
        rootSessionID: input.rootSessionID,
        sessionID: input.sessionID,
        stage: input.stage,
        pending: input.pending,
        messageID: input.messageID,
        latencyMS: input.latencyMS,
      },
    })
    return true
  }

  export async function complete(input: {
    rootSessionID: string
    sessionID: string
    messageID?: string
    providerID?: string
    modelID?: string
    variant?: string
    agent?: string
    durationMS?: number
  }) {
    if (!on()) return false
    await HarnessState.appendObservation({
      source: "runtime",
      kind: "main.turn_completed",
      message: `Completed foreground turn with ${modelRef(input) ?? "unknown model"}.`,
      data: {
        rootSessionID: input.rootSessionID,
        sessionID: input.sessionID,
        messageID: input.messageID,
        providerID: input.providerID,
        modelID: input.modelID,
        variant: input.variant,
        agent: input.agent,
        elapsedMS: input.durationMS,
        durationMS: input.durationMS,
      },
    })
    return true
  }

  export async function preferred(limit = 60) {
    const items = await HarnessState.listObservations(limit)
    for (const item of [...items].reverse()) {
      if (item.kind === "terminal.run_completed") {
        const picked = terminalRunRoute(item)
        if (picked) return picked
      }
      if (item.kind === "main.turn_completed") {
        const picked = route(item, "completed")
        if (picked) return picked
      }
      // Mirror only the main terminal conversation, not harness-internal author/reviewer sessions.
      if (item.kind === "main.prompt_ingress") {
        const picked = route(item, "accepted")
        if (picked) return picked
      }
    }
    return
  }
}
