import { afterEach, describe, expect, test } from "bun:test"
import { RetrievalModelSupervisor } from "../../src/retrieval/model-supervisor"

describe("retrieval.model-supervisor", () => {
  afterEach(() => {
    RetrievalModelSupervisor.reset()
  })

  test("fails fast when the supervised process exits before the health check succeeds", async () => {
    let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined

    RetrievalModelSupervisor.configureTestHooks({
      healthCheck: async () => false,
      // @ts-ignore
      spawn: () => {
        queueMicrotask(() => onExit?.(1, null))
        return {
          pid: 9191,
          kill: () => true,
          once(event, listener) {
            // @ts-ignore
            if (event === "exit") onExit = listener
            return this
          },
        }
      },
    })

    await expect(
      RetrievalModelSupervisor.ensureReady({
        key: "reranking:test",
        kind: "reranking",
        endpoint: "http://127.0.0.1:8094/v1",
        healthURL: "http://127.0.0.1:8094/health",
        startupTimeoutMS: 1_000,
        healthCheckIntervalMS: 5,
        idleTimeoutMS: 0,
        command: "llama-server",
        args: ["--port", "8094"],
      }),
    ).rejects.toThrow("exited before becoming healthy")
  })

  test("dedupes supervised workers by lane health endpoint even when requested model keys differ", async () => {
    let healthy = false
    let spawnCount = 0

    RetrievalModelSupervisor.configureTestHooks({
      healthCheck: async () => healthy,
      spawn: () => {
        spawnCount += 1
        healthy = true
        const handle = {
          pid: 8282,
          kill: () => {
            healthy = false
            return true
          },
          once: (_event: "exit", _listener: (code: number | null, signal: NodeJS.Signals | null) => void) => handle as any,
        }
        return handle as any
      },
    })

    await RetrievalModelSupervisor.ensureReady({
      key: "reranking:local:qwen3-reranker-0.6b:http://127.0.0.1:8094/v1",
      kind: "reranking",
      endpoint: "http://127.0.0.1:8094/v1",
      healthURL: "http://127.0.0.1:8094/health",
      startupTimeoutMS: 1_000,
      healthCheckIntervalMS: 5,
      idleTimeoutMS: 0,
      command: "llama-server",
      args: ["--model", "C:\\models\\Qwen3-Reranker-0.6B-Q8_0.gguf", "--port", "8094"],
    })

    await RetrievalModelSupervisor.ensureReady({
      key: "reranking:local:qwen3-reranker-4b-gguf:http://127.0.0.1:8094/v1",
      kind: "reranking",
      endpoint: "http://127.0.0.1:8094/v1",
      healthURL: "http://127.0.0.1:8094/health",
      startupTimeoutMS: 1_000,
      healthCheckIntervalMS: 5,
      idleTimeoutMS: 0,
      command: "llama-server",
      args: ["--model", "C:\\models\\Qwen3-Reranker-4B-q4_k_m.gguf", "--port", "8094"],
    })

    expect(spawnCount).toBe(1)
  })
})
