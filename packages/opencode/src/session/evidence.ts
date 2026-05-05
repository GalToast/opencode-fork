import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import z from "zod"

const maxEvidence = 24
const maxEvents = 48
const emptySummary = "No evidence captured yet."

const Freshness = z.enum(["fresh", "recent", "stale"]).meta({
  ref: "SessionEvidenceFreshness",
})
export type Freshness = z.infer<typeof Freshness>

const EvidenceSchema = z
  .object({
    id: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    fact: z.string(),
    sourceAnchor: z.string(),
    trustBasis: z.string(),
    freshness: Freshness,
    confidence: z.number().min(0).max(1).optional(),
    supportingRefs: z.array(z.string()),
    latestSummary: z.string(),
  })
  .meta({
    ref: "SessionEvidenceRecord",
  })
export type Evidence = z.infer<typeof EvidenceSchema>

const EventSchema = z
  .object({
    id: Identifier.schema("part"),
    evidenceID: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    at: z.number(),
    action: z.enum(["recorded", "updated"]),
    summary: z.string(),
  })
  .meta({
    ref: "SessionEvidenceEvent",
  })
export type EvidenceEvent = z.infer<typeof EventSchema>

const InfoSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    createdAt: z.number(),
    updatedAt: z.number(),
    latestSessionID: Identifier.schema("session"),
    latestMessageID: Identifier.schema("message").optional(),
    latestSummary: z.string(),
    items: z.array(EvidenceSchema),
    events: z.array(EventSchema),
  })
  .meta({
    ref: "SessionEvidence",
  })
export type Info = z.infer<typeof InfoSchema>

const BlockSchema = z
  .object({
    type: z.literal("text"),
    title: z.string(),
    text: z.string(),
  })
  .meta({
    ref: "SessionEvidenceBlock",
  })
export type Block = z.infer<typeof BlockSchema>

const MaterializedSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    blocks: z.array(BlockSchema),
    text: z.string(),
  })
  .meta({
    ref: "SessionEvidenceMaterialized",
  })
export type Materialized = z.infer<typeof MaterializedSchema>

const Event = {
  Updated: BusEvent.define(
    "session.evidence.updated",
    z.object({
      info: InfoSchema,
    }),
  ),
}

function key(rootSessionID: string) {
  return ["session_evidence", rootSessionID]
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

function summarize(info: Pick<Info, "items">) {
  const fresh = info.items.filter((item) => item.freshness === "fresh").length
  const recent = info.items.filter((item) => item.freshness === "recent").length
  const stale = info.items.filter((item) => item.freshness === "stale").length
  const pieces = [
    info.items.length > 0 ? `evidence=${info.items.length}` : undefined,
    fresh > 0 ? `fresh=${fresh}` : undefined,
    recent > 0 ? `recent=${recent}` : undefined,
    stale > 0 ? `stale=${stale}` : undefined,
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
    items: [],
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

function evidenceSummary(input: Pick<Evidence, "fact" | "freshness" | "sourceAnchor">) {
  return `${input.fact} | freshness=${input.freshness} | source=${input.sourceAnchor}`
}

export async function get(rootSessionID: string) {
  return Storage.read<Info>(key(rootSessionID)).catch((error) => {
    if (Storage.NotFoundError.isInstance(error)) return undefined
    throw error
  })
}

export async function recordEvidence(input: {
  rootSessionID: string
  sessionID: string
  evidenceID?: string
  messageID?: string
  at?: number
  fact: string
  sourceAnchor: string
  trustBasis: string
  freshness: Freshness
  confidence?: number
  supportingRefs?: string[]
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const fact = normalizeText(input.fact)
  const existing =
    (input.evidenceID ? current.items.find((item) => item.id === input.evidenceID) : undefined) ??
    current.items.find((item) => normalizeKey(item.fact) === normalizeKey(fact))
  const record: Evidence = {
    id: input.evidenceID ?? existing?.id ?? Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID ?? existing?.messageID,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    fact,
    sourceAnchor: normalizeText(input.sourceAnchor),
    trustBasis: normalizeText(input.trustBasis),
    freshness: input.freshness,
    confidence: input.confidence ?? existing?.confidence,
    supportingRefs: (input.supportingRefs ?? existing?.supportingRefs ?? []).map(normalizeText).filter(Boolean),
    latestSummary: "",
  }
  record.latestSummary = evidenceSummary(record)
  const items = trimLog(
    [...current.items.filter((item) => item.id !== record.id && normalizeKey(item.fact) !== normalizeKey(fact)), record].sort(
      (a, b) => a.updatedAt - b.updatedAt,
    ),
    maxEvidence,
  )
  const event: EvidenceEvent = {
    id: Identifier.ascending("part"),
    evidenceID: record.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    action: existing ? "updated" : "recorded",
    summary: record.latestSummary,
  }
  return write({
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    latestSummary: summarize({ items }),
    items,
    events: trimLog([...current.events, event], maxEvents),
  })
}

export function digest(input: { info: Info; limit?: number; freshness?: Freshness[] }) {
  const limit = Math.max(1, input.limit ?? 3)
  const freshness = input.freshness ?? ["fresh", "recent"]
  const items = input.info.items
    .filter((item) => freshness.includes(item.freshness))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)

  const blocks: Block[] = []
  const evidenceBlock = block(
    "Curated evidence",
    items.map((item) =>
      [
        `- fact=${item.fact}`,
        `source=${item.sourceAnchor}`,
        `trust=${item.trustBasis}`,
        `freshness=${item.freshness}`,
        item.confidence !== undefined ? `confidence=${item.confidence}` : undefined,
        item.supportingRefs.length > 0 ? `refs=${item.supportingRefs.join("; ")}` : undefined,
      ]
        .filter((line): line is string => !!line)
        .join(" | "),
    ),
  )
  if (evidenceBlock) blocks.push(evidenceBlock)

  const summaryBlock = block("Latest summary", [input.info.latestSummary !== emptySummary ? input.info.latestSummary : undefined])
  if (summaryBlock) blocks.push(summaryBlock)

  if (blocks.length === 0) return undefined
  return {
    rootSessionID: input.info.rootSessionID,
    blocks,
    text: blocks.map((item) => `## ${item.title}\n${item.text}`).join("\n\n"),
  }
}

export async function materialize(input: { rootSessionID: string; limit?: number; freshness?: Freshness[] }) {
  const info = await get(input.rootSessionID)
  if (!info) return undefined
  return digest({
    info,
    limit: input.limit,
    freshness: input.freshness,
  })
}

export const SessionEvidence = {
  Freshness,
  Evidence: EvidenceSchema,
  Event: EventSchema,
  Info: InfoSchema,
  Block: BlockSchema,
  Materialized: MaterializedSchema,
  UpdatedEvent: Event.Updated,
  get,
  recordEvidence,
  digest,
  materialize,
}
