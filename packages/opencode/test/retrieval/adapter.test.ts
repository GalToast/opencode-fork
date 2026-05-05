import { afterEach, describe, expect, mock, test } from "bun:test"
import { Auth } from "../../src/auth"
import { Instance } from "../../src/project/instance"
import { configureRetrievalRuntime, resetRetrievalRuntimeConfiguration } from "../../src/retrieval/adapter"
import { RetrievalModelSupervisor } from "../../src/retrieval/model-supervisor"
import { RetrievalRuntime } from "../../src/retrieval/runtime"
import { tmpdir } from "../fixture/fixture"

const originalAuthGet = Auth.get

describe("retrieval.adapter", () => {
  afterEach(() => {
    resetRetrievalRuntimeConfiguration()
    RetrievalRuntime.reset()
    RetrievalModelSupervisor.reset()
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_BASE_URL
    delete process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_COMMAND
    delete process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_ARGS
    delete process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_HEALTH_URL
    delete process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_IDLE_TIMEOUT_MS
    delete process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_HEALTHCHECK_INTERVAL_MS
    delete process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_STARTUP_TIMEOUT_MS
    Auth.get = originalAuthGet
    mock.restore()
  })

  test("sends policy-configured embedding instructions and output settings to the endpoint", async () => {
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe("qwen3-embedding-4b-gguf")
      expect(body.input).toBe("orchard relay memory")
      expect(body.instruction).toContain("Retrieve prior decisions")
      expect(body.instruction).toContain("constraints")
      expect(body.instruction).toContain("index-space")
      expect(body.dimensions).toBe(1024)
      expect(body.output_type).toBe("dense")
      expect(body.task).toBe("semantic_recall")
      expect(body.purpose).toBe("query")
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer test-key",
      })

      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.1, 0.2, 0.7] }],
          model: "qwen3-embedding-4b-gguf",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await configureRetrievalRuntime()

        const result = await RetrievalRuntime.embedText({
          text: "orchard relay memory",
          purpose: "query",
          policy: {
            name: "quality",
            embedder: {
              providerID: "local" as any,
              modelID: "qwen3-embedding-4b-gguf" as any,
              instructionPreset: "memory.decision",
              dimensions: 1024,
              outputType: "dense",
              settings: {
                baseURL: "http://retrieval.local/v1",
                apiKey: "test-key",
                task: "semantic_recall",
              },
            },
          },
        })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(result.metadata?.source).toBe("provider")
        expect(result.metadata?.instructionPreset).toBe("memory.decision")
        expect(result.dimensions).toBe(3)
      },
    })
  })

  test("sends policy-configured rerank instructions to the endpoint", async () => {
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe("qwen3-reranker-0.6b")
      expect(body.query).toBe("find the prior recovery")
      expect(body.documents).toEqual(["First candidate", "Second candidate"])
      expect(body.instruction).toBe("Rank prior recoveries that best match the current failure.")
      expect(body.output_type).toBe("score")

      return new Response(
        JSON.stringify({
          results: [
            { index: 0, relevance_score: 0.9 },
            { index: 1, relevance_score: 0.2 },
          ],
          model: "qwen3-reranker-0.6b",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await configureRetrievalRuntime()

        const result = await RetrievalRuntime.rerank({
          queryText: "find the prior recovery",
          queryVector: [1, 0, 0],
          candidateVectors: new Map([
            ["a", [1, 0, 0]],
            ["b", [0, 1, 0]],
          ]),
          candidates: [
            { chunkID: "a", documentID: "doc-a", sourceType: "note", content: "First candidate", score: 5 },
            { chunkID: "b", documentID: "doc-b", sourceType: "note", content: "Second candidate", score: 1 },
          ],
          policy: {
            name: "fast",
            reranker: {
              providerID: "local" as any,
              modelID: "qwen3-reranker-0.6b" as any,
              instruction: "Rank prior recoveries that best match the current failure.",
              outputType: "score",
              settings: {
                baseURL: "http://retrieval.local/v1",
              },
            },
          },
        })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(result.metadata?.source).toBe("provider")
        expect(result.metadata?.instruction).toBe("Rank prior recoveries that best match the current failure.")
        expect(result.candidates[0]?.chunkID).toBe("a")
        // @ts-ignore
        expect(result.candidates[0]?.rerankScore).toBeGreaterThan(result.candidates[1]?.rerankScore ?? 0)
      },
    })
  })

  test("resolves rerank instruction presets into concrete qwen retrieval instructions", async () => {
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe("qwen3-reranker-0.6b")
      expect(body.instruction).toContain("Retrieve prior failures")
      expect(body.instruction).toContain("recoveries")
      expect(body.instruction).toContain("fallback path")

      return new Response(
        JSON.stringify({
          results: [{ index: 0, relevance_score: 0.8 }],
          model: "qwen3-reranker-0.6b",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await configureRetrievalRuntime()

        const result = await RetrievalRuntime.rerank({
          queryText: "recover the failed rerank path",
          queryVector: [1, 0],
          candidateVectors: new Map([["a", [1, 0]]]),
          candidates: [{ chunkID: "a", documentID: "doc-a", sourceType: "note", content: "Fallback recovery path", score: 2 }],
          policy: {
            name: "auto",
            reranker: {
              providerID: "local" as any,
              modelID: "qwen3-reranker-0.6b" as any,
              instructionPreset: "memory.failure",
              settings: {
                baseURL: "http://retrieval.local/v1",
              },
            },
          },
        })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(result.metadata?.instructionPreset).toBe("memory.failure")
      },
    })
  })

  test("reports the observed supervised reranker model when the local fallback lane differs from the requested model", async () => {
    let healthy = false

    RetrievalModelSupervisor.configureTestHooks({
      healthCheck: async () => healthy,
      spawn: (config) => {
        healthy = true
        expect(config.args?.some((item) => item.includes("Qwen3-Reranker-4B-q4_k_m.gguf"))).toBe(true)
        const handle = {
          pid: 5454,
          kill: () => {
            healthy = false
            return true
          },
          once: (_event: "exit", _listener: (code: number | null, signal: NodeJS.Signals | null) => void) => handle as any,
        }
        return handle as any
      },
    })

    const fetchMock = mock(async (_url: string, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          results: [{ index: 0, relevance_score: 0.8 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await configureRetrievalRuntime()

        const result = await RetrievalRuntime.rerank({
          queryText: "recover the failed rerank path",
          queryVector: [1, 0],
          candidateVectors: new Map([["a", [1, 0]]]),
          candidates: [{ chunkID: "a", documentID: "doc-a", sourceType: "note", content: "Fallback recovery path", score: 2 }],
          policy: {
            name: "auto",
            reranker: {
              providerID: "local" as any,
              modelID: "qwen3-reranker-0.6b" as any,
              instructionPreset: "memory.failure",
              settings: {
                baseURL: "http://retrieval.local/v1",
                supervisor: {
                  enabled: true,
                  command: "llama-server",
                  args: [
                    "--model",
                    "C:\\models\\Qwen3-Reranker-4B-q4_k_m.gguf",
                    "--reranking",
                    "--port",
                    "8094",
                  ],
                  startupTimeoutMS: 50,
                  healthCheckIntervalMS: 1,
                  idleTimeoutMS: 20,
                },
              },
            },
          },
        })

        expect(result.metadata?.modelID).toBe("qwen3-reranker-4b-gguf")
        expect(result.metadata?.requestedModelID).toBe("qwen3-reranker-0.6b")
        expect(String(result.metadata?.observedModelPath)).toContain("Qwen3-Reranker-4B-q4_k_m.gguf")
      },
    })
  })

  test("supervised local endpoint starts on demand, stays warm briefly, and idles down", async () => {
    let healthy = false
    let spawnCount = 0
    let killCount = 0

    RetrievalModelSupervisor.configureTestHooks({
      healthCheck: async () => healthy,
      spawn: () => {
        spawnCount += 1
        healthy = true
        let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
        const handle = {
          pid: 4242,
          kill: () => {
            killCount += 1
            healthy = false
            onExit?.(0, null)
            return true
          },
          once: (_event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => {
            onExit = listener
            return handle as any
          },
        }
        return handle as any
      },
    })

    const fetchMock = mock(async (_url: string, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.2, 0.3, 0.5] }],
          model: "qwen3-embedding-0.6b",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await configureRetrievalRuntime()

        const policy = {
          name: "auto" as const,
          embedder: {
            providerID: "local" as any,
            modelID: "qwen3-embedding-0.6b" as any,
            settings: {
              baseURL: "http://retrieval.local/v1",
              supervisor: {
                enabled: true,
                command: "llama-server",
                args: ["--port", "8091"],
                startupTimeoutMS: 50,
                healthCheckIntervalMS: 1,
                idleTimeoutMS: 20,
              },
            },
          },
        }

        await RetrievalRuntime.embedText({
          text: "oak lattice continuity",
          purpose: "query",
          policy,
        })
        await RetrievalRuntime.embedText({
          text: "oak lattice continuity again",
          purpose: "query",
          policy,
        })

        expect(spawnCount).toBe(1)
        expect(fetchMock).toHaveBeenCalledTimes(2)

        await new Promise((resolve) => setTimeout(resolve, 35))
        expect(killCount).toBe(1)
      },
    })
  })

  test("env-configured supervisor can auto-manage a local endpoint without per-model supervisor settings", async () => {
    let healthy = false
    let spawnCount = 0

    process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_COMMAND = "llama-server"
    process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_ARGS = "[\"--port\",\"8091\"]"
    process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_HEALTH_URL = "http://retrieval.local/health"
    process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_IDLE_TIMEOUT_MS = "20"
    process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_HEALTHCHECK_INTERVAL_MS = "1"
    process.env.OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_STARTUP_TIMEOUT_MS = "50"

    RetrievalModelSupervisor.configureTestHooks({
      healthCheck: async (url) => {
        expect(url).toBe("http://retrieval.local/health")
        return healthy
      },
      spawn: (config) => {
        spawnCount += 1
        expect(config.command).toBe("llama-server")
        expect(config.args).toEqual(["--port", "8091"])
        healthy = true
        const handle = {
          pid: 4343,
          kill: () => {
            healthy = false
            return true
          },
          once: (_event: "exit", _listener: (code: number | null, signal: NodeJS.Signals | null) => void) => handle as any,
        }
        return handle as any
      },
    })

    const fetchMock = mock(async () => {
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.4, 0.4, 0.2] }],
          model: "qwen3-embedding-0.6b",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await configureRetrievalRuntime()

        await RetrievalRuntime.embedText({
          text: "cedar continuity",
          purpose: "query",
          policy: {
            name: "auto",
            embedder: {
              providerID: "local" as any,
              modelID: "qwen3-embedding-0.6b" as any,
              settings: {
                baseURL: "http://retrieval.local/v1",
              },
            },
          },
        })

        expect(spawnCount).toBe(1)
        expect(fetchMock).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("falls back from openrouter retrieval endpoints to local qwen endpoints before synthetic fallback", async () => {
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (String(url).startsWith("https://openrouter.ai/api/v1")) {
        expect(body.model).toBe("qwen/qwen3-embedding-4b")
        expect(init?.headers).toEqual({
          "Content-Type": "application/json",
          Authorization: "Bearer openrouter-key",
        })
        return new Response("upstream unavailable", { status: 503 })
      }

      expect(String(url)).toBe("http://retrieval.local/v1/embeddings")
      expect(body.model).toBe("qwen3-embedding-4b-gguf")
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer local",
      })
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.6, 0.2, 0.2] }],
          model: "qwen3-embedding-4b-gguf",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await configureRetrievalRuntime()

        const result = await RetrievalRuntime.embedText({
          text: "relay baton provenance",
          purpose: "query",
          policy: {
            name: "quality",
            embedder: {
              providerID: "openrouter" as any,
              modelID: "qwen/qwen3-embedding-4b" as any,
              instructionPreset: "memory.decision",
              outputType: "dense",
              settings: {
                baseURL: "https://openrouter.ai/api/v1",
                apiKey: "openrouter-key",
                localFallbackModel: {
                  providerID: "local" as any,
                  modelID: "qwen3-embedding-4b-gguf" as any,
                  instructionPreset: "memory.decision",
                  outputType: "dense",
                  settings: {
                    baseURL: "http://retrieval.local/v1",
                  },
                },
              },
            },
          },
        })

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(result.metadata?.source).toBe("provider")
        expect(result.metadata?.providerID).toBe("local")
        expect(result.metadata?.modelID).toBe("qwen3-embedding-4b-gguf")
      },
    })
  })

  test("uses stored openrouter provider auth for retrieval when no env api key is set", async () => {
    const authGet = mock(async (providerID: string) => {
      expect(providerID).toBe("openrouter")
      return { type: "api" as const, key: "stored-openrouter-key" }
    })
    Auth.get = authGet as typeof Auth.get

    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer stored-openrouter-key",
      })
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.5, 0.3, 0.2] }],
          model: "qwen/qwen3-embedding-4b",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await configureRetrievalRuntime()

        const result = await RetrievalRuntime.embedText({
          text: "orchard relay memory",
          purpose: "query",
          policy: {
            name: "quality",
            embedder: {
              providerID: "openrouter" as any,
              modelID: "qwen/qwen3-embedding-4b" as any,
              instructionPreset: "memory.decision",
              outputType: "dense",
              settings: {
                baseURL: "https://openrouter.ai/api/v1",
              },
            },
          },
        })

        expect(authGet).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(result.metadata?.providerID).toBe("openrouter")
      },
    })
  })
})
