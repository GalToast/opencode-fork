import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup, onMount } from "solid-js"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"

export type EventSource = {
  on: (handler: (event: Event) => void) => () => void
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    const sdk = createOpencodeClient({
      baseUrl: props.url,
      signal: abort.signal,
      directory: props.directory,
      fetch: props.fetch,
      headers: props.headers,
    })

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    let queue: Event[] = []
    let timer: Timer | undefined
    let last = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit(event.type, event)
        }
      })
    }

    const handleEvent = (event: Event) => {
      if (
        Flag.OPENCODE_DEBUG_PROMPT_TIMING &&
        (event.type === "message.updated" || event.type === "message.part.updated" || event.type === "message.part.delta")
      ) {
        Log.Default.info("tui sdk event received", {
          type: event.type,
          properties:
            event.type === "message.updated"
              ? {
                  sessionID: (event.properties as { info?: { sessionID?: string; id?: string; role?: string } } | undefined)?.info
                    ?.sessionID,
                  messageID: (event.properties as { info?: { sessionID?: string; id?: string; role?: string } } | undefined)?.info?.id,
                  role: (event.properties as { info?: { sessionID?: string; id?: string; role?: string } } | undefined)?.info?.role,
                }
              : event.type === "message.part.updated"
                ? {
                    sessionID: (event.properties as { part?: { sessionID?: string; messageID?: string; id?: string; type?: string } } | undefined)
                      ?.part?.sessionID,
                    messageID: (event.properties as { part?: { sessionID?: string; messageID?: string; id?: string; type?: string } } | undefined)
                      ?.part?.messageID,
                    partID: (event.properties as { part?: { sessionID?: string; messageID?: string; id?: string; type?: string } } | undefined)
                      ?.part?.id,
                    partType: (event.properties as { part?: { sessionID?: string; messageID?: string; id?: string; type?: string } } | undefined)
                      ?.part?.type,
                  }
                : {
                    messageID: (event.properties as { messageID?: string; partID?: string; field?: string } | undefined)?.messageID,
                    partID: (event.properties as { messageID?: string; partID?: string; field?: string } | undefined)?.partID,
                    field: (event.properties as { messageID?: string; partID?: string; field?: string } | undefined)?.field,
                  },
        })
      }
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    const startEventLoop = async () => {
      // If an event source is provided, use it instead of SSE
      if (props.events) {
        const unsub = props.events.on(handleEvent)
        onCleanup(unsub)
        return
      }

      // Fall back to SSE
      while (true) {
        if (abort.signal.aborted) break
        const events = await sdk.event.subscribe(
          {},
          {
            signal: abort.signal,
          },
        )

        for await (const event of events.stream) {
          handleEvent(event)
        }

        // Flush any remaining events
        if (timer) clearTimeout(timer)
        if (queue.length > 0) {
          flush()
        }
      }
    }

    onMount(() => {
      void startEventLoop()
    })

    onCleanup(() => {
      abort.abort()
      if (timer) clearTimeout(timer)
    })

    return { client: sdk, event: emitter, url: props.url }
  },
})

export type SDKContext = ReturnType<typeof useSDK>
