/* eslint-disable @typescript-eslint/no-namespace */

import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import z from "zod"

export namespace SessionForeground {
  export const Responder = z
    .object({
      agent: z.string().optional(),
      providerID: z.string().optional(),
      modelID: z.string().optional(),
    })
    .meta({
      ref: "SessionForegroundResponder",
    })
  export type Responder = z.infer<typeof Responder>

  export const State = z.enum(["idle", "accepting", "responding", "steering"]).meta({
    ref: "SessionForegroundState",
  })
  export type State = z.infer<typeof State>

  export const Steer = z
    .object({
      stage: z.enum(["received", "applied"]),
      at: z.number(),
      pending: z.number().int().min(0),
      messageID: Identifier.schema("message").optional(),
      latencyMS: z.number().int().min(0).optional(),
    })
    .meta({
      ref: "SessionForegroundSteer",
    })
  export type Steer = z.infer<typeof Steer>

  export const Info = z
    .object({
      rootSessionID: Identifier.schema("session"),
      latestSessionID: Identifier.schema("session"),
      pendingSessionID: Identifier.schema("session").optional(),
      latestMessageID: Identifier.schema("message").optional(),
      latestUserIntent: z.string(),
      latestResponder: Responder.optional(),
      state: State,
      awaitingPromotion: z.boolean(),
      activeSessionID: Identifier.schema("session").optional(),
      activeTurnID: z.string().optional(),
      activeResponder: Responder.optional(),
      acceptedAt: z.number().optional(),
      promotedAt: z.number().optional(),
      completedAt: z.number().optional(),
      steer: Steer.optional(),
    })
    .meta({
      ref: "SessionForeground",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "session.foreground.updated",
      z.object({
        info: Info,
      }),
    ),
  }

  const state = Instance.state(() => {
    return {
      roots: {} as Record<string, string>,
      info: {} as Record<string, Info>,
    }
  })

  function rootFor(sessionID: string, rootSessionID?: string) {
    const root = rootSessionID ?? state().roots[sessionID] ?? sessionID
    state().roots[sessionID] = root
    return root
  }

  function fallback(rootSessionID: string): Info {
    return {
      rootSessionID,
      latestSessionID: rootSessionID,
      latestUserIntent: "No user intent captured yet.",
      state: "idle",
      awaitingPromotion: false,
    }
  }

  function resolveVisibleSessionID(input: Pick<Info, "rootSessionID" | "pendingSessionID" | "activeSessionID" | "latestSessionID">) {
    return input.activeSessionID ?? input.pendingSessionID ?? input.latestSessionID ?? input.rootSessionID
  }

  function normalizeInfo(info: Info, preferredLatestSessionID?: string): Info {
    const latestSessionID =
      info.activeSessionID ??
      info.pendingSessionID ??
      preferredLatestSessionID ??
      info.latestSessionID ??
      info.rootSessionID
    return {
      ...info,
      latestSessionID,
    }
  }

  function deriveState(input: {
    awaitingPromotion: boolean
    activeTurnID?: string
    steer?: Steer
  }): State {
    if ((input.steer?.pending ?? 0) > 0 || input.steer?.stage === "received") return "steering"
    if (input.awaitingPromotion) return "accepting"
    if (input.activeTurnID) return "responding"
    return "idle"
  }

  async function publish(info: Info) {
    state().info[info.rootSessionID] = info
    await Bus.publish(Event.Updated, { info })
    return info
  }

  export function list() {
    return state().info
  }

  export function get(rootSessionID: string) {
    return state().info[rootSessionID]
  }

  export function registerSessionRoot(input: { sessionID: string; rootSessionID: string }) {
    state().roots[input.sessionID] = input.rootSessionID
  }

