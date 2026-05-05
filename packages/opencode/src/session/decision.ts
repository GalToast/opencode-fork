import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import z from "zod"

const maxDecisions = 24
const maxEvents = 48
const emptySummary = "No decisions captured yet."

const DecisionStatus = z.enum(["active", "superseded"]).meta({
  ref: "SessionDecisionStatus",
})
export type DecisionStatus = z.infer<typeof DecisionStatus>

const DecisionSchema = z
  .object({
    id: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    decision: z.string(),
    rationale: z.string(),
    alternativesRejected: z.array(z.string()),
    scope: z.string(),
    invalidationCondition: z.string().optional(),
    status: DecisionStatus,
    supersededByDecisionID: Identifier.schema("part").optional(),
    latestSummary: z.string(),
  })
  .meta({
    ref: "SessionDecisionRecord",
  })
export type Decision = z.infer<typeof DecisionSchema>

const EventSchema = z
  .object({
    id: Identifier.schema("part"),
    decisionID: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    at: z.number(),
    action: z.enum(["recorded", "superseded"]),
    summary: z.string(),
  })
  .meta({
    ref: "SessionDecisionEvent",
  })
export type DecisionEvent = z.infer<typeof EventSchema>

const InfoSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    createdAt: z.number(),
    updatedAt: z.number(),
    latestSessionID: Identifier.schema("session"),
    latestMessageID: Identifier.schema("message").optional(),
    latestSummary: z.string(),
    decisions: z.array(DecisionSchema),
    events: z.array(EventSchema),
  })
  .meta({
    ref: "SessionDecision",
  })
export type Info = z.infer<typeof InfoSchema>

const BlockSchema = z
  .object({
    type: z.literal("text"),
    title: z.string(),
    text: z.string(),
  })
  .meta({
    ref: "SessionDecisionBlock",
  })
export type Block = z.infer<typeof BlockSchema>

const MaterializedSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    blocks: z.array(BlockSchema),
    text: z.string(),
  })
  .meta({
    ref: "SessionDecisionMaterialized",
  })
export type Materialized = z.infer<typeof MaterializedSchema>

const Event = {
  Updated: BusEvent.define(
    "session.decision.updated",
    z.object({
      info: InfoSchema,
    }),
  ),
}

function key(rootSessionID: string) {
  return ["session_decision", rootSessionID]
}

