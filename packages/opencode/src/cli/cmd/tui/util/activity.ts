import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { SessionState } from "../component/status-indicator"
import { hasPendingAssistantMessage } from "./steering"

type Status = {
  type?: string
} | undefined

type Msg = {
  id: string
  role: "user" | "assistant"
  error?: unknown
  time: { created: number; completed?: number }
  finish?: string | null
}

type ToolPart = Pick<Part, "type"> & {
  state?: {
    status?: string
  } | null
}

const LOOKBACK = 6

function activeTool(msg: Msg | undefined, parts: ToolPart[] | undefined) {
  if (!msg || msg.role !== "assistant" || msg.error) return false
  if (!parts?.length) return false
  return parts.some((part) => {
    if (part.type !== "tool") return false
    return part.state?.status === "pending" || part.state?.status === "running"
  })
}

export function hasToolLoop(messages: Msg[], parts: Record<string, ToolPart[] | undefined>, lookback = LOOKBACK) {
  for (const msg of messages.slice(-lookback).toReversed()) {
    if (activeTool(msg, parts[msg.id])) return true
  }
  return false
}

export function deriveSessionStatusType(input: {
  status: Status
  messages: Msg[]
  parts: Record<string, ToolPart[] | undefined>
}) {
  if (input.status?.type === "retry") return "retry" as const
  if (input.status?.type === "busy") return "busy" as const
  if (hasPendingAssistantMessage(input.messages)) return "busy" as const
  if (hasToolLoop(input.messages, input.parts)) return "busy" as const
  return "idle" as const
}

export function deriveSessionState(input: {
  status: Status
  messages: Msg[]
  parts: Record<string, ToolPart[] | undefined>
}): SessionState {
  const status = deriveSessionStatusType(input)
  if (status === "retry") return "error"
  if (status === "busy") return "active"
  return "idle"
}
