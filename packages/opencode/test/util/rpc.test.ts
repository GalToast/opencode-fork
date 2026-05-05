import { afterEach, describe, expect, test } from "bun:test"
import { Rpc } from "../../src/util/rpc"

type MessageTarget = {
  onmessage: ((evt: MessageEvent<string>) => unknown) | null
  postMessage: (data: string) => void
}

const originalOnMessage = globalThis.onmessage
const originalPostMessage = globalThis.postMessage

function createClientTarget(): MessageTarget {
  return {
    onmessage: null,
    postMessage(data: string) {
      const handler = globalThis.onmessage
      if (!handler) throw new Error("RPC listener not installed")
      const evt = { data } as MessageEvent<string>
      void (handler as (evt: MessageEvent<string>) => unknown)(evt)
    },
  }
}

function installWorkerBridge(target: MessageTarget) {
  globalThis.postMessage = ((data: string) => {
    target.onmessage?.({ data } as MessageEvent<string>)
  }) as typeof globalThis.postMessage
}

afterEach(() => {
  globalThis.onmessage = originalOnMessage
  globalThis.postMessage = originalPostMessage
})

describe("Rpc", () => {
  test("propagates worker exceptions back to the caller", async () => {
    const target = createClientTarget()
    installWorkerBridge(target)

    Rpc.listen({
      async explode() {
        throw new Error("rpc boom")
      },
    })

    const client = Rpc.client<{ explode: (input: undefined) => Promise<void> }>(target as any)

    await expect(client.call("explode", undefined)).rejects.toThrow("rpc boom")
  })

  test("rejects unknown rpc methods instead of hanging forever", async () => {
    const target = createClientTarget()
    installWorkerBridge(target)

    Rpc.listen({})

    const client = Rpc.client<Record<string, (input: undefined) => Promise<void>>>(target as any)

    await expect(client.call("missing", undefined)).rejects.toThrow("Unknown RPC method: missing")
  })

  test("still resolves successful calls", async () => {
    const target = createClientTarget()
    installWorkerBridge(target)

    Rpc.listen({
      async fetch(input: { value: number }) {
        return { doubled: input.value * 2 }
      },
    })

    const client = Rpc.client<{ fetch: (input: { value: number }) => Promise<{ doubled: number }> }>(target as any)

    await expect(client.call("fetch", { value: 21 })).resolves.toEqual({ doubled: 42 })
  })
})
