import { GlobalBus } from "../../bus/global"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

export function WorkspaceServerRoutes() {
  return new Hono().get("/event", (c) => {
    c.header("X-Accel-Buffering", "no")
    c.header("X-Content-Type-Options", "nosniff")
    return streamSSE(c, (stream) => {
      const send = (event: unknown) => {
        void stream.writeSSE({
          data: JSON.stringify(event),
        })
      }
      const handler = (event: { directory?: string; payload: unknown }) => {
        void send(event.payload)
      }
      GlobalBus.on("event", handler)
      send({ type: "server.connected", properties: {} })
      const heartbeat = setInterval(() => {
        void send({ type: "server.heartbeat", properties: {} })
      }, 10_000)

      return new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat)
          GlobalBus.off("event", handler)
          resolve()
        })
      })
    })
  })
}
