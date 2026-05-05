import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import z from "zod"

const maxRecords = 16

const ExecutionAuthority = z.enum(["local", "delegated", "none"]).meta({
  ref: "SessionAuthorityExecutionAuthority",
})
const ScopeAuthority = z.enum(["root", "local_refine_only", "explicit_override"]).meta({
  ref: "SessionAuthorityScopeAuthority",
})
const UserAuthority = z.enum(["root", "none"]).meta({
  ref: "SessionAuthorityUserAuthority",
})
const AuthoritySource = z.enum(["root_default", "parent_inherited", "explicit_override"]).meta({
  ref: "SessionAuthoritySource",
})
const DelegationMode = z.enum(["stay_solo", "delegate_bounded_worker", "coordinate_multi_worker"]).meta({
  ref: "SessionAuthorityDelegationMode",
})

const RecordSchema = z
  .object({
    id: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    at: z.number(),
    executionAuthority: ExecutionAuthority,
    scopeAuthority: ScopeAuthority,
    userAuthority: UserAuthority,
    authoritySource: AuthoritySource,
    delegationMode: DelegationMode,
    scopeEscalationRequired: z.boolean(),
    scopeEscalationReason: z.string().optional(),
    scopeBoundary: z.string(),
    sourceOfAuthority: z.string(),
    latestUserOverrideAnchor: z.string().optional(),
    doNotActBeyond: z.string().optional(),
    latestSummary: z.string(),
  })
  .meta({
    ref: "SessionAuthorityRecord",
  })
export type Record = z.infer<typeof RecordSchema>

const InfoSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    createdAt: z.number(),
    updatedAt: z.number(),
    latestSessionID: Identifier.schema("session"),
    latestMessageID: Identifier.schema("message").optional(),
    latestSummary: z.string(),
    records: z.array(RecordSchema),
  })
  .meta({
    ref: "SessionAuthority",
  })
export type Info = z.infer<typeof InfoSchema>

const BlockSchema = z
  .object({
    type: z.literal("text"),
    title: z.string(),
    text: z.string(),
  })
  .meta({
    ref: "SessionAuthorityBlock",
  })
export type Block = z.infer<typeof BlockSchema>

const MaterializedSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    sessionID: Identifier.schema("session").optional(),
    blocks: z.array(BlockSchema),
    text: z.string(),
  })
  .meta({
    ref: "SessionAuthorityMaterialized",
  })
export type Materialized = z.infer<typeof MaterializedSchema>

const Event = {
  Updated: BusEvent.define(
    "session.authority.updated",
    z.object({
      info: InfoSchema,
    }),
  ),
}

type AuthorityInput = {
  rootSessionID: string
  sessionID: string
  messageID?: string
  at?: number
  executionAuthority: z.infer<typeof ExecutionAuthority>
  scopeAuthority: z.infer<typeof ScopeAuthority>
  userAuthority: z.infer<typeof UserAuthority>
  authoritySource: z.infer<typeof AuthoritySource>
  delegationMode: z.infer<typeof DelegationMode>
  scopeEscalationRequired?: boolean
  scopeEscalationReason?: string
  latestUserOverrideAnchor?: string
  doNotActBeyond?: string
}

function key(rootSessionID: string) {
  return ["session_authority", rootSessionID]
}

function trimRecords(items: Record[]) {
  return items.slice(Math.max(0, items.length - maxRecords))
}

function fallback(input: { rootSessionID: string; sessionID: string; at: number; messageID?: string }): Info {
  return {
    rootSessionID: input.rootSessionID,
    createdAt: input.at,
    updatedAt: input.at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID,
    latestSummary: "No authority posture captured yet.",
    records: [],
  }
}

async function write(info: Info) {
  await Storage.write(key(info.rootSessionID), info)
  await Bus.publish(Event.Updated, { info })
  return info
}

function sourceOfAuthorityText(source: z.infer<typeof AuthoritySource>) {
  switch (source) {
    case "explicit_override":
      return "Explicitly narrowed by the active task launch."
    case "parent_inherited":
      return "Inherited from the parent task or supervisor context."
    case "root_default":
    default:
      return "Default root-session authority."
  }
}

function scopeBoundaryText(input: Pick<Record, "scopeAuthority" | "doNotActBeyond">) {
  const base =
    input.scopeAuthority === "root"
      ? "Root scope is available."
      : input.scopeAuthority === "local_refine_only"
        ? "Local refinement only."
        : "Operate only within the explicit override scope."
  return input.doNotActBeyond ? `${base} Do not act beyond: ${input.doNotActBeyond}` : base
}

