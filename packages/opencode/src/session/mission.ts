import { Bus } from "@/bus"
import { BusEvent, type BusEventDefinition } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import z from "zod"

const maxIntentLog = 12
const maxSteeringDeltas = 24
const maxConstraintSummaryLines = 12
const emptyIntent = "No user intent captured yet."

const ResponderSchema = z
  .object({
    agent: z.string().optional(),
    providerID: z.string().optional(),
    modelID: z.string().optional(),
  })
  .meta({
    ref: "SessionMissionResponder",
  })
export type Responder = z.infer<typeof ResponderSchema>

const IntentSchema = z
  .object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    at: z.number(),
    intent: z.string(),
    constraintsSummary: z.string().optional(),
    responder: ResponderSchema.optional(),
  })
  .meta({
    ref: "SessionMissionIntent",
  })
export type Intent = z.infer<typeof IntentSchema>

const SteeringDeltaSchema = z
  .object({
    sessionID: Identifier.schema("session"),
    stage: z.enum(["received", "applied"]),
    at: z.number(),
    pending: z.number().int().min(0),
    messageID: Identifier.schema("message").optional(),
    latencyMS: z.number().int().min(0).optional(),
  })
  .meta({
    ref: "SessionMissionSteeringDelta",
  })
export type SteeringDelta = z.infer<typeof SteeringDeltaSchema>

const InfoSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    createdAt: z.number(),
    updatedAt: z.number(),
    latestSessionID: Identifier.schema("session"),
    latestMessageID: Identifier.schema("message").optional(),
    latestIntent: z.string(),
    latestConstraintsSummary: z.string().optional(),
    latestResponder: ResponderSchema.optional(),
    intentLog: z.array(IntentSchema),
    steeringDeltas: z.array(SteeringDeltaSchema),
  })
  .meta({
    ref: "SessionMission",
  })
export type Info = z.infer<typeof InfoSchema>

const BlockSchema = z
  .object({
    type: z.literal("text"),
    title: z.string(),
    text: z.string(),
  })
  .meta({
    ref: "SessionMissionBlock",
  })
export type Block = z.infer<typeof BlockSchema>

const MaterializedSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    blocks: z.array(BlockSchema),
    text: z.string(),
  })
  .meta({
    ref: "SessionMissionMaterialized",
  })
export type Materialized = z.infer<typeof MaterializedSchema>

const Event = {
  Updated: BusEvent.define(
    "session.mission.updated",
    z.object({
      info: InfoSchema,
    }),
  ),
}

const SteerEvent = z.object({
  sessionID: Identifier.schema("session"),
  rootSessionID: Identifier.schema("session").optional(),
  stage: z.enum(["received", "applied"]),
  at: z.number(),
  messageID: Identifier.schema("message").optional(),
  pending: z.number().int().min(0),
  latencyMS: z.number().int().min(0).optional(),
  cleared: z.boolean().optional(),
  mirrored: z.boolean().optional(),
})

export function init(events: { Steer: BusEventDefinition }) {
  Bus.subscribe(events.Steer, (payload) => {
    const p = SteerEvent.parse(payload.properties)
    if (p.cleared || p.mirrored) return
    void recordSteer({
      sessionID: p.sessionID,
      rootSessionID: p.rootSessionID ?? p.sessionID,
      stage: p.stage,
      at: p.at,
      pending: p.pending,
      messageID: p.messageID,
      latencyMS: p.latencyMS,
    })
  })
}

function key(rootSessionID: string) {
  return ["session_mission", rootSessionID]
}

function trimLog<T>(items: T[], limit: number) {
  return items.slice(Math.max(0, items.length - limit))
}

function normalizeSummaryLines(value?: string) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function mergeConstraintSummary(current?: string, incoming?: string) {
  const merged = [...normalizeSummaryLines(current), ...normalizeSummaryLines(incoming)]
  if (merged.length === 0) return undefined

  const seen = new Set<string>()
  const unique: string[] = []
  for (const line of merged) {
    if (seen.has(line)) continue
    seen.add(line)
    unique.push(line)
    if (unique.length >= maxConstraintSummaryLines) break
  }

  return unique.join("\n")
}

function fallback(input: {
  rootSessionID: string
  sessionID: string
  at: number
  messageID?: string
}): Info {
  return {
    rootSessionID: input.rootSessionID,
    createdAt: input.at,
    updatedAt: input.at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID,
    latestIntent: emptyIntent,
    intentLog: [],
    steeringDeltas: [],
  }
}

