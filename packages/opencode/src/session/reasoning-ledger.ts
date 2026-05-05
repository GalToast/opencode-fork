import { createHash } from "crypto"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import z from "zod"

const maxCommitments = 12
const maxAssumptions = 12
const maxFalsifiers = 12
const emptySummary = "No reasoning ledger entries captured yet."

const CommitmentStatusSchema = z.enum(["proposed", "active", "satisfied", "broken", "superseded"]).meta({
  ref: "ReasoningLedgerCommitmentStatus",
})
export type CommitmentStatus = z.infer<typeof CommitmentStatusSchema>

const AssumptionKindSchema = z.enum(["environment", "requirement", "causal", "state", "dependency"]).meta({
  ref: "ReasoningLedgerAssumptionKind",
})
export type AssumptionKind = z.infer<typeof AssumptionKindSchema>

const AssumptionValidationStatusSchema = z.enum(["untested", "supported", "contradicted"]).meta({
  ref: "ReasoningLedgerAssumptionValidationStatus",
})
export type AssumptionValidationStatus = z.infer<typeof AssumptionValidationStatusSchema>

const FalsifierTargetTypeSchema = z.enum(["commitment", "assumption"]).meta({
  ref: "ReasoningLedgerFalsifierTargetType",
})
export type FalsifierTargetType = z.infer<typeof FalsifierTargetTypeSchema>

const FalsifierStatusSchema = z.enum(["candidate", "armed", "triggered", "dismissed"]).meta({
  ref: "ReasoningLedgerFalsifierStatus",
})
export type FalsifierStatus = z.infer<typeof FalsifierStatusSchema>

const SourceSchema = z.enum(["user", "assistant", "tool", "retrieval", "operator"]).meta({
  ref: "ReasoningLedgerSource",
})
export type Source = z.infer<typeof SourceSchema>

const CommitmentOutcomeSchema = z.enum(["satisfied", "broken", "superseded"]).meta({
  ref: "ReasoningLedgerCommitmentOutcome",
})
export type CommitmentOutcome = z.infer<typeof CommitmentOutcomeSchema>

const AssumptionOutcomeSchema = z.enum(["supported", "contradicted", "superseded"]).meta({
  ref: "ReasoningLedgerAssumptionOutcome",
})
export type AssumptionOutcome = z.infer<typeof AssumptionOutcomeSchema>

const FalsifierOutcomeSchema = z.enum(["triggered", "dismissed", "superseded"]).meta({
  ref: "ReasoningLedgerFalsifierOutcome",
})
export type FalsifierOutcome = z.infer<typeof FalsifierOutcomeSchema>

const CommitmentSchema = z
  .object({
    id: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    at: z.number(),
    statement: z.string(),
    scope: z.enum(["task", "session", "root_session", "artifact"]),
    source: SourceSchema,
    status: CommitmentStatusSchema,
    confidence: z.number().min(0).max(1).optional(),
  })
  .meta({
    ref: "ReasoningLedgerCommitment",
  })
export type Commitment = z.infer<typeof CommitmentSchema>

const AssumptionSchema = z
  .object({
    id: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    at: z.number(),
    statement: z.string(),
    scope: z.enum(["task", "session", "root_session", "artifact"]),
    source: SourceSchema,
    kind: AssumptionKindSchema,
    validationStatus: AssumptionValidationStatusSchema,
    confidence: z.number().min(0).max(1).optional(),
  })
  .meta({
    ref: "ReasoningLedgerAssumption",
  })
export type Assumption = z.infer<typeof AssumptionSchema>

const FalsifierSchema = z
  .object({
    id: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    at: z.number(),
    statement: z.string(),
    targetType: FalsifierTargetTypeSchema,
    targetID: Identifier.schema("part").optional(),
    checkType: z.enum(["observation", "test", "tool_result", "user_correction", "counterexample"]),
    status: FalsifierStatusSchema,
    source: SourceSchema,
  })
  .meta({
    ref: "ReasoningLedgerFalsifier",
  })
export type Falsifier = z.infer<typeof FalsifierSchema>

