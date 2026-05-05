import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import z from "zod"

/* eslint-disable-next-line @typescript-eslint/no-namespace */
export namespace SessionSocialMemory {
  const maxPairings = 12
  const maxHandoffs = 12
  const maxStalls = 12
  const emptySummary = "No social memory captured yet."

  export const Pairing = z
    .object({
      id: Identifier.schema("part"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
      at: z.number(),
      pattern: z.string(),
      note: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .meta({ ref: "SessionSocialMemoryPairing" })
  export type Pairing = z.infer<typeof Pairing>

  export const Handoff = z
    .object({
      id: Identifier.schema("part"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
      at: z.number(),
      pattern: z.string(),
      note: z.string().optional(),
    })
    .meta({ ref: "SessionSocialMemoryHandoff" })
  export type Handoff = z.infer<typeof Handoff>

  export const Stall = z
    .object({
      id: Identifier.schema("part"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
      at: z.number(),
      pattern: z.string(),
      note: z.string().optional(),
      severity: z.enum(["low", "medium", "high"]).optional(),
    })
    .meta({ ref: "SessionSocialMemoryStall" })
  export type Stall = z.infer<typeof Stall>

  export const Info = z
    .object({
      rootSessionID: Identifier.schema("session"),
      createdAt: z.number(),
      updatedAt: z.number(),
      latestSessionID: Identifier.schema("session"),
      latestMessageID: Identifier.schema("message").optional(),
      successfulPairings: z.array(Pairing),
      handoffPatterns: z.array(Handoff),
      stallPatterns: z.array(Stall),
      latestSummary: z.string(),
    })
    .meta({ ref: "SessionSocialMemory" })
  export type Info = z.infer<typeof Info>

  export const Block = z
    .object({
      type: z.literal("text"),
      title: z.string(),
      text: z.string(),
    })
    .meta({ ref: "SessionSocialMemoryBlock" })
  export type Block = z.infer<typeof Block>

  export const Materialized = z
    .object({
      rootSessionID: Identifier.schema("session"),
      blocks: z.array(Block),
      text: z.string(),
    })
    .meta({ ref: "SessionSocialMemoryMaterialized" })
  export type Materialized = z.infer<typeof Materialized>

  export const Event = {
    Updated: BusEvent.define(
      "session.social-memory.updated",
      z.object({
        info: Info,
      }),
    ),
  }

  function key(rootSessionID: string) {
    return ["social_memory", rootSessionID]
  }

  function normalizeText(value: string) {
    return value.trim().replace(/\s+/g, " ")
  }

  function normalizeKey(value: string) {
    return normalizeText(value).toLowerCase()
  }

  function trimLog<T>(items: T[], limit: number) {
    return items.slice(Math.max(0, items.length - limit))
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

  function fallback(input: { rootSessionID: string; sessionID: string; at: number; messageID?: string }): Info {
    return {
      rootSessionID: input.rootSessionID,
      createdAt: input.at,
      updatedAt: input.at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID,
      successfulPairings: [],
      handoffPatterns: [],
      stallPatterns: [],
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
    const parts = [
      info.successfulPairings.length > 0 ? `pairings=${info.successfulPairings.length}` : undefined,
      info.handoffPatterns.length > 0 ? `handoffs=${info.handoffPatterns.length}` : undefined,
      info.stallPatterns.length > 0 ? `stalls=${info.stallPatterns.length}` : undefined,
    ].filter((item): item is string => !!item)
    return parts.length > 0 ? parts.join(" | ") : emptySummary
  }

  function replaceByPattern<T extends { pattern: string }>(items: T[], entry: T, limit: number) {
    const next = [...items.filter((item) => normalizeKey(item.pattern) !== normalizeKey(entry.pattern)), entry]
    return trimLog(next, limit)
  }

  export async function recordSuccessfulPairing(input: {
    rootSessionID: string
    sessionID: string
    pattern: string
    note?: string
    confidence?: number
    messageID?: string
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
    const entry: Pairing = {
      id: Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: input.messageID,
      at,
      pattern: normalizeText(input.pattern),
      ...(input.note ? { note: normalizeText(input.note) } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    }
    const successfulPairings = replaceByPattern(current.successfulPairings, entry, maxPairings)
    return write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID ?? current.latestMessageID,
      successfulPairings,
      latestSummary: summarize({ ...current, successfulPairings }),
    })
  }

  export async function recordHandoffPattern(input: {
    rootSessionID: string
    sessionID: string
    pattern: string
    note?: string
    messageID?: string
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
    const entry: Handoff = {
      id: Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: input.messageID,
      at,
      pattern: normalizeText(input.pattern),
      ...(input.note ? { note: normalizeText(input.note) } : {}),
    }
    const handoffPatterns = replaceByPattern(current.handoffPatterns, entry, maxHandoffs)
    return write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID ?? current.latestMessageID,
      handoffPatterns,
      latestSummary: summarize({ ...current, handoffPatterns }),
    })
  }

  export async function recordStallPattern(input: {
    rootSessionID: string
    sessionID: string
    pattern: string
    note?: string
    severity?: Stall["severity"]
    messageID?: string
    at?: number
  }) {
    const at = input.at ?? Date.now()
    const current = (await get(input.rootSessionID)) ?? fallback({ ...input, at })
    const entry: Stall = {
      id: Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: input.messageID,
      at,
      pattern: normalizeText(input.pattern),
      ...(input.note ? { note: normalizeText(input.note) } : {}),
      ...(input.severity ? { severity: input.severity } : {}),
    }
    const stallPatterns = replaceByPattern(current.stallPatterns, entry, maxStalls)
    return write({
      ...current,
      updatedAt: at,
      latestSessionID: input.sessionID,
      latestMessageID: input.messageID ?? current.latestMessageID,
      stallPatterns,
      latestSummary: summarize({ ...current, stallPatterns }),
    })
  }

  export function digest(input: { info: Info }): Materialized | undefined {
    const blocks: Block[] = []
    const pairings = block(
      "Successful pairings",
      input.info.successfulPairings.map((item) => {
        const bits = [`- ${item.pattern}`]
        if (item.note) bits.push(`note=${item.note}`)
        if (item.confidence !== undefined) bits.push(`confidence=${item.confidence.toFixed(2)}`)
        return bits.join(" | ")
      }),
    )
    if (pairings) blocks.push(pairings)

    const handoffs = block(
      "Handoff patterns",
      input.info.handoffPatterns.map((item) => {
        const bits = [`- ${item.pattern}`]
        if (item.note) bits.push(`note=${item.note}`)
        return bits.join(" | ")
      }),
    )
    if (handoffs) blocks.push(handoffs)

    const stalls = block(
      "Stall patterns",
      input.info.stallPatterns.map((item) => {
        const bits = [`- ${item.pattern}`]
        if (item.severity) bits.push(`severity=${item.severity}`)
        if (item.note) bits.push(`note=${item.note}`)
        return bits.join(" | ")
      }),
    )
    if (stalls) blocks.push(stalls)

    const summary = block("Latest summary", [input.info.latestSummary !== emptySummary ? input.info.latestSummary : undefined])
    if (summary) blocks.push(summary)

    if (blocks.length === 0) return undefined
    return {
      rootSessionID: input.info.rootSessionID,
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