async function write(info: Info) {
  await Storage.write(key(info.rootSessionID), info)
  await Bus.publish(Event.Updated, { info })
  return info
}

export async function get(rootSessionID: string) {
  return Storage.read<Info>(key(rootSessionID)).catch((error) => {
    if (Storage.NotFoundError.isInstance(error)) return undefined
    throw error
  })
}

export async function recordIngress(input: {
  sessionID: string
  rootSessionID: string
  messageID?: string
  at?: number
  intent: string
  constraintsSummary?: string
  responder?: Responder
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const entry: Intent = {
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    intent: input.intent,
    ...(input.constraintsSummary ? { constraintsSummary: input.constraintsSummary } : {}),
    ...(input.responder ? { responder: input.responder } : {}),
  }
    const next: Info = {
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID,
      latestIntent: input.intent,
      latestConstraintsSummary: mergeConstraintSummary(current.latestConstraintsSummary, input.constraintsSummary),
      latestResponder: input.responder ?? current.latestResponder,
      intentLog: trimLog([...current.intentLog, entry], maxIntentLog),
    }
  return write(next)
}

export async function recordSteer(input: {
  sessionID: string
  rootSessionID: string
  stage: "received" | "applied"
  at?: number
  pending: number
  messageID?: string
  latencyMS?: number
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const delta: SteeringDelta = {
    sessionID: input.sessionID,
    stage: input.stage,
    at,
    pending: input.pending,
    messageID: input.messageID,
    latencyMS: input.latencyMS,
  }
  const next: Info = {
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    steeringDeltas: trimLog([...current.steeringDeltas, delta], maxSteeringDeltas),
  }
  return write(next)
}

function formatSteer(delta: SteeringDelta) {
  const bits = [`${delta.stage} (pending=${delta.pending})`]
  if (delta.messageID) bits.push(`message=${delta.messageID}`)
  if (delta.latencyMS !== undefined) bits.push(`latency=${delta.latencyMS}ms`)
  return bits.join(", ")
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

export function digest(input: {
  info: Info
  maxIntents?: number
  maxSteering?: number
}): Materialized | undefined {
  const info = input.info
  const maxIntents = input.maxIntents ?? 3
  const maxSteering = input.maxSteering ?? 3
  const blocks: Block[] = []

  const focus = block("Mission focus", [info.latestIntent !== emptyIntent ? info.latestIntent : undefined])
  if (focus) blocks.push(focus)

  const constraints = block("Constraints", [info.latestConstraintsSummary])
  if (constraints) blocks.push(constraints)

  const recentIntents = info.intentLog
    .slice(Math.max(0, info.intentLog.length - maxIntents))
    .map((entry) => {
      const summary = entry.constraintsSummary ? ` | constraints: ${entry.constraintsSummary}` : ""
      return `- ${entry.intent}${summary}`
    })
  const intentBlock = block("Recent intent log", recentIntents)
  if (intentBlock && recentIntents.length > 1) blocks.push(intentBlock)

  const recentSteering = info.steeringDeltas
    .slice(Math.max(0, info.steeringDeltas.length - maxSteering))
    .map((delta) => `- ${formatSteer(delta)}`)
  const steeringBlock = block("Recent steering", recentSteering)
  if (steeringBlock) blocks.push(steeringBlock)

  if (blocks.length === 0) return undefined
  return {
    rootSessionID: info.rootSessionID,
    blocks,
    text: blocks.map((item) => `## ${item.title}\n${item.text}`).join("\n\n"),
  }
}

export async function materialize(input: {
  rootSessionID: string
  maxIntents?: number
  maxSteering?: number
}) {
  const info = await get(input.rootSessionID)
  if (!info) return undefined
  return digest({
    info,
    maxIntents: input.maxIntents,
    maxSteering: input.maxSteering,
  })
}

export const SessionMission = {
  Responder: ResponderSchema,
  Intent: IntentSchema,
  SteeringDelta: SteeringDeltaSchema,
  Info: InfoSchema,
  Block: BlockSchema,
  Materialized: MaterializedSchema,
  Event,
  init,
  get,
  recordIngress,
  recordSteer,
  digest,
  materialize,
}
