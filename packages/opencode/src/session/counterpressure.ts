import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import z from "zod"

const maxWarnings = 24
const maxEvents = 48
const emptySummary = "No counterpressure captured yet."

const Severity = z.enum(["medium", "high", "critical"]).meta({
  ref: "SessionCounterpressureSeverity",
})
export type Severity = z.infer<typeof Severity>

const WarningSchema = z
  .object({
    id: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    trigger: z.string(),
    severity: Severity,
    recommendedAction: z.string(),
    relatedInvalidationHints: z.array(z.string()),
    lastObservedAt: z.number(),
    latestSummary: z.string(),
  })
  .meta({
    ref: "SessionCounterpressureWarning",
  })
export type Warning = z.infer<typeof WarningSchema>

const EventSchema = z
  .object({
    id: Identifier.schema("part"),
    warningID: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    at: z.number(),
    action: z.enum(["recorded", "updated"]),
    summary: z.string(),
  })
  .meta({
    ref: "SessionCounterpressureEvent",
  })
export type CounterpressureEvent = z.infer<typeof EventSchema>

const InfoSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    createdAt: z.number(),
    updatedAt: z.number(),
    latestSessionID: Identifier.schema("session"),
    latestMessageID: Identifier.schema("message").optional(),
    latestSummary: z.string(),
    warnings: z.array(WarningSchema),
    events: z.array(EventSchema),
  })
  .meta({
    ref: "SessionCounterpressure",
  })
export type Info = z.infer<typeof InfoSchema>

const BlockSchema = z
  .object({
    type: z.literal("text"),
    title: z.string(),
    text: z.string(),
  })
  .meta({
    ref: "SessionCounterpressureBlock",
  })
export type Block = z.infer<typeof BlockSchema>

const MaterializedSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    blocks: z.array(BlockSchema),
    text: z.string(),
  })
  .meta({
    ref: "SessionCounterpressureMaterialized",
  })
export type Materialized = z.infer<typeof MaterializedSchema>

const Event = {
  Updated: BusEvent.define(
    "session.counterpressure.updated",
    z.object({
      info: InfoSchema,
    }),
  ),
}

function key(rootSessionID: string) {
  return ["session_counterpressure", rootSessionID]
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

function summarize(info: Pick<Info, "warnings">) {
  const high = info.warnings.filter((item) => item.severity === "high").length
  const critical = info.warnings.filter((item) => item.severity === "critical").length
  const medium = info.warnings.filter((item) => item.severity === "medium").length
  const pieces = [
    info.warnings.length > 0 ? `warnings=${info.warnings.length}` : undefined,
    critical > 0 ? `critical=${critical}` : undefined,
    high > 0 ? `high=${high}` : undefined,
    medium > 0 ? `medium=${medium}` : undefined,
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
    warnings: [],
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

function warningSummary(input: Pick<Warning, "trigger" | "severity" | "recommendedAction">) {
  return `${input.trigger} | severity=${input.severity} | action=${input.recommendedAction}`
}

export async function get(rootSessionID: string) {
  return Storage.read<Info>(key(rootSessionID)).catch((error) => {
    if (Storage.NotFoundError.isInstance(error)) return undefined
    throw error
  })
}

export async function recordWarning(input: {
  rootSessionID: string
  sessionID: string
  warningID?: string
  messageID?: string
  at?: number
  trigger: string
  severity: Severity
  recommendedAction: string
  relatedInvalidationHints?: string[]
  lastObservedAt?: number
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const trigger = normalizeText(input.trigger)
  const existing =
    (input.warningID ? current.warnings.find((item) => item.id === input.warningID) : undefined) ??
    current.warnings.find((item) => normalizeKey(item.trigger) === normalizeKey(trigger))
  const record: Warning = {
    id: input.warningID ?? existing?.id ?? Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID ?? existing?.messageID,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    trigger,
    severity: input.severity,
    recommendedAction: normalizeText(input.recommendedAction),
    relatedInvalidationHints: (input.relatedInvalidationHints ?? existing?.relatedInvalidationHints ?? [])
      .map(normalizeText)
      .filter(Boolean),
    lastObservedAt: input.lastObservedAt ?? at,
    latestSummary: "",
  }
  record.latestSummary = warningSummary(record)
  const warnings = trimLog(
    [...current.warnings.filter((item) => item.id !== record.id && normalizeKey(item.trigger) !== normalizeKey(trigger)), record].sort(
      (a, b) => a.updatedAt - b.updatedAt,
    ),
    maxWarnings,
  )
  const event: CounterpressureEvent = {
    id: Identifier.ascending("part"),
    warningID: record.id,
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
    latestSummary: summarize({ warnings }),
    warnings,
    events: trimLog([...current.events, event], maxEvents),
  })
}

export function digest(input: { info: Info; limit?: number; severities?: Severity[] }) {
  const limit = Math.max(1, input.limit ?? 3)
  const severities = input.severities ?? ["critical", "high"]
  const warnings = input.info.warnings
    .filter((item) => severities.includes(item.severity))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)

  if (warnings.length === 0) return undefined

  const blocks: Block[] = []
  const warningsBlock = block(
    "Counterpressure",
    warnings.map((item) =>
      [
        `- trigger=${item.trigger}`,
        `severity=${item.severity}`,
        `recommended_action=${item.recommendedAction}`,
        item.relatedInvalidationHints.length > 0 ? `invalidation_hints=${item.relatedInvalidationHints.join("; ")}` : undefined,
      ]
        .filter((line): line is string => !!line)
        .join(" | "),
    ),
  )
  if (warningsBlock) blocks.push(warningsBlock)

  if (blocks.length === 0) return undefined
  return {
    rootSessionID: input.info.rootSessionID,
    blocks,
    text: blocks.map((item) => `## ${item.title}\n${item.text}`).join("\n\n"),
  }
}

export async function materialize(input: { rootSessionID: string; limit?: number; severities?: Severity[] }) {
  const info = await get(input.rootSessionID)
  if (!info) return undefined
  return digest({
    info,
    limit: input.limit,
    severities: input.severities,
  })
}

export const SessionCounterpressure = {
  Severity,
  Warning: WarningSchema,
  Event: EventSchema,
  Info: InfoSchema,
  Block: BlockSchema,
  Materialized: MaterializedSchema,
  UpdatedEvent: Event.Updated,
  get,
  recordWarning,
  digest,
  materialize,
}