function summarizeRecord(record: Omit<Record, "latestSummary" | "scopeBoundary" | "sourceOfAuthority">) {
  const bits = [
    `execution=${record.executionAuthority}`,
    `scope=${record.scopeAuthority}`,
    `delegation=${record.delegationMode}`,
    `source=${record.authoritySource}`,
  ]
  if (record.scopeEscalationRequired) bits.push("escalation=required")
  if (record.doNotActBeyond) bits.push(`limit=${record.doNotActBeyond}`)
  return bits.join(" | ")
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

export function isDefaultRecord(record: Pick<Record, "executionAuthority" | "scopeAuthority" | "userAuthority" | "authoritySource" | "delegationMode" | "scopeEscalationRequired" | "doNotActBeyond">) {
  return (
    record.executionAuthority === "local" &&
    record.scopeAuthority === "root" &&
    record.userAuthority === "root" &&
    record.authoritySource === "root_default" &&
    record.delegationMode === "stay_solo" &&
    !record.scopeEscalationRequired &&
    !record.doNotActBeyond
  )
}

function selectRecord(info: Info, sessionID?: string) {
  if (sessionID) {
    const scoped = [...info.records].reverse().find((record) => record.sessionID === sessionID)
    if (scoped) return scoped
  }
  return info.records.at(-1)
}

export async function get(rootSessionID: string) {
  return Storage.read<Info>(key(rootSessionID)).catch((error) => {
    if (Storage.NotFoundError.isInstance(error)) return undefined
    throw error
  })
}

export async function recordAuthority(input: AuthorityInput) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const recordBase = {
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    executionAuthority: input.executionAuthority,
    scopeAuthority: input.scopeAuthority,
    userAuthority: input.userAuthority,
    authoritySource: input.authoritySource,
    delegationMode: input.delegationMode,
    scopeEscalationRequired: input.scopeEscalationRequired ?? false,
    scopeEscalationReason: input.scopeEscalationReason?.trim() || undefined,
    latestUserOverrideAnchor: input.latestUserOverrideAnchor?.trim() || undefined,
    doNotActBeyond: input.doNotActBeyond?.trim() || undefined,
  } satisfies Omit<Record, "latestSummary" | "scopeBoundary" | "sourceOfAuthority">
  const record: Record = {
    ...recordBase,
    sourceOfAuthority: sourceOfAuthorityText(recordBase.authoritySource),
    scopeBoundary: scopeBoundaryText(recordBase),
    latestSummary: summarizeRecord(recordBase),
  }
  const next: Info = {
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    latestSummary: record.latestSummary,
    records: trimRecords([...current.records, record]),
  }
  return write(next)
}

export function digest(input: { info: Info; sessionID?: string; includeDefault?: boolean }): Materialized | undefined {
  const record = selectRecord(input.info, input.sessionID)
  if (!record) return undefined
  if (!input.includeDefault && isDefaultRecord(record)) return undefined

  const blocks: Block[] = []
  const posture = block("Authority posture", [
    `Execution authority: ${record.executionAuthority}`,
    `Scope authority: ${record.scopeAuthority}`,
    `User authority: ${record.userAuthority}`,
    `Authority source: ${record.authoritySource}`,
    `Delegation mode: ${record.delegationMode}`,
  ])
  if (posture) blocks.push(posture)

  const boundary = block("Scope boundary", [
    record.scopeBoundary,
    record.sourceOfAuthority,
    record.latestUserOverrideAnchor ? `Override anchor: ${record.latestUserOverrideAnchor}` : undefined,
  ])
  if (boundary) blocks.push(boundary)

  const safety = block("Execution limits", [
    record.doNotActBeyond ? `Do not act beyond: ${record.doNotActBeyond}` : undefined,
    record.scopeEscalationRequired ? "Escalation required before proceeding outside the scoped boundary." : undefined,
    record.scopeEscalationReason ? `Escalation reason: ${record.scopeEscalationReason}` : undefined,
  ])
  if (safety) blocks.push(safety)

  if (blocks.length === 0) return undefined
  return {
    rootSessionID: input.info.rootSessionID,
    sessionID: input.sessionID,
    blocks,
    text: blocks.map((item) => `## ${item.title}\n${item.text}`).join("\n\n"),
  }
}

export async function materialize(input: { rootSessionID: string; sessionID?: string; includeDefault?: boolean }) {
  const info = await get(input.rootSessionID)
  if (!info) return undefined
  return digest({
    info,
    sessionID: input.sessionID,
    includeDefault: input.includeDefault,
  })
}

export const SessionAuthority = {
  ExecutionAuthority,
  ScopeAuthority,
  UserAuthority,
  AuthoritySource,
  DelegationMode,
  Record: RecordSchema,
  Info: InfoSchema,
  Block: BlockSchema,
  Materialized: MaterializedSchema,
  Event,
  get,
  recordAuthority,
  digest,
  materialize,
  isDefaultRecord,
}