const TransitionSchema = z
  .object({
    id: Identifier.schema("part"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    at: z.number(),
    targetType: z.enum(["commitment", "assumption", "falsifier"]),
    targetID: Identifier.schema("part"),
    outcome: z.union([CommitmentOutcomeSchema, AssumptionOutcomeSchema, FalsifierOutcomeSchema]),
    source: SourceSchema,
    note: z.string().optional(),
  })
  .meta({
    ref: "ReasoningLedgerTransition",
  })
export type Transition = z.infer<typeof TransitionSchema>

const InfoSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    createdAt: z.number(),
    updatedAt: z.number(),
    latestSessionID: Identifier.schema("session"),
    latestMessageID: Identifier.schema("message").optional(),
    commitments: z.array(CommitmentSchema),
    assumptions: z.array(AssumptionSchema),
    falsifiers: z.array(FalsifierSchema),
    events: z.array(TransitionSchema),
    latestSummary: z.string(),
  })
  .meta({
    ref: "ReasoningLedgerInfo",
  })
export type Info = z.infer<typeof InfoSchema>

const BlockSchema = z
  .object({
    type: z.literal("text"),
    title: z.string(),
    text: z.string(),
  })
  .meta({
    ref: "ReasoningLedgerBlock",
  })
export type Block = z.infer<typeof BlockSchema>

const MaterializedSchema = z
  .object({
    rootSessionID: Identifier.schema("session"),
    blocks: z.array(BlockSchema),
    text: z.string(),
  })
  .meta({
    ref: "ReasoningLedgerMaterialized",
  })
export type Materialized = z.infer<typeof MaterializedSchema>

const Event = {
  Updated: BusEvent.define(
    "session.reasoning-ledger.updated",
    z.object({
      info: InfoSchema,
    }),
  ),
}

function key(rootSessionID: string) {
  return ["reasoning_ledger", rootSessionID]
}

