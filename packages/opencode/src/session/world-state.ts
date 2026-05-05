import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { SessionOpenLoops } from "@/session/open-loops"
import { Storage } from "@/storage/storage"
import z from "zod"

/* eslint-disable-next-line @typescript-eslint/no-namespace */
export namespace SessionWorldState {
  const maxConstraints = 16
  const maxOpenRisks = 12
  const maxAssumptionRefs = 16
  const maxCommitmentRefs = 16
  const maxTouchedFiles = 24
  const maxOpenLoops = 12
  const maxClosedLoops = 12
  const emptySummary = "No world state captured yet."

  export const Objective = z
    .object({
      id: Identifier.schema("part"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
      at: z.number(),
      title: z.string(),
      note: z.string().optional(),
    })
    .meta({
      ref: "SessionWorldStateObjective",
    })
  export type Objective = z.infer<typeof Objective>

  export const Risk = z
    .object({
      id: Identifier.schema("part"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
      at: z.number(),
      statement: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      note: z.string().optional(),
    })
    .meta({
      ref: "SessionWorldStateRisk",
    })
  export type Risk = z.infer<typeof Risk>

  export const Reference = z
    .object({
      id: Identifier.schema("part"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
      at: z.number(),
      reasoningID: Identifier.schema("part"),
      statement: z.string(),
      note: z.string().optional(),
    })
    .meta({
      ref: "SessionWorldStateReference",
    })
  export type Reference = z.infer<typeof Reference>

  export const TouchedFile = z
    .object({
      id: Identifier.schema("part"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
      at: z.number(),
      path: z.string(),
      note: z.string().optional(),
    })
    .meta({
      ref: "SessionWorldStateTouchedFile",
    })
  export type TouchedFile = z.infer<typeof TouchedFile>

  export const Loop = z
    .object({
      id: Identifier.schema("part"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
      at: z.number(),
      summary: z.string(),
      status: z.enum(["open", "closed"]),
      note: z.string().optional(),
      closedAt: z.number().optional(),
    })
    .meta({
      ref: "SessionWorldStateLoop",
    })
  export type Loop = z.infer<typeof Loop>

  export const Info = z
    .object({
      rootSessionID: Identifier.schema("session"),
      createdAt: z.number(),
      updatedAt: z.number(),
      latestSessionID: Identifier.schema("session"),
      latestMessageID: Identifier.schema("message").optional(),
      objective: Objective.optional(),
      constraints: z.array(z.string()),
      openRisks: z.array(Risk),
      assumptionRefs: z.array(Reference),
      commitmentRefs: z.array(Reference),
      touchedFiles: z.array(TouchedFile),
      openLoops: z.array(Loop),
      closedLoops: z.array(Loop),
      latestSummary: z.string(),
    })
    .meta({
      ref: "SessionWorldState",
    })
  export type Info = z.infer<typeof Info>

  export const Block = z
    .object({
      type: z.literal("text"),
      title: z.string(),
      text: z.string(),
    })
    .meta({
      ref: "SessionWorldStateBlock",
    })
  export type Block = z.infer<typeof Block>

  export const Materialized = z
    .object({
      rootSessionID: Identifier.schema("session"),
      blocks: z.array(Block),
      text: z.string(),
    })
    .meta({
      ref: "SessionWorldStateMaterialized",
    })
  export type Materialized = z.infer<typeof Materialized>

  export const Event = {
    Updated: BusEvent.define(
      "session.world-state.updated",
      z.object({
        info: Info,
      }),
    ),
  }

  function key(rootSessionID: string) {
    return ["world_state", rootSessionID]
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

  function fallback(input: { rootSessionID: string; sessionID: string; at: number; messageID?: string }): Info {
    return {
      rootSessionID: input.rootSessionID,
      createdAt: input.at,
      updatedAt: input.at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID,
      objective: undefined,
      constraints: [],
      openRisks: [],
      assumptionRefs: [],
      commitmentRefs: [],
      touchedFiles: [],
      openLoops: [],
      closedLoops: [],
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

  function summarize(info: Info) {
    const pieces = [
      info.objective ? `objective=${info.objective.title}` : undefined,
      info.constraints.length > 0 ? `constraints=${info.constraints.length}` : undefined,
      info.openRisks.length > 0 ? `risks=${info.openRisks.length}` : undefined,
      info.assumptionRefs.length > 0 ? `assumptions=${info.assumptionRefs.length}` : undefined,
      info.commitmentRefs.length > 0 ? `commitments=${info.commitmentRefs.length}` : undefined,
      info.touchedFiles.length > 0 ? `files=${info.touchedFiles.length}` : undefined,
      info.openLoops.length > 0 ? `open_loops=${info.openLoops.length}` : undefined,
      info.closedLoops.length > 0 ? `closed_loops=${info.closedLoops.length}` : undefined,
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

  function upsertString(items: string[], value: string, limit: number) {
    const normalized = normalizeText(value)
    const existingIndex = items.findIndex((item) => normalizeKey(item) === normalizeKey(normalized))
    const next = existingIndex >= 0 ? [...items.slice(0, existingIndex), ...items.slice(existingIndex + 1), normalized] : [...items, normalized]
    return trimLog(next, limit)
  }

  function replaceByID<T extends { id: string }>(items: T[], entry: T, limit: number) {
    const next = [...items.filter((item) => item.id !== entry.id), entry]
    return trimLog(next, limit)
  }

  export async function recordObjective(input: {
    rootSessionID: string
    sessionID: string
    title: string
    note?: string
    messageID?: string
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
    const nextObjective: Objective = {
      id: current.objective?.title === normalizeText(input.title) ? current.objective.id : Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: input.messageID,
      at,
      title: normalizeText(input.title),
      ...(input.note ? { note: normalizeText(input.note) } : {}),
    }
    return write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID ?? current.latestMessageID,
      objective: nextObjective,
      latestSummary: summarize({
        ...current,
        objective: nextObjective,
        updatedAt: at,
        latestSessionID: input.sessionID,
        latestMessageID: input.messageID ?? current.latestMessageID,
      }),
    })
  }

  export async function addConstraint(input: {
    rootSessionID: string
    sessionID: string
    constraint: string
    messageID?: string
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
    const constraints = upsertString(current.constraints, input.constraint, maxConstraints)
    return write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID ?? current.latestMessageID,
      constraints,
      latestSummary: summarize({
        ...current,
        constraints,
        updatedAt: at,
        latestSessionID: input.sessionID,
        latestMessageID: input.messageID ?? current.latestMessageID,
      }),
    })
  }

  export async function addRisk(input: {
    rootSessionID: string
    sessionID: string
    statement: string
    severity?: Risk["severity"]
    note?: string
    messageID?: string
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
    const normalized = normalizeText(input.statement)
    const entry: Risk = {
      id: Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: input.messageID,
      at,
      statement: normalized,
      severity: input.severity ?? "medium",
      ...(input.note ? { note: normalizeText(input.note) } : {}),
    }
    const openRisks = replaceByID(
      current.openRisks.filter((item) => normalizeKey(item.statement) !== normalizeKey(normalized)),
      entry,
      maxOpenRisks,
    )
    return write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID ?? current.latestMessageID,
      openRisks,
      latestSummary: summarize({
        ...current,
        openRisks,
        updatedAt: at,
        latestSessionID: input.sessionID,
        latestMessageID: input.messageID ?? current.latestMessageID,
      }),
    })
  }

  async function recordReference(input: {
    rootSessionID: string
    sessionID: string
    messageID?: string
    at?: number
    reasoningID: string
    statement: string
    note?: string
    kind: "assumption" | "commitment"
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
    const entry: Reference = {
      id: Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: input.messageID,
      at,
      reasoningID: input.reasoningID,
      statement: normalizeText(input.statement),
      ...(input.note ? { note: normalizeText(input.note) } : {}),
    }
    const refs = input.kind === "assumption" ? current.assumptionRefs : current.commitmentRefs
    const nextRefs = replaceByID(refs.filter((item) => item.reasoningID !== input.reasoningID), entry, input.kind === "assumption" ? maxAssumptionRefs : maxCommitmentRefs)
    return write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID ?? current.latestMessageID,
      ...(input.kind === "assumption" ? { assumptionRefs: nextRefs } : { commitmentRefs: nextRefs }),
      latestSummary: summarize({
        ...current,
        ...(input.kind === "assumption" ? { assumptionRefs: nextRefs } : { commitmentRefs: nextRefs }),
        updatedAt: at,
        latestSessionID: input.sessionID,
        latestMessageID: input.messageID ?? current.latestMessageID,
      }),
    })
  }

  export async function recordAssumptionRef(input: {
    rootSessionID: string
    sessionID: string
    reasoningID: string
    statement: string
    note?: string
    messageID?: string
    at?: number
  }) {
    return recordReference({ ...input, kind: "assumption" })
  }

  export async function recordCommitmentRef(input: {
    rootSessionID: string
    sessionID: string
    reasoningID: string
    statement: string
    note?: string
    messageID?: string
    at?: number
  }) {
    return recordReference({ ...input, kind: "commitment" })
  }

  export async function recordTouchedFile(input: {
    rootSessionID: string
    sessionID: string
    path: string
    note?: string
    messageID?: string
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
    const entry: TouchedFile = {
      id: Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: input.messageID,
      at,
      path: normalizeText(input.path),
      ...(input.note ? { note: normalizeText(input.note) } : {}),
    }
    const touchedFiles = replaceByID(current.touchedFiles.filter((item) => normalizeKey(item.path) !== normalizeKey(entry.path)), entry, maxTouchedFiles)
    return write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID ?? current.latestMessageID,
      touchedFiles,
      latestSummary: summarize({
        ...current,
        touchedFiles,
        updatedAt: at,
        latestSessionID: input.sessionID,
        latestMessageID: input.messageID ?? current.latestMessageID,
      }),
    })
  }

  export async function recordOpenLoop(input: {
    rootSessionID: string
    sessionID: string
    summary: string
    note?: string
    verificationRequired?: boolean
    blockerReason?: string
    messageID?: string
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
    const normalizedSummary = normalizeText(input.summary)
    const existing = current.openLoops.find((item) => normalizeKey(item.summary) === normalizeKey(normalizedSummary))
    const entry: Loop = {
      id: existing?.id ?? Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: input.messageID,
      at,
      summary: normalizedSummary,
      status: "open",
      ...(input.note ? { note: normalizeText(input.note) } : {}),
    }
    const openLoops = replaceByID(current.openLoops.filter((item) => normalizeKey(item.summary) !== normalizeKey(entry.summary)), entry, maxOpenLoops)
    const written = await write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID ?? current.latestMessageID,
      openLoops,
      latestSummary: summarize({
        ...current,
        openLoops,
        updatedAt: at,
        latestSessionID: input.sessionID,
        latestMessageID: input.messageID ?? current.latestMessageID,
      }),
    })
    await SessionOpenLoops.recordLoop({
      rootSessionID: input.rootSessionID,
      sessionID: input.sessionID,
      loopID: entry.id,
      messageID: input.messageID,
      at,
      summary: entry.summary,
      verificationRequired: input.verificationRequired,
      blockerReason: input.blockerReason,
      status: input.blockerReason ? "blocked" : "open",
    })
    return written
  }

  export async function closeLoop(input: {
    rootSessionID: string
    sessionID: string
    loopID: string
    note?: string
    messageID?: string
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
    const openLoop = current.openLoops.find((item) => item.id === input.loopID)
    if (!openLoop) return current

    const closedLoop: Loop = {
      ...openLoop,
      sessionID: input.sessionID,
      messageID: input.messageID ?? openLoop.messageID,
      at: openLoop.at,
      status: "closed",
      closedAt: at,
      ...(input.note ? { note: normalizeText(input.note) } : openLoop.note ? { note: openLoop.note } : {}),
    }
    const openLoops = current.openLoops.filter((item) => item.id !== input.loopID)
    const closedLoops = replaceByID(
      current.closedLoops.filter((item) => item.id !== input.loopID),
      closedLoop,
      maxClosedLoops,
    )
    const written = await write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID ?? current.latestMessageID,
      openLoops,
      closedLoops,
      latestSummary: summarize({
        ...current,
        openLoops,
        closedLoops,
        updatedAt: at,
        latestSessionID: input.sessionID,
        latestMessageID: input.messageID ?? current.latestMessageID,
      }),
    })
    await SessionOpenLoops.resolveLoop({
      rootSessionID: input.rootSessionID,
      sessionID: input.sessionID,
      loopID: input.loopID,
      messageID: input.messageID,
      at,
      summary: closedLoop.summary,
    })
    return written
  }

  export function digest(input: { info: Info }): Materialized | undefined {
    const info = input.info
    const blocks: Block[] = []

    const objectiveBlock = info.objective
      ? block("Objective", [
          `- ${info.objective.title}`,
          info.objective.note ? `note: ${info.objective.note}` : undefined,
        ])
      : undefined
    if (objectiveBlock) blocks.push(objectiveBlock)

    const constraintsBlock = block("Constraints", info.constraints.map((constraint) => `- ${constraint}`))
    if (constraintsBlock) blocks.push(constraintsBlock)

    const openRisksBlock = block(
      "Open risks",
      info.openRisks.map((risk) => {
        const bits = [`- [${risk.severity}] ${risk.statement}`]
        if (risk.note) bits.push(`note=${risk.note}`)
        return bits.join(" | ")
      }),
    )
    if (openRisksBlock) blocks.push(openRisksBlock)

    const assumptionRefsBlock = block(
      "Assumption refs",
      info.assumptionRefs.map((ref) => {
        const bits = [`- [${ref.reasoningID}] ${ref.statement}`]
        if (ref.note) bits.push(`note=${ref.note}`)
        return bits.join(" | ")
      }),
    )
    if (assumptionRefsBlock) blocks.push(assumptionRefsBlock)

    const commitmentRefsBlock = block(
      "Commitment refs",
      info.commitmentRefs.map((ref) => {
        const bits = [`- [${ref.reasoningID}] ${ref.statement}`]
        if (ref.note) bits.push(`note=${ref.note}`)
        return bits.join(" | ")
      }),
    )
    if (commitmentRefsBlock) blocks.push(commitmentRefsBlock)

    const touchedFilesBlock = block(
      "Touched files",
      info.touchedFiles.map((file) => {
        const bits = [`- ${file.path}`]
        if (file.note) bits.push(`note=${file.note}`)
        return bits.join(" | ")
      }),
    )
    if (touchedFilesBlock) blocks.push(touchedFilesBlock)

    const openLoopsBlock = block(
      "Open loops",
      info.openLoops.map((loop) => {
        const bits = [`- [${loop.status}] ${loop.summary}`]
        if (loop.note) bits.push(`note=${loop.note}`)
        return bits.join(" | ")
      }),
    )
    if (openLoopsBlock) blocks.push(openLoopsBlock)

    const closedLoopsBlock = block(
      "Closed loops",
      info.closedLoops.map((loop) => {
        const bits = [`- [${loop.status}] ${loop.summary}`]
        if (loop.note) bits.push(`note=${loop.note}`)
        return bits.join(" | ")
      }),
    )
    if (closedLoopsBlock) blocks.push(closedLoopsBlock)

    const summaryBlock = block("Latest summary", [info.latestSummary !== emptySummary ? info.latestSummary : undefined])
    if (summaryBlock) blocks.push(summaryBlock)

    if (blocks.length === 0) return undefined
    return {
      rootSessionID: info.rootSessionID,
      blocks,
      text: blocks.map((item) => `## ${item.title}\n${item.text}`).join("\n\n"),
    }
  }

  export async function materialize(input: { rootSessionID: string }) {
    const info = await get(input.rootSessionID)
    if (!info) return undefined
    return digest({ info })
  }

}
