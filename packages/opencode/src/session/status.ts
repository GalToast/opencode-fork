/* eslint-disable @typescript-eslint/no-namespace */

import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"

export namespace SessionStatus {
  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
      z.object({
        type: z.literal("busy"),
      }),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: z.string(),
        status: Info,
      }),
    ),
    // deprecated
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  const state = Instance.state(() => {
    const data: Record<string, Info> = {}
    return data
  })

  export function get(sessionID: string) {
    return (
      state()[sessionID] ?? {
        type: "idle",
      }
    )
  }

  export function list() {
    return state()
  }

  function apply(sessionID: string, status: Info) {
    if (status.type === "idle") {
      delete state()[sessionID]
      return
    }
    state()[sessionID] = status
  }

  export async function set(sessionID: string, status: Info) {
    await Bus.publish(Event.Status, {
      sessionID,
      status,
    })
    if (status.type === "idle") {
      // deprecated
      await Bus.publish(Event.Idle, {
        sessionID,
      })
    }
    apply(sessionID, status)
  }

  export interface Interface {
    readonly get: (sessionID: string) => Effect.Effect<Info>
    readonly list: () => Effect.Effect<Record<string, Info>>
    readonly set: (sessionID: string, status: Info) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/SessionStatus") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const data: Record<string, Info> = {}
      const publish = (status: Info, sessionID: string) =>
        Effect.gen(function* () {
          yield* bus.publish(Event.Status, { sessionID, status }).pipe(Effect.ignore)
          if (status.type === "idle") {
            yield* bus.publish(Event.Idle, { sessionID }).pipe(Effect.ignore)
          }
        })
      const applyLocal = (sessionID: string, status: Info) => {
        if (status.type === "idle") delete data[sessionID]
        else data[sessionID] = status
      }
      return Service.of({
        get: (sessionID) =>
          Effect.sync(
            () =>
              data[sessionID] ?? {
                type: "idle",
              },
          ),
        list: () => Effect.sync(() => data),
        set: (sessionID, status) =>
          Effect.gen(function* () {
            yield* publish(status, sessionID)
            applyLocal(sessionID, status)
          }),
      })
    }),
  )

  export const defaultLayer = layer
}
