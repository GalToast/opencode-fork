import { Token } from "../util/token"
import type { Provider } from "../provider/provider"
import { ProviderTransform } from "../provider/transform"

export type PromptEconomicsInput = {
  input: number
  cache: {
    read: number
    write: number
  }
}

export type SavingsBand = "low" | "moderate" | "high" | "extreme"
export type PressureBand = "cool" | "warm" | "hot" | "overflow"

export type PromptEconomics = {
  promptFootprint: number
  cacheableTokens: number
  volatileTokens: number
  cacheWriteTokens: number
  cacheableShare: number
  savingsBand: SavingsBand
  usableTokens?: number
  pressureRatio?: number
  pressureBand?: PressureBand
}

export type PromptProfileBucket = {
  name: string
  estimatedTokens: number
  share: number
}

export type PromptProfile = {
  totalEstimatedTokens: number
  usableTokens?: number
  pressureRatio?: number
  pressureBand?: PressureBand
  buckets: PromptProfileBucket[]
}

type HistoryProfileMessage = {
  info: {
    role: string
    error?: unknown
  }
  parts: Array<{
    type: string
    synthetic?: boolean
    ignored?: boolean
    text?: string
    mime?: string
    filename?: string
    url?: string
    source?: unknown
    prompt?: string
    description?: string
    agent?: string
    command?: string
    name?: string
    tool?: string
    error?: unknown
    attempt?: number
    reason?: string
    snapshot?: string
    overflow?: boolean
    parts?: unknown[]
    state?: {
      status?: string
      input?: unknown
      output?: unknown
      error?: unknown
      attachments?: unknown[]
      time?: {
        compacted?: boolean
      }
    }
  }>
}

export function usablePromptBudget(model: Provider.Model) {
  const limit = model.limit.input || model.limit.context
  if (limit === 0) return 0
  return Math.max(limit - ProviderTransform.maxOutputTokens(model), 0)
}

function estimateSerializedTokens(input: unknown): number {
  if (typeof input === "string") return Token.estimate(input)
  if (typeof input === "number" || typeof input === "boolean") return estimateSerializedTokens(String(input))
  if (input == null) return 0
  if (Array.isArray(input)) return input.reduce((total, item) => total + estimateSerializedTokens(item), 0)
  if (typeof input === "object") {
    return Object.entries(input as Record<string, unknown>).reduce(
      (total, [key, value]) => total + estimateSerializedTokens(key) + estimateSerializedTokens(value),
      0,
    )
  }
  return 0
}

function savingsBandFromShare(share: number): SavingsBand {
  if (share >= 0.75) return "extreme"
  if (share >= 0.5) return "high"
  if (share >= 0.25) return "moderate"
  return "low"
}

function pressureBandFromRatio(ratio: number): PressureBand {
  if (ratio >= 1) return "overflow"
  if (ratio >= 0.85) return "hot"
  if (ratio >= 0.7) return "warm"
  return "cool"
}

