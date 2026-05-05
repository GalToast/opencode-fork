import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import z from "zod"
import { Bus } from "../../src/bus"
import { BusEvent, type BusEventDefinition } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { provideInstance, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// Local type alias mirroring BusPayload (not exported from src)
type BusPayloadLocal<D extends BusEventDefinition> = { type: D["type"]; properties: z.infer<D["properties"]> }
type AnyBusPayload = { type: string; properties: unknown }

const TestEvent = {
  Ping: BusEvent.define("test.effect.ping", z.object({ value: z.number() })),
  Pong: BusEvent.define("test.effect.pong", z.object({ message: z.string() })),
}

const node = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)

const live = Layer.mergeAll(Bus.layer, node)

const it = testEffect(live)

describe("Bus (Effect-native)", () => {
  it.live("publish + subscribe callback delivers events", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const received: number[] = []
        const done = yield* Deferred.make<void>()

        const unsub = yield* bus.subscribe(TestEvent.Ping, (evt) => {
          const e = evt as BusPayloadLocal<typeof TestEvent.Ping>
          received.push(e.properties.value)
          if (received.length === 2) Deferred.doneUnsafe(done, Effect.void)
        })

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* bus.publish(TestEvent.Ping, { value: 2 })
        yield* Deferred.await(done)
        unsub()

        expect(received).toEqual([1, 2])
      }),
    ),
  )

  it.live("subscribe filters by event type", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const pings: number[] = []
        const done = yield* Deferred.make<void>()

        const unsub = yield* bus.subscribe(TestEvent.Ping, (evt) => {
          const e = evt as BusPayloadLocal<typeof TestEvent.Ping>
          pings.push(e.properties.value)
          Deferred.doneUnsafe(done, Effect.void)
        })

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Pong, { message: "ignored" })
        yield* bus.publish(TestEvent.Ping, { value: 42 })
        yield* Deferred.await(done)
        unsub()

        expect(pings).toEqual([42])
      }),
    ),
  )

  it.live("subscribeAll receives all types", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const types: string[] = []
        const done = yield* Deferred.make<void>()

        const unsub = yield* bus.subscribeAll((evt) => {
          const event = evt as AnyBusPayload
          types.push(event.type)
          if (types.length === 2) Deferred.doneUnsafe(done, Effect.void)
        })

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* bus.publish(TestEvent.Pong, { message: "hi" })
        yield* Deferred.await(done)
        unsub()

        expect(types).toContain("test.effect.ping")
        expect(types).toContain("test.effect.pong")
      }),
    ),
  )

  it.live("multiple subscribers each receive the event", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const a: number[] = []
        const b: number[] = []
        const doneA = yield* Deferred.make<void>()
        const doneB = yield* Deferred.make<void>()

        const unsubA = yield* bus.subscribe(TestEvent.Ping, (evt) => {
          const e = evt as BusPayloadLocal<typeof TestEvent.Ping>
          a.push(e.properties.value)
          Deferred.doneUnsafe(doneA, Effect.void)
        })

        const unsubB = yield* bus.subscribe(TestEvent.Ping, (evt) => {
          const e = evt as BusPayloadLocal<typeof TestEvent.Ping>
          b.push(e.properties.value)
          Deferred.doneUnsafe(doneB, Effect.void)
        })

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 99 })
        yield* Deferred.await(doneA)
        yield* Deferred.await(doneB)
        unsubA()
        unsubB()

        expect(a).toEqual([99])
        expect(b).toEqual([99])
      }),
    ),
  )

  it.live("subscribeAll callback sees InstanceDisposed on disposal", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const types: string[] = []
      const seen = yield* Deferred.make<void>()
      const disposed = yield* Deferred.make<void>()

      // Set up subscriber inside the instance
      yield* Effect.gen(function* () {
        const bus = yield* Bus.Service

        yield* bus.subscribeAll((evt) => {
          const event = evt as AnyBusPayload
          types.push(event.type)
          if (event.type === TestEvent.Ping.type) Deferred.doneUnsafe(seen, Effect.void)
          if (event.type === Bus.InstanceDisposed.type) Deferred.doneUnsafe(disposed, Effect.void)
        })

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* Deferred.await(seen)
      }).pipe(provideInstance(dir))

      // Dispose from OUTSIDE the instance scope
      yield* Effect.promise(() => Instance.disposeAll())
      yield* Deferred.await(disposed).pipe(Effect.timeout("2 seconds"))

      expect(types).toContain("test.effect.ping")
      expect(types).toContain(Bus.InstanceDisposed.type)
    }),
  )
})
