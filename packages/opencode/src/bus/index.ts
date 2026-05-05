import z from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { BusEvent, type BusEventDefinition } from "./bus-event"
import { GlobalBus } from "./global"
import { Effect, Layer, ServiceMap } from "effect"

const log = Log.create({ service: "bus" })

type BusPayload<Definition extends BusEventDefinition> = {
  type: Definition["type"]
  properties: z.infer<Definition["properties"]>
}

type Subscription = (event: unknown) => void

const InstanceDisposed = BusEvent.define(
  "server.instance.disposed",
  z.object({
    directory: z.string(),
  }),
)

const state = Instance.state(
  () => {
    const subscriptions = new Map<string, Subscription[]>()

    return {
      subscriptions,
    }
  },
  (entry) => {
    const wildcard = entry.subscriptions.get("*")
    if (!wildcard) return Promise.resolve()
    const event = {
      type: InstanceDisposed.type,
      properties: {
        directory: Instance.directory,
      },
    }
    for (const sub of [...wildcard]) {
      sub(event)
    }
    return Promise.resolve()
  },
)

async function publish<Definition extends BusEventDefinition>(def: Definition, properties: z.output<Definition["properties"]>) {
  const payload: BusPayload<Definition> = {
    type: def.type,
    properties,
  }
  log.info("publishing", {
    type: def.type,
  })
  const pending: Array<Promise<void>> = []
  try {
    for (const key of [def.type, "*"]) {
      const subscriptions = state().subscriptions.get(key)
      for (const sub of subscriptions ?? []) {
        pending.push(Promise.resolve(sub(payload)).then(() => undefined))
      }
    }
  } catch (error) {
    log.warn("skipping instance subscriptions", { type: def.type, error })
  }
  try {
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload,
    })
  } catch (error) {
    log.warn("skipping global bus emit", { type: def.type, error })
  }
  return Promise.all(pending)
}

function subscribe<Definition extends BusEventDefinition>(
  def: Definition,
  callback: (event: BusPayload<Definition>) => void,
) {
  return raw(def.type, (event) => callback(event as BusPayload<Definition>))
}

function once<Definition extends BusEventDefinition>(
  def: Definition,
  callback: (event: BusPayload<Definition>) => "done" | undefined,
) {
  const unsub = subscribe(def, (event) => {
    if (callback(event)) unsub()
  })
}

function subscribeAll(callback: (event: unknown) => void) {
  return raw("*", callback)
}

function raw(type: string, callback: (event: unknown) => void) {
  log.info("subscribing", { type })
  const subscriptions = state().subscriptions
  const matches = subscriptions.get(type) ?? []
  matches.push(callback)
  subscriptions.set(type, matches)

  return () => {
    log.info("unsubscribing", { type })
    const activeSubscriptions = subscriptions.get(type)
    if (!activeSubscriptions) return
    const index = activeSubscriptions.indexOf(callback)
    if (index === -1) return
    activeSubscriptions.splice(index, 1)
  }
}

interface Interface {
  readonly publish: <Definition extends BusEventDefinition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) => Effect.Effect<void[]>
  readonly subscribe: <Definition extends BusEventDefinition>(
    def: Definition,
    callback: (event: BusPayload<Definition>) => void,
  ) => Effect.Effect<() => void>
  readonly subscribeCallback: <Definition extends BusEventDefinition>(
    def: Definition,
    callback: (event: BusPayload<Definition>) => void,
  ) => Effect.Effect<() => void>
  readonly once: <Definition extends BusEventDefinition>(
    def: Definition,
    callback: (event: BusPayload<Definition>) => "done" | undefined,
  ) => Effect.Effect<void>
  readonly subscribeAll: (callback: (event: unknown) => void) => Effect.Effect<() => void>
}

class BusService extends ServiceMap.Service<BusService, Interface>()("@opencode/Bus") {}

const layer = Layer.succeed(
  BusService,
  BusService.of({
    publish: (def, properties) => Effect.promise(() => publish(def, properties)),
    subscribe: (def, callback) => Effect.sync(() => subscribe(def, callback)),
    subscribeCallback: (def, callback) => Effect.sync(() => subscribe(def, callback)),
    once: (def, callback) => Effect.sync(() => once(def, callback)),
    subscribeAll: (callback) => Effect.sync(() => subscribeAll(callback)),
  }),
)

export const Bus = {
  Service: BusService,
  layer,
  defaultLayer: layer,
  InstanceDisposed,
  publish,
  subscribe,
  once,
  subscribeAll,
}