function profileValue(input: unknown): string {
  if (typeof input === "string") return input
  if (typeof input === "number" || typeof input === "boolean" || input == null) return String(input)
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

function summarizeAssistantError(error: unknown) {
  if (!error || typeof error !== "object") return profileValue(error)
  const data = error as {
    name?: unknown
    data?: {
      message?: unknown
    }
  }
  const name = typeof data.name === "string" ? data.name : "Error"
  const message = typeof data.data?.message === "string" ? `: ${data.data.message}` : ""
  return `[Previous assistant attempt ended with ${name}${message}]`
}

function summarizeSyntheticPart(part: HistoryProfileMessage["parts"][number]) {
  switch (part.type) {
    case "compaction":
      return [
        part.synthetic ? "Synthetic compaction checkpoint" : "Compaction checkpoint",
        "Continue from retained context.",
        part.overflow ? "Triggered by overflow." : undefined,
      ]
        .filter((line): line is string => typeof line === "string" && line.length > 0)
        .join("\n")
    case "subtask":
      return [
        "Subtask checkpoint",
        part.description ? `Description: ${part.description}` : undefined,
        part.agent ? `Agent: ${part.agent}` : undefined,
        part.command ? `Command: ${part.command}` : undefined,
        part.prompt ? `Prompt: ${part.prompt}` : undefined,
        Array.isArray(part.parts) ? `Context parts: ${part.parts.length}` : undefined,
      ]
        .filter((line): line is string => typeof line === "string" && line.length > 0)
        .join("\n")
    case "agent":
      return [
        "Agent checkpoint",
        part.name ? `Name: ${part.name}` : undefined,
        part.source ? `Source: ${profileValue(part.source)}` : undefined,
      ]
        .filter((line): line is string => typeof line === "string" && line.length > 0)
        .join("\n")
    case "retry":
      return [
        "Retry checkpoint",
        part.attempt !== undefined ? `Attempt: ${part.attempt}` : undefined,
        part.error !== undefined ? `Error: ${profileValue(part.error)}` : undefined,
      ]
        .filter((line): line is string => typeof line === "string" && line.length > 0)
        .join("\n")
    case "step-start":
      return [`Step start`, part.snapshot ? `Snapshot: ${part.snapshot}` : undefined]
        .filter((line): line is string => typeof line === "string" && line.length > 0)
        .join("\n")
    case "step-finish":
      return [
        "Step finish",
        part.reason ? `Reason: ${part.reason}` : undefined,
        part.snapshot ? `Snapshot: ${part.snapshot}` : undefined,
      ]
        .filter((line): line is string => typeof line === "string" && line.length > 0)
        .join("\n")
    default:
      return profileValue(part)
  }
}

export function historyProfileBuckets(messages: HistoryProfileMessage[]) {
  const buckets = {
    historyUserText: [] as string[],
    historyUserAttachments: [] as string[],
    historyAssistantText: [] as string[],
    historyAssistantReasoning: [] as string[],
    historyToolInputs: [] as string[],
    historyToolOutputs: [] as string[],
    historySyntheticParts: [] as string[],
  }

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "text") {
        if (part.ignored) continue
        if (part.synthetic) {
          buckets.historySyntheticParts.push(profileValue(part.text ?? ""))
        } else if (message.info.role === "user") {
          buckets.historyUserText.push(profileValue(part.text ?? ""))
        } else if (message.info.role === "assistant") {
          buckets.historyAssistantText.push(profileValue(part.text ?? ""))
        } else {
          buckets.historySyntheticParts.push(profileValue(part.text ?? ""))
        }
        continue
      }

      if (part.type === "reasoning" && message.info.role === "assistant") {
        buckets.historyAssistantReasoning.push(profileValue(part.text ?? ""))
        continue
      }

      if (part.type === "tool" && message.info.role === "assistant") {
        buckets.historyToolInputs.push(
          profileValue({
            tool: part.tool ?? "tool",
            input: part.state?.input,
          }),
        )
        if (part.state?.status === "completed") {
          buckets.historyToolOutputs.push(
            profileValue(part.state.time?.compacted ? "[Old tool result content cleared]" : part.state.output),
          )
        } else if (part.state?.status === "error") {
          buckets.historyToolOutputs.push(profileValue(part.state.error))
        } else {
          buckets.historyToolOutputs.push("[Tool execution was interrupted]")
        }
        continue
      }

      if (part.type === "file" && message.info.role === "user") {
        if (!part.mime) continue
        if (part.mime.startsWith("image/") || part.mime === "application/pdf") {
          buckets.historyUserAttachments.push(`[Attached ${part.mime}: ${part.filename ?? "file"}]`)
        } else if (part.mime !== "text/plain" && part.mime !== "application/x-directory") {
          buckets.historyUserAttachments.push(
            profileValue({
              mime: part.mime,
              filename: part.filename,
              url: part.url,
              source: part.source,
            }),
          )
        }
        continue
      }

      if (part.synthetic) {
        buckets.historySyntheticParts.push(summarizeSyntheticPart(part))
        continue
      }

      if (part.type === "file") {
        buckets.historySyntheticParts.push(
          profileValue({
            mime: part.mime,
            filename: part.filename,
            url: part.url,
            source: part.source,
          }),
        )
        continue
      }

      buckets.historySyntheticParts.push(summarizeSyntheticPart(part))
    }

    if (message.info.role === "assistant" && message.info.error) {
      buckets.historyAssistantText.push(summarizeAssistantError(message.info.error))
    }
  }

  return buckets
}

export function promptFootprint(tokens: PromptEconomicsInput) {
  return tokens.input + tokens.cache.read + tokens.cache.write
}

export function promptEconomics(tokens: PromptEconomicsInput, usableTokens?: number): PromptEconomics {
  const promptFootprintTokens = promptFootprint(tokens)
  const cacheableTokens = tokens.cache.read
  const volatileTokens = Math.max(promptFootprintTokens - cacheableTokens, 0)
  const cacheableShare = promptFootprintTokens > 0 ? cacheableTokens / promptFootprintTokens : 0
  const pressureRatio = usableTokens && usableTokens > 0 ? promptFootprintTokens / usableTokens : undefined

  return {
    promptFootprint: promptFootprintTokens,
    cacheableTokens,
    volatileTokens,
    cacheWriteTokens: tokens.cache.write,
    cacheableShare,
    savingsBand: savingsBandFromShare(cacheableShare),
    usableTokens,
    pressureRatio,
    pressureBand: pressureRatio !== undefined ? pressureBandFromRatio(pressureRatio) : undefined,
  }
}

export function promptProfile(
  buckets: Record<string, unknown>,
  usableTokens?: number,
): PromptProfile {
  const entries = Object.entries(buckets)
    .map(([name, value]) => ({
      name,
      estimatedTokens: estimateSerializedTokens(value),
    }))
    .filter((entry) => entry.estimatedTokens > 0)
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens || a.name.localeCompare(b.name))

  const totalEstimatedTokens = entries.reduce((total, entry) => total + entry.estimatedTokens, 0)
  const pressureRatio = usableTokens && usableTokens > 0 ? totalEstimatedTokens / usableTokens : undefined

  return {
    totalEstimatedTokens,
    usableTokens,
    pressureRatio,
    pressureBand: pressureRatio !== undefined ? pressureBandFromRatio(pressureRatio) : undefined,
    buckets: entries.map((entry) => ({
      ...entry,
      share: totalEstimatedTokens > 0 ? entry.estimatedTokens / totalEstimatedTokens : 0,
    })),
  }
}
