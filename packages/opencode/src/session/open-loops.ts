import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import z from "zod"

const maxLoops = 24
const maxEvents = 48
const emptySummary = "No open loops captured yet."

const LoopStatus = z.enum(["open", "blocked", "resolved"]).meta({
  ref: "SessionOpenLoopStatus",
})
export type LoopStatus = z.infer<typeof LoopStatus>

const LoopSchema = z
  .object({
    id: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    summary: z.string(),
    latestSummary: z.string(),
    status: LoopStatus,
    ownerSessionID: Identifier.schema("session"),
    verificationRequired: z.boolean(),
    blockerReason: z.string().optional(),
    resolvedAt: z.number().optional(),
  })
  .meta({
    ref: "SessionOpenLoop",
  })
export type Loop = z.infer<typeof LoopSchema>

const EventSchema = z
  .object({
    id: Identifier.schema("part"),
    loopID: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    at: z.number(),
    action: z.enum(["opened", "updated", "resolved", "reopened"]),
    summary: z.string(),
  })
  .meta({
    ref: "SessionOpenLoopEvent",
  })
export type LoopEvent = z.infer<typeof EventSchema>

const InfoSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    createdAt: z.number(),
    updatedAt: z.number(),
    latestSessionID: Identifier.schema("session"),
    latestMessageID: Identifier.schema("message").optional(),
    latestSummary: z.string(),
    loops: z.array(LoopSchema),
    events: z.array(EventSchema),
  })
  .meta({
    ref: "SessionOpenLoops",
  })
export type Info = z.infer<typeof InfoSchema>

const BlockSchema = z
  .object({
    type: z.literal("text"),
    title: z.string(),
    text: z.string(),
  })
  .meta({
    ref: "SessionOpenLoopsBlock",
  })
export type Block = z.infer<typeof BlockSchema>

const MaterializedSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    blocks: z.array(BlockSchema),
    text: z.string(),
  })
  .meta({
    ref: "SessionOpenLoopsMaterialized",
  })
export type Materialized = z.infer<typeof MaterializedSchema>

const Event = {
  Updated: BusEvent.define(
    "session.open-loops.updated",
    z.object({
      info: InfoSchema,
    }),
  ),
}

function key(rootSessionID: string) {
  return ["session_open_loops", rootSessionID]
}

