type Definition = {
  [method: string]: (input: any) => any
}

type ErrorPayload = {
  name: string
  message: string
  stack?: string
  code?: string
}

type RpcRequest = {
  type: "rpc.request"
  method: string
  input: unknown
  id: number
}

type RpcResult = {
  type: "rpc.result"
  result: unknown
  id: number
}

type RpcError = {
  type: "rpc.error"
  error: ErrorPayload
  id: number
}

type RpcEvent = {
  type: "rpc.event"
  event: string
  data: unknown
}

type RpcMessage = RpcRequest | RpcResult | RpcError | RpcEvent

type RpcTarget = {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<string>) => unknown) | null
}

function serializeError(error: unknown): ErrorPayload {
  if (error instanceof Error) {
    const payload: ErrorPayload = {
      name: error.name,
      message: error.message,
    }
    if (error.stack) payload.stack = error.stack
    if ("code" in error && error.code !== undefined) payload.code = typeof error.code === "string" ? error.code : JSON.stringify(error.code)
    return payload
  }
  return {
    name: "Error",
    message: typeof error === "string" ? error : JSON.stringify(error),
  }
}

function deserializeError(payload: ErrorPayload) {
  const error = new Error(payload.message)
  error.name = payload.name || "Error"
  if (payload.stack) error.stack = payload.stack
  if (payload.code) {
    Object.assign(error, {
      code: payload.code,
    })
  }
  return error
}

function parseMessage(raw: string): RpcMessage {
  return JSON.parse(raw) as RpcMessage
}

function listen(rpc: Definition) {
  onmessage = async (evt: MessageEvent<string>) => {
    const parsed = parseMessage(evt.data)
    if (parsed.type !== "rpc.request") return

    const method = rpc[parsed.method]
    if (typeof method !== "function") {
      postMessage(
        JSON.stringify({
          type: "rpc.error",
          error: serializeError(new Error(`Unknown RPC method: ${parsed.method}`)),
          id: parsed.id,
        } satisfies RpcError),
      )
      return
    }

    try {
      const result = await method(parsed.input)
      postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id } satisfies RpcResult))
    } catch (error) {
      postMessage(JSON.stringify({ type: "rpc.error", error: serializeError(error), id: parsed.id } satisfies RpcError))
    }
  }
}

function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data } satisfies RpcEvent))
}

function client<T extends Definition>(target: RpcTarget) {
  const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: unknown) => void }>()
  const listeners = new Map<string, Set<(data: unknown) => void>>()
  let id = 0

  target.onmessage = (evt: MessageEvent<string>) => {
    const parsed = parseMessage(evt.data)
    if (parsed.type === "rpc.result") {
      const entry = pending.get(parsed.id)
      if (entry) {
        entry.resolve(parsed.result)
        pending.delete(parsed.id)
      }
      return
    }
    if (parsed.type === "rpc.error") {
      const entry = pending.get(parsed.id)
      if (entry) {
        entry.reject(deserializeError(parsed.error))
        pending.delete(parsed.id)
      }
      return
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
        }
      }
    }
  }

  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<Awaited<ReturnType<T[Method]>>> {
      const requestId = id++
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve: resolve as (result: unknown) => void, reject })
        try {
          target.postMessage(JSON.stringify({ type: "rpc.request", method: String(method), input, id: requestId } satisfies RpcRequest))
        } catch (error) {
          pending.delete(requestId)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    on<Data>(event: string, handler: (data: Data) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set<(data: unknown) => void>()
        listeners.set(event, handlers)
      }
      handlers.add(handler as (data: unknown) => void)
      return () => {
        handlers.delete(handler as (data: unknown) => void)
      }
    },
  }
}

export const Rpc = {
  listen,
  emit,
  client,
}