function trimLog<T>(items: T[], limit: number) {
  return items.slice(Math.max(0, items.length - limit))
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function summarize(info: Pick<Info, "decisions">) {
  const active = info.decisions.filter((item) => item.status === "active")
  const superseded = info.decisions.filter((item) => item.status === "superseded")
  const pieces = [
    active.length > 0 ? `active_decisions=${active.length}` : undefined,
    superseded.length > 0 ? `superseded=${superseded.length}` : undefined,
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
    decisions: [],
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

function decisionSummary(input: Pick<Decision, "decision" | "scope" | "status">) {
  return `${input.decision} | scope=${input.scope} | status=${input.status}`
}

export async function get(rootSessionID: string) {
  return Storage.read<Info>(key(rootSessionID)).catch((error) => {
    if (Storage.NotFoundError.isInstance(error)) return undefined
    throw error
  })
}

export async function recordDecision(input: {
  rootSessionID: string
  sessionID: string
  messageID?: string
  at?: number
  decision: string
  rationale: string
  alternativesRejected?: string[]
  scope: string
  invalidationCondition?: string
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const record: Decision = {
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    createdAt: at,
    updatedAt: at,
    decision: normalizeText(input.decision),
    rationale: normalizeText(input.rationale),
    alternativesRejected: (input.alternativesRejected ?? []).map(normalizeText).filter(Boolean),
    scope: normalizeText(input.scope),
    invalidationCondition: input.invalidationCondition ? normalizeText(input.invalidationCondition) : undefined,
    status: "active",
    supersededByDecisionID: undefined,
    latestSummary: "",
  }
  record.latestSummary = decisionSummary(record)
  const decisions = trimLog([...current.decisions, record].sort((a, b) => a.updatedAt - b.updatedAt), maxDecisions)
  const event: DecisionEvent = {
    id: Identifier.ascending("part"),
    decisionID: record.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    action: "recorded",
    summary: record.latestSummary,
  }
  return write({
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    latestSummary: summarize({ decisions }),
    decisions,
    events: trimLog([...current.events, event], maxEvents),
  })
}

export async function supersedeDecision(input: {
  rootSessionID: string
  sessionID: string
  decisionID: string
  supersededByDecisionID?: string
  messageID?: string
  at?: number
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const existing = current.decisions.find((item) => item.id === input.decisionID)
  if (!existing) return current
  const record: Decision = {
    ...existing,
    sessionID: input.sessionID,
    messageID: input.messageID ?? existing.messageID,
    updatedAt: at,
    status: "superseded",
    supersededByDecisionID: input.supersededByDecisionID ?? existing.supersededByDecisionID,
    latestSummary: decisionSummary({
      decision: existing.decision,
      scope: existing.scope,
      status: "superseded",
    }),
  }
  const decisions = trimLog(
    [...current.decisions.filter((item) => item.id !== record.id), record].sort((a, b) => a.updatedAt - b.updatedAt),
    maxDecisions,
  )
  const event: DecisionEvent = {
    id: Identifier.ascending("part"),
    decisionID: record.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    action: "superseded",
    summary: record.latestSummary,
  }
  return write({
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    latestSummary: summarize({ decisions }),
    decisions,
    events: trimLog([...current.events, event], maxEvents),
  })
}

export function digest(input: { info: Info; limit?: number; includeSuperseded?: boolean }): Materialized | undefined {
  const limit = Math.max(1, input.limit ?? 3)
  const active = input.info.decisions
    .filter((item) => item.status === "active")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
  const superseded = input.includeSuperseded
    ? input.info.decisions
        .filter((item) => item.status === "superseded")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
    : []

  const blocks: Block[] = []
  const activeBlock = block(
    "Active decisions",
    active.map((item) =>
      [
        `- decision=${item.decision}`,
        `rationale=${item.rationale}`,
        `scope=${item.scope}`,
        item.alternativesRejected.length > 0 ? `rejected=${item.alternativesRejected.join("; ")}` : undefined,
        item.invalidationCondition ? `invalidate_when=${item.invalidationCondition}` : undefined,
      ]
        .filter((line): line is string => !!line)
        .join(" | "),
    ),
  )
  if (activeBlock) blocks.push(activeBlock)

  const supersededBlock = input.includeSuperseded
    ? block(
        "Recently superseded decisions",
        superseded.map((item) => `- decision=${item.decision} | scope=${item.scope}`),
      )
    : undefined
  if (supersededBlock) blocks.push(supersededBlock)

  const summaryBlock = block("Latest summary", [input.info.latestSummary !== emptySummary ? input.info.latestSummary : undefined])
  if (summaryBlock) blocks.push(summaryBlock)

  if (blocks.length === 0) return undefined
  return {
    rootSessionID: input.info.rootSessionID,
    blocks,
    text: blocks.map((item) => `## ${item.title}\n${item.text}`).join("\n\n"),
  }
}

export async function materialize(input: { rootSessionID: string; limit?: number; includeSuperseded?: boolean }) {
  const info = await get(input.rootSessionID)
  if (!info) return undefined
  return digest({
    info,
    limit: input.limit,
    includeSuperseded: input.includeSuperseded,
  })
}

export const SessionDecision = {
  DecisionStatus,
  Decision: DecisionSchema,
  Event: EventSchema,
  Info: InfoSchema,
  Block: BlockSchema,
  Materialized: MaterializedSchema,
  UpdatedEvent: Event.Updated,
  get,
  recordDecision,
  supersedeDecision,
  digest,
  materialize,
}
