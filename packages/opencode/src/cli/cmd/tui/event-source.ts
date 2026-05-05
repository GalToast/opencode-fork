import { GlobalBus } from "@/bus/global"
import type { Event } from "@opencode-ai/sdk/v2"
import type { EventSource } from "./context/sdk"

type WorkerEventClient = {
  on: <Data>(event: string, handler: (data: Data) => void) => () => void
}

type GlobalBusSource = {
  on: (
    event: "event",
    callback: (entry: { directory?: string; payload: any }) => void,
  ) => void
  off: (
    event: "event",
    callback: (entry: { directory?: string; payload: any }) => void,
  ) => void
}

function isEventEnvelope(value: unknown): value is Event {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string" &&
    "properties" in value
  )
}

function createEventDeduper(handler: (event: Event) => void, windowMs = 250) {
  const seen = new Map<string, number>()

  return (event: Event) => {
    const now = Date.now()
    const expiresBefore = now - windowMs

    for (const [key, timestamp] of seen) {
      if (timestamp >= expiresBefore) continue
      seen.delete(key)
    }

    const key = JSON.stringify(event)
    const previous = seen.get(key)
    if (previous !== undefined && previous >= expiresBefore) return

    seen.set(key, now)
    handler(event)
  }
}

export function createEventSource(
  client: WorkerEventClient,
  options?: {
    directory?: string
    globalBus?: GlobalBusSource
  },
): EventSource {
  const directory = options?.directory
  const globalBus = options?.globalBus ?? GlobalBus

  return {
    on: (handler) => {
      const emit = createEventDeduper(handler)
      const unsubWorker = client.on<Event>("event", emit)
      const onGlobalEvent = (entry: { directory?: string; payload: unknown }) => {
        if (directory && entry.directory && entry.directory !== directory) return
        if (!isEventEnvelope(entry.payload)) return
        emit(entry.payload)
      }
      globalBus.on("event", onGlobalEvent)

      return () => {
        unsubWorker()
        globalBus.off("event", onGlobalEvent)
      }
    },
  }
}