function trimLog<T>(items: T[], limit: number) {
  return items.slice(Math.max(0, items.length - limit))
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
    commitments: [],
    assumptions: [],
    falsifiers: [],
    events: [],
    latestSummary: emptySummary,
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

function normalizeStatement(statement: string) {
  return statement.trim().replace(/\s+/g, " ")
}

function summarize(info: Pick<Info, "commitments" | "assumptions" | "falsifiers"> & { events?: Transition[] }) {
  const activeCommitments = info.commitments.filter((item) => item.status === "active" || item.status === "proposed")
  const riskyAssumptions = info.assumptions.filter(
    (item) => item.validationStatus !== "supported" && item.validationStatus !== "contradicted",
  )
  const armedFalsifiers = info.falsifiers.filter((item) => item.status === "candidate" || item.status === "armed")
  const transitions = info.events ?? []

  const pieces = [
    activeCommitments.length > 0 ? `commitments=${activeCommitments.length}` : undefined,
    riskyAssumptions.length > 0 ? `assumptions=${riskyAssumptions.length}` : undefined,
    armedFalsifiers.length > 0 ? `falsifiers=${armedFalsifiers.length}` : undefined,
    transitions.length > 0 ? `transitions=${transitions.length}` : undefined,
  ].filter((value): value is string => !!value)

  return pieces.length > 0 ? pieces.join(" | ") : emptySummary
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

function formatCommitment(item: Commitment) {
  const bits = [`- [${item.status}] ${item.statement}`]
  bits.push(`scope=${item.scope}`)
  bits.push(`source=${item.source}`)
  if (item.confidence !== undefined) bits.push(`confidence=${item.confidence.toFixed(2)}`)
  return bits.join(" | ")
}

function formatAssumption(item: Assumption) {
  const bits = [`- [${item.validationStatus}] ${item.statement}`]
  bits.push(`kind=${item.kind}`)
  bits.push(`scope=${item.scope}`)
  bits.push(`source=${item.source}`)
  if (item.confidence !== undefined) bits.push(`confidence=${item.confidence.toFixed(2)}`)
  return bits.join(" | ")
}

function formatFalsifier(item: Falsifier) {
  const bits = [`- [${item.status}] ${item.statement}`]
  bits.push(`target=${item.targetType}`)
  if (item.targetID) bits.push(`targetID=${item.targetID}`)
  bits.push(`check=${item.checkType}`)
  bits.push(`source=${item.source}`)
  return bits.join(" | ")
}

function formatTransition(item: Transition) {
  const bits = [`- [${item.outcome}] ${item.targetType}:${item.targetID}`]
  bits.push(`source=${item.source}`)
  if (item.note) bits.push(`note=${item.note}`)
  return bits.join(" | ")
}

function commitmentStateLabel(status: CommitmentStatus) {
  return `commitment:${status}`
}

function assumptionStateLabel(status: AssumptionValidationStatus) {
  return `assumption:${status}`
}

function falsifierStateLabel(status: FalsifierStatus) {
  return `falsifier:${status}`
}

function transitionKind(targetType: Transition["targetType"]) {
  if (targetType === "commitment") return "commitment_outcome"
  if (targetType === "assumption") return "assumption_outcome"
  return "falsifier_outcome"
}

function transitionOutcomeScore(transition: Transition) {
  if (transition.targetType === "commitment") {
    if (transition.outcome === "satisfied") return 2
    if (transition.outcome === "broken") return -2
    return -0.5
  }
  if (transition.targetType === "assumption") {
    if (transition.outcome === "supported") return 1
    if (transition.outcome === "contradicted") return -2
    return -0.5
  }
  if (transition.outcome === "dismissed") return 1
  if (transition.outcome === "triggered") return -2
  return -0.5
}

function transitionNegativeSignal(transition: Transition) {
  if (transition.targetType === "commitment") return transition.outcome !== "satisfied"
  if (transition.targetType === "assumption") return transition.outcome !== "supported"
  return transition.outcome !== "dismissed"
}

async function persistTransitionMemory(input: {
  rootSessionID: string
  sessionID: string
  transition: Transition
  previousInfo: Info
  nextInfo: Info
}) {
  try {
    const { Session } = await import("@/session")
    const { RetrievalService } = await import("@/retrieval")
    const { SessionID } = await import("@/session/schema")
    const rootSession = await Session.get(SessionID.make(input.rootSessionID))
    const eventSession = await Session.get(SessionID.make(input.sessionID))
    const projectID = rootSession?.projectID ?? eventSession?.projectID
    if (!projectID) return

    const previousCommitment = input.previousInfo.commitments.find((item) => item.id === input.transition.targetID)
    const nextCommitment = input.nextInfo.commitments.find((item) => item.id === input.transition.targetID)
    const previousAssumption = input.previousInfo.assumptions.find((item) => item.id === input.transition.targetID)
    const nextAssumption = input.nextInfo.assumptions.find((item) => item.id === input.transition.targetID)
    const previousFalsifier = input.previousInfo.falsifiers.find((item) => item.id === input.transition.targetID)
    const nextFalsifier = input.nextInfo.falsifiers.find((item) => item.id === input.transition.targetID)

    const statement =
      previousCommitment?.statement ??
      nextCommitment?.statement ??
      previousAssumption?.statement ??
      nextAssumption?.statement ??
      previousFalsifier?.statement ??
      nextFalsifier?.statement ??
      input.transition.targetID

    const previousStatus =
      previousCommitment?.status
        ? commitmentStateLabel(previousCommitment.status)
        : previousAssumption?.validationStatus
          ? assumptionStateLabel(previousAssumption.validationStatus)
          : previousFalsifier?.status
            ? falsifierStateLabel(previousFalsifier.status)
            : "unknown"

    const currentStatus =
      nextCommitment?.status
        ? commitmentStateLabel(nextCommitment.status)
        : nextAssumption?.validationStatus
          ? assumptionStateLabel(nextAssumption.validationStatus)
          : nextFalsifier?.status
            ? falsifierStateLabel(nextFalsifier.status)
            : "unknown"

    const content = [
      `Reasoning ${input.transition.targetType} outcome`,
      `root_session_id: ${input.rootSessionID}`,
      `session_id: ${input.sessionID}`,
      `transition_id: ${input.transition.id}`,
      `target_type: ${input.transition.targetType}`,
      `target_id: ${input.transition.targetID}`,
      `statement: ${statement}`,
      `previous_status: ${previousStatus}`,
      `outcome: ${input.transition.outcome}`,
      `current_status: ${currentStatus}`,
      `source: ${input.transition.source}`,
      input.transition.note ? `note: ${input.transition.note}` : undefined,
    ]
      .filter(Boolean)
      .join("\n")

    const fingerprint = createHash("sha1").update(content).digest("hex")
    const documentID = `retrieval-document-reasoning-transition-${input.transition.id}`
    await RetrievalService.upsertDocument({
      id: documentID,
      projectID,
      sessionID: input.sessionID,
      sourceType: "note",
      sourceID: input.transition.id,
      title: `Reasoning ${input.transition.targetType} outcome: ${input.transition.outcome}`,
      fingerprint: `${input.transition.id}:${fingerprint}`,
      metadata: {
        kind: transitionKind(input.transition.targetType),
        targetType: input.transition.targetType,
        targetID: input.transition.targetID,
        rootSessionID: input.rootSessionID,
        sessionID: input.sessionID,
        previousStatus,
        currentStatus,
        outcome: input.transition.outcome,
        source: input.transition.source,
      },
      outcomeScore: transitionOutcomeScore(input.transition),
      negativeSignal: transitionNegativeSignal(input.transition),
    })
    await RetrievalService.replaceChunks({
      documentID,
      projectID,
      content,
      chunkType: "reasoning_transition",
    })

    // Create an episodic memory for negative signal transitions — these are
    // the "lessons" that should persist across sessions.
    if (transitionNegativeSignal(input.transition)) {
      const { Episodes } = await import("@/memory/episodes")
      await Episodes.fromTransition({
        projectID,
        sessionID: input.sessionID,
        rootSessionID: input.rootSessionID,
        targetType: input.transition.targetType,
        outcome: input.transition.outcome,
        statement,
        note: input.transition.note,
        previous: previousStatus,
        current: currentStatus,
      }).catch(() => {})
    }
  } catch {
    return
  }
}

export async function recordCommitment(input: {
  sessionID: string
  rootSessionID: string
  statement: string
  scope?: Commitment["scope"]
  source?: Source
  status?: CommitmentStatus
  messageID?: string
  confidence?: number
  at?: number
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const commitment: Commitment = {
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    statement: normalizeStatement(input.statement),
    scope: input.scope ?? "root_session",
    source: input.source ?? "operator",
    status: input.status ?? "active",
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
  }
  const next: Info = {
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    commitments: trimLog([...current.commitments, commitment], maxCommitments),
    latestSummary: summarize({
      commitments: [...current.commitments, commitment],
      assumptions: current.assumptions,
      falsifiers: current.falsifiers,
      events: current.events,
    }),
  }
  return write(next)
}

export async function recordAssumption(input: {
  sessionID: string
  rootSessionID: string
  statement: string
  scope?: Assumption["scope"]
  source?: Source
  kind?: AssumptionKind
  validationStatus?: AssumptionValidationStatus
  messageID?: string
  confidence?: number
  at?: number
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const assumption: Assumption = {
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    statement: normalizeStatement(input.statement),
    scope: input.scope ?? "root_session",
    source: input.source ?? "operator",
    kind: input.kind ?? "state",
    validationStatus: input.validationStatus ?? "untested",
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
  }
  const next: Info = {
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    assumptions: trimLog([...current.assumptions, assumption], maxAssumptions),
    latestSummary: summarize({
      commitments: current.commitments,
      assumptions: [...current.assumptions, assumption],
      falsifiers: current.falsifiers,
      events: current.events,
    }),
  }
  return write(next)
}

export async function recordFalsifier(input: {
  sessionID: string
  rootSessionID: string
  statement: string
  targetType: FalsifierTargetType
  targetID?: string
  checkType?: Falsifier["checkType"]
  status?: FalsifierStatus
  source?: Source
  messageID?: string
  at?: number
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const falsifier: Falsifier = {
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    statement: normalizeStatement(input.statement),
    targetType: input.targetType,
    targetID: input.targetID,
    checkType: input.checkType ?? "observation",
    status: input.status ?? "candidate",
    source: input.source ?? "operator",
  }
  const next: Info = {
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    falsifiers: trimLog([...current.falsifiers, falsifier], maxFalsifiers),
    latestSummary: summarize({
      commitments: current.commitments,
      assumptions: current.assumptions,
      falsifiers: [...current.falsifiers, falsifier],
      events: current.events,
    }),
  }
  return write(next)
}

function updateCommitmentStatus(items: Commitment[], targetID: string, outcome: CommitmentOutcome): Commitment[] {
  return items.map((item) =>
    item.id === targetID
      ? {
          ...item,
          status: outcome,
        }
      : item,
  )
}

function updateAssumptionStatus(items: Assumption[], targetID: string, outcome: AssumptionOutcome): Assumption[] {
  const validationStatus: AssumptionValidationStatus =
    outcome === "supported" ? "supported" : outcome === "contradicted" ? "contradicted" : "untested"
  return items.map((item) =>
    item.id === targetID
      ? {
          ...item,
          validationStatus,
        }
      : item,
  )
}

function updateFalsifierStatus(items: Falsifier[], targetID: string, outcome: FalsifierOutcome): Falsifier[] {
  const status: FalsifierStatus = outcome === "triggered" ? "triggered" : outcome === "dismissed" ? "dismissed" : "candidate"
  return items.map((item) =>
    item.id === targetID
      ? {
          ...item,
          status,
        }
      : item,
  )
}

async function recordTransition(input: {
  sessionID: string
  rootSessionID: string
  targetType: Transition["targetType"]
  targetID: string
  outcome: Transition["outcome"]
  note?: string
  source?: Source
  messageID?: string
  at?: number
}) {
  const at = input.at ?? Date.now()
  const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
  const transition: Transition = {
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    at,
    targetType: input.targetType,
    targetID: input.targetID,
    outcome: input.outcome,
    source: input.source ?? "operator",
    ...(input.note ? { note: normalizeStatement(input.note) } : {}),
  }
  const events = trimLog([...current.events, transition], maxFalsifiers)
  const next: Info = {
    ...current,
    updatedAt: at,
    latestSessionID: input.sessionID,
    latestMessageID: input.messageID ?? current.latestMessageID,
    commitments:
      input.targetType === "commitment" ? updateCommitmentStatus(current.commitments, input.targetID, input.outcome as CommitmentOutcome) : current.commitments,
    assumptions:
      input.targetType === "assumption" ? updateAssumptionStatus(current.assumptions, input.targetID, input.outcome as AssumptionOutcome) : current.assumptions,
    falsifiers:
      input.targetType === "falsifier" ? updateFalsifierStatus(current.falsifiers, input.targetID, input.outcome as FalsifierOutcome) : current.falsifiers,
    events,
  }
  next.latestSummary = summarize({
    commitments: next.commitments,
    assumptions: next.assumptions,
    falsifiers: next.falsifiers,
    events,
  })
  const written = await write(next)
  await persistTransitionMemory({
    rootSessionID: input.rootSessionID,
    sessionID: input.sessionID,
    transition,
    previousInfo: current,
    nextInfo: written,
  })
  return written
}

export async function reconcileCommitment(input: {
  sessionID: string
  rootSessionID: string
  commitmentID: string
  outcome: CommitmentOutcome
  note?: string
  source?: Source
  messageID?: string
  at?: number
}) {
  return recordTransition({
    sessionID: input.sessionID,
    rootSessionID: input.rootSessionID,
    targetType: "commitment",
    targetID: input.commitmentID,
    outcome: input.outcome,
    note: input.note,
    source: input.source,
    messageID: input.messageID,
    at: input.at,
  })
}

export async function reconcileAssumption(input: {
  sessionID: string
  rootSessionID: string
  assumptionID: string
  outcome: AssumptionOutcome
  note?: string
  source?: Source
  messageID?: string
  at?: number
}) {
  return recordTransition({
    sessionID: input.sessionID,
    rootSessionID: input.rootSessionID,
    targetType: "assumption",
    targetID: input.assumptionID,
    outcome: input.outcome,
    note: input.note,
    source: input.source,
    messageID: input.messageID,
    at: input.at,
  })
}

export async function reconcileFalsifier(input: {
  sessionID: string
  rootSessionID: string
  falsifierID: string
  outcome: FalsifierOutcome
  note?: string
  source?: Source
  messageID?: string
  at?: number
}) {
  return recordTransition({
    sessionID: input.sessionID,
    rootSessionID: input.rootSessionID,
    targetType: "falsifier",
    targetID: input.falsifierID,
    outcome: input.outcome,
    note: input.note,
    source: input.source,
    messageID: input.messageID,
    at: input.at,
  })
}

export function digest(input: {
  info: Info
  maxCommitments?: number
  maxAssumptions?: number
  maxFalsifiers?: number
}): Materialized | undefined {
  const info = input.info
  const commitmentLimit = input.maxCommitments ?? 4
  const assumptionLimit = input.maxAssumptions ?? 4
  const falsifierLimit = input.maxFalsifiers ?? 4
  const blocks: Block[] = []

  const commitments = info.commitments.filter((item) => item.status === "active" || item.status === "proposed")
  const commitmentBlock = block(
    "Active commitments",
    commitments.slice(Math.max(0, commitments.length - commitmentLimit)).map((item) => formatCommitment(item)),
  )
  if (commitmentBlock) blocks.push(commitmentBlock)

  const riskyAssumptions = info.assumptions.filter(
    (item) => item.validationStatus !== "supported" && item.validationStatus !== "contradicted",
  )
  const assumptionBlock = block(
    "Risky assumptions",
    riskyAssumptions.slice(Math.max(0, riskyAssumptions.length - assumptionLimit)).map((item) => formatAssumption(item)),
  )
  if (assumptionBlock) blocks.push(assumptionBlock)

  const armedFalsifiers = info.falsifiers.filter((item) => item.status === "candidate" || item.status === "armed")
  const falsifierBlock = block(
    "Armed falsifiers",
    armedFalsifiers.slice(Math.max(0, armedFalsifiers.length - falsifierLimit)).map((item) => formatFalsifier(item)),
  )
  if (falsifierBlock) blocks.push(falsifierBlock)

  const summaryBlock = block("Latest summary", [info.latestSummary !== emptySummary ? info.latestSummary : undefined])
  if (summaryBlock) blocks.push(summaryBlock)

  const transitionBlock = block(
    "Recent transitions",
    info.events.slice(Math.max(0, info.events.length - 4)).map((item) => formatTransition(item)),
  )
  if (transitionBlock) blocks.push(transitionBlock)

  if (blocks.length === 0) return undefined
  return {
    rootSessionID: info.rootSessionID,
    blocks,
    text: blocks.map((item) => `## ${item.title}\n${item.text}`).join("\n\n"),
  }
}

export async function materialize(input: {
  rootSessionID: string
  maxCommitments?: number
  maxAssumptions?: number
  maxFalsifiers?: number
}) {
  const info = await get(input.rootSessionID)
  if (!info) return undefined
  return digest({
    info,
    maxCommitments: input.maxCommitments,
    maxAssumptions: input.maxAssumptions,
    maxFalsifiers: input.maxFalsifiers,
  })
}

export const ReasoningLedger = {
  CommitmentStatus: CommitmentStatusSchema,
  AssumptionKind: AssumptionKindSchema,
  AssumptionValidationStatus: AssumptionValidationStatusSchema,
  FalsifierTargetType: FalsifierTargetTypeSchema,
  FalsifierStatus: FalsifierStatusSchema,
  Source: SourceSchema,
  Commitment: CommitmentSchema,
  Assumption: AssumptionSchema,
  Falsifier: FalsifierSchema,
  Transition: TransitionSchema,
  Info: InfoSchema,
  Block: BlockSchema,
  Materialized: MaterializedSchema,
  Event,
  get,
  recordCommitment,
  recordAssumption,
  recordFalsifier,
  reconcileCommitment,
  reconcileAssumption,
  reconcileFalsifier,
  digest,
  materialize,
}