  export async function accept(input: {
    sessionID: string
    rootSessionID?: string
    messageID?: string
    intent?: string
    responder?: Responder
    acceptedAt?: number
  }) {
    const rootSessionID = rootFor(input.sessionID, input.rootSessionID)
    const current = get(rootSessionID) ?? fallback(rootSessionID)
    const info: Info = {
      ...current,
      rootSessionID,
      latestSessionID: input.sessionID,
      pendingSessionID: input.sessionID,
      latestMessageID: input.messageID,
      latestUserIntent: input.intent?.trim() || current.latestUserIntent,
      latestResponder: input.responder ?? current.latestResponder,
      awaitingPromotion: true,
      acceptedAt: input.acceptedAt ?? Date.now(),
    }
    const normalized = normalizeInfo(info, input.sessionID)
    normalized.state = deriveState(normalized)
    return publish(normalized)
  }

  export async function promote(input: {
    sessionID: string
    rootSessionID?: string
    turnID: string
    promotedAt?: number
  }) {
    const rootSessionID = rootFor(input.sessionID, input.rootSessionID)
    const current = get(rootSessionID) ?? fallback(rootSessionID)
    const info: Info = {
      ...current,
      rootSessionID,
      latestSessionID: input.sessionID,
      pendingSessionID: undefined,
      awaitingPromotion: false,
      activeSessionID: input.sessionID,
      activeTurnID: input.turnID,
      activeResponder: current.latestResponder ?? current.activeResponder,
      promotedAt: input.promotedAt ?? Date.now(),
    }
    const normalized = normalizeInfo(info, input.sessionID)
    normalized.state = deriveState(normalized)
    return publish(normalized)
  }

  export async function steer(input: {
    sessionID: string
    rootSessionID?: string
    stage: "received" | "applied"
    at: number
    pending: number
    messageID?: string
    latencyMS?: number
  }) {
    const rootSessionID = rootFor(input.sessionID, input.rootSessionID)
    const current = get(rootSessionID) ?? fallback(rootSessionID)
    const nextSteer = {
      stage: input.stage,
      at: input.at,
      pending: input.pending,
      ...(input.messageID ? { messageID: input.messageID } : {}),
      ...(input.latencyMS !== undefined ? { latencyMS: input.latencyMS } : {}),
    } satisfies Steer
    const info: Info = {
      ...current,
      rootSessionID,
      latestSessionID: resolveVisibleSessionID(current),
      steer: nextSteer.pending > 0 || nextSteer.stage === "received" ? nextSteer : undefined,
    }
    const normalized = normalizeInfo(info)
    normalized.state = deriveState(normalized)
    return publish(normalized)
  }

  export async function settle(input: {
    sessionID: string
    rootSessionID?: string
    turnID?: string
    completedAt?: number
  }) {
    const rootSessionID = rootFor(input.sessionID, input.rootSessionID)
    const current = get(rootSessionID) ?? fallback(rootSessionID)
    const matchesActiveTurn = !input.turnID || current.activeTurnID === input.turnID
    const clearsPendingSession = current.pendingSessionID === input.sessionID
    const info: Info = {
      ...current,
      rootSessionID,
      completedAt: input.completedAt ?? Date.now(),
      ...(clearsPendingSession
        ? {
            pendingSessionID: undefined,
            awaitingPromotion: false,
          }
        : {}),
      ...(matchesActiveTurn
        ? {
            activeSessionID: undefined,
            activeTurnID: undefined,
            activeResponder: undefined,
          }
        : {}),
    }
    const normalized = normalizeInfo(info)
    normalized.state = deriveState(normalized)
    return publish(normalized)
  }

  export async function clear(input: { sessionID: string; rootSessionID?: string }) {
    const rootSessionID = rootFor(input.sessionID, input.rootSessionID)
    const current = get(rootSessionID) ?? fallback(rootSessionID)
    const clearsActiveSession = current.activeSessionID === input.sessionID
    const clearsPendingSession = current.pendingSessionID === input.sessionID
    const info: Info = {
      ...current,
      rootSessionID,
      completedAt: Date.now(),
      ...(clearsPendingSession
        ? {
            pendingSessionID: undefined,
            awaitingPromotion: false,
          }
        : {}),
      ...(clearsActiveSession
        ? {
            activeSessionID: undefined,
            activeTurnID: undefined,
            activeResponder: undefined,
            steer: undefined,
          }
        : {}),
    }
    const normalized = normalizeInfo(info)
    normalized.state = deriveState(normalized)
    return publish(normalized)
  }
}