function trimLog<T>(items: T[], limit: number) {
  return items.slice(Math.max(0, items.length - limit))
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function normalizeKey(value: string) {
  return normalizeText(value).toLowerCase()
}

function summarize(info: Pick<Info, "loops">) {
  const unresolved = info.loops.filter((loop) => loop.status !== "resolved")
  const resolved = info.loops.filter((loop) => loop.status === "resolved")
  const blocked = unresolved.filter((loop) => loop.status === "blocked")
  const verificationRequired = unresolved.filter((loop) => loop.verificationRequired)
  const pieces = [
    unresolved.length > 0 ? `open_loops=${unresolved.length}` : undefined,
    blocked.length > 0 ? `blocked=${blocked.length}` : undefined,
    verificationRequired.length > 0 ? `verify=${verificationRequired.length}` : undefined,
    resolved.length > 0 ? `resolved=${resolved.length}` : undefined,
  ].filter((item): item is string => !!item)
  return pieces.length > 0 ? pieces.join(" | ") : emptySummary
}

function fallback(input: { rootSessionID: string; sessionID: string; at: number; messageID?: string }): Info {
  return {
    rootSessionID: input.rootSessionID,
    createdAt: input.at,
    updatedAt: input.at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID,
    latestSummary: emptySummary,
    loops: [],
    events: [],
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

function nextActionForStatus(status: LoopStatus): LoopEvent["action"] {
  return status === "resolved" ? "resolved" : "opened"
}

export async function get(rootSessionID: string) {
  return Storage.read<Info>(key(rootSessionID)).catch((error) => {
    if (Storage.NotFoundError.isInstance(error)) return undefined
    throw error
  })
}

export async function recordLoop(input: {
  rootSessionID: string
  sessionID: string
  loopID?: string
  messageID?: string
  at?: number
  summary: string
  status?: Exclude<LoopStatus, "resolved">
  verificationRequired?: boolean
  blockerReason?: string
  ownerSessionID?: string
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const summary = normalizeText(input.summary)
  const existing =
    (input.loopID ? current.loops.find((loop) => loop.id === input.loopID) : undefined) ??
    current.loops.find((loop) => normalizeKey(loop.summary) === normalizeKey(summary))
  const status = input.status ?? (input.blockerReason ? "blocked" : "open")
  const loop: Loop = {
    id: input.loopID ?? existing?.id ?? Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID ?? existing?.messageID,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    summary,
    latestSummary: summary,
    status,
    ownerSessionID: input.ownerSessionID ?? existing?.ownerSessionID ?? input.sessionID,
    verificationRequired: input.verificationRequired ?? existing?.verificationRequired ?? false,
    blockerReason: input.blockerReason?.trim() || existing?.blockerReason,
    resolvedAt: undefined,
  }
  const loops = trimLog(
    [...current.loops.filter((item) => item.id !== loop.id && normalizeKey(item.summary) !== normalizeKey(summary)), loop].sort(
      (a, b) => a.updatedAt - b.updatedAt,
    ),
    maxLoops,
  )
  const event: LoopEvent = {
    id: Identifier.ascending("part"),
    loopID: loop.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    action: existing ? "updated" : nextActionForStatus(loop.status),
    summary: loop.latestSummary,
  }
  return write({
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    latestSummary: summarize({ loops }),
    loops,
    events: trimLog([...current.events, event], maxEvents),
  })
}

export async function resolveLoop(input: {
  rootSessionID: string
  sessionID: string
  loopID: string
  messageID?: string
  at?: number
  summary?: string
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const existing = current.loops.find((loop) => loop.id === input.loopID)
  if (!existing) return current
  const loop: Loop = {
    ...existing,
    sessionID: input.sessionID,
    messageID: input.messageID ?? existing.messageID,
    updatedAt: at,
    status: "resolved",
    latestSummary: normalizeText(input.summary ?? existing.latestSummary),
    blockerReason: undefined,
    resolvedAt: at,
  }
  const loops = trimLog(
    [...current.loops.filter((item) => item.id !== loop.id), loop].sort((a, b) => a.updatedAt - b.updatedAt),
    maxLoops,
  )
  const event: LoopEvent = {
    id: Identifier.ascending("part"),
    loopID: loop.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    action: "resolved",
    summary: loop.latestSummary,
  }
  return write({
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    latestSummary: summarize({ loops }),
    loops,
    events: trimLog([...current.events, event], maxEvents),
  })
}

export async function reopenLoop(input: {
  rootSessionID: string
  sessionID: string
  loopID: string
  messageID?: string
  at?: number
  blockerReason?: string
  verificationRequired?: boolean
  summary?: string
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const existing = current.loops.find((loop) => loop.id === input.loopID)
  if (!existing) return current
  const reopenedStatus: Exclude<LoopStatus, "resolved"> = input.blockerReason ? "blocked" : "open"
  const loop: Loop = {
    ...existing,
    sessionID: input.sessionID,
    messageID: input.messageID ?? existing.messageID,
    updatedAt: at,
    status: reopenedStatus,
    latestSummary: normalizeText(input.summary ?? existing.latestSummary),
    blockerReason: input.blockerReason?.trim() || undefined,
    verificationRequired: input.verificationRequired ?? existing.verificationRequired,
    resolvedAt: undefined,
  }
  const loops = trimLog(
    [...current.loops.filter((item) => item.id !== loop.id), loop].sort((a, b) => a.updatedAt - b.updatedAt),
    maxLoops,
  )
  const event: LoopEvent = {
    id: Identifier.ascending("part"),
    loopID: loop.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    action: "reopened",
    summary: loop.latestSummary,
  }
  return write({
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    latestSummary: summarize({ loops }),
    loops,
    events: trimLog([...current.events, event], maxEvents),
  })
}

export function digest(input: { info: Info; limit?: number; includeResolved?: boolean }): Materialized | undefined {
  const limit = Math.max(1, input.limit ?? 5)
  const unresolved = input.info.loops
    .filter((loop) => loop.status !== "resolved")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
  const resolved = input.includeResolved
    ? input.info.loops
        .filter((loop) => loop.status === "resolved")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
    : []

  const blocks: Block[] = []
  const unresolvedBlock = block(
    "Unresolved loops",
    unresolved.map((loop) => {
      const bits = [`- [${loop.status}] ${loop.latestSummary}`]
      if (loop.verificationRequired) bits.push("verification required")
      if (loop.blockerReason) bits.push(`blocker=${loop.blockerReason}`)
      return bits.join(" | ")
    }),
  )
  if (unresolvedBlock) blocks.push(unresolvedBlock)

  const resolvedBlock = input.includeResolved
    ? block(
        "Recently resolved loops",
        resolved.map((loop) => `- ${loop.latestSummary}`),
      )
    : undefined
  if (resolvedBlock) blocks.push(resolvedBlock)

  const summaryBlock = block("Latest summary", [input.info.latestSummary !== emptySummary ? input.info.latestSummary : undefined])
  if (summaryBlock) blocks.push(summaryBlock)

  if (blocks.length === 0) return undefined
  return {
    rootSessionID: input.info.rootSessionID,
    blocks,
    text: blocks.map((item) => `## ${item.title}\n${item.text}`).join("\n\n"),
  }
}

export async function materialize(input: { rootSessionID: string; limit?: number; includeResolved?: boolean }) {
  const info = await get(input.rootSessionID)
  if (!info) return undefined
  return digest({
    info,
    limit: input.limit,
    includeResolved: input.includeResolved,
  })
}

export const SessionOpenLoops = {
  LoopStatus,
  Loop: LoopSchema,
  Event: EventSchema,
  Info: InfoSchema,
  Block: BlockSchema,
  Materialized: MaterializedSchema,
  UpdatedEvent: Event.Updated,
  get,
  recordLoop,
  resolveLoop,
  reopenLoop,
  digest,
  materialize,
}
