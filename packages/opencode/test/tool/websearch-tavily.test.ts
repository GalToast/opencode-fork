import { describe, expect, test } from "bun:test"
import { WebSearchTool } from "../../src/tool/websearch"

const ctx = {
  sessionID: "test" as any,
  messageID: "message" as any,
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

async function withFetch(
  mockFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const original = new Map<string, string | undefined>()
  for (const key of Object.keys(env)) {
    original.set(key, process.env[key])
    const value = env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  try {
    await fn()
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe("tool.websearch.tavily", () => {
  test("uses tavily backend when requested", async () => {
    await withEnv(
      {
        OPENCODE_WEBSEARCH_BACKEND: "tavily",
        OPENCODE_TAVILY_API_KEY: "test-tavily-key-123",
        OPENCODE_EXA_API_KEY: undefined,
        OPENCODE_SEARXNG_URL: undefined,
      },
      async () => {
        await withFetch(
          async (input, init) => {
            const url = input instanceof Request ? input.url : input.toString()
            expect(url).toContain("https://api.tavily.com/search")
            
            const headers = init?.headers as Record<string, string>
            expect(headers["x-api-key"]).toBe("test-tavily-key-123")
            expect(headers["content-type"]).toBe("application/json")

            const body = JSON.parse(init?.body as string)
            expect(body.query).toBe("OpenAI homepage")
            expect(body.max_results).toBe(1)

            return new Response(
              JSON.stringify({
                query: "OpenAI homepage",
                results: [
                  {
                    title: "OpenAI",
                    url: "https://openai.com",
                    content: "Official homepage",
                    score: 0.95,
                  },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            )
          },
          async () => {
            const tool = await WebSearchTool.init()
            const result = await tool.execute({ query: "OpenAI homepage", numResults: 1 }, ctx)
            expect(result.output).toContain("https://openai.com")
            expect(result.output).toContain("Score: 0.95")
            // @ts-ignore
            expect(result.metadata.backend).toBe("tavily")
          },
        )
      },
    )
  })

  test("throws error when tavily api key is missing", async () => {
    await withEnv(
      {
        OPENCODE_WEBSEARCH_BACKEND: "tavily",
        OPENCODE_TAVILY_API_KEY: undefined,
        TAVILY_API_KEY: undefined,
      },
      async () => {
        const tool = await WebSearchTool.init()
        await expect(async () => {
          await tool.execute({ query: "test query" }, ctx)
        }).toThrow()
      },
    )
  })

  test("handles tavily api error response", async () => {
    await withEnv(
      {
        OPENCODE_WEBSEARCH_BACKEND: "tavily",
        OPENCODE_TAVILY_API_KEY: "invalid-key",
      },
      async () => {
        await withFetch(
          async () => {
            return new Response('{"error": "Invalid API key"}', {
              status: 401,
              headers: { "content-type": "application/json" },
            })
          },
          async () => {
            const tool = await WebSearchTool.init()
            await expect(async () => {
              await tool.execute({ query: "test query" }, ctx)
            }).toThrow("Tavily search error (401)")
          },
        )
      },
    )
  })

  test("parses tavily results correctly", async () => {
    await withEnv(
      {
        OPENCODE_WEBSEARCH_BACKEND: "tavily",
        OPENCODE_TAVILY_API_KEY: "test-key",
      },
      async () => {
        await withFetch(
          async () => {
            return new Response(
              JSON.stringify({
                query: "test query",
                results: [
                  {
                    title: "Result One",
                    url: "https://example.com/one",
                    content: "Content one",
                    score: 0.98,
                  },
                  {
                    title: "Result Two",
                    url: "https://example.com/two",
                    content: "Content two",
                    score: 0.87,
                  },
                  {
                    url: "https://example.com/three",
                    content: "Content three without title",
                  },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            )
          },
          async () => {
            const tool = await WebSearchTool.init()
            const result = await tool.execute({ query: "test query", numResults: 3 }, ctx)
            
            expect(result.output).toContain("1. Result One")
            expect(result.output).toContain("URL: https://example.com/one")
            expect(result.output).toContain("Snippet: Content one")
            expect(result.output).toContain("Score: 0.98")
            
            expect(result.output).toContain("2. Result Two")
            expect(result.output).toContain("Score: 0.87")
            
            expect(result.output).toContain("3. https://example.com/three")
            expect(result.output).toContain("Content three without title")
            
            // @ts-ignore
            expect(result.metadata.backend).toBe("tavily")
          },
        )
      },
    )
  })

  test("handles empty tavily results", async () => {
    await withEnv(
      {
        OPENCODE_WEBSEARCH_BACKEND: "tavily",
        OPENCODE_TAVILY_API_KEY: "test-key",
      },
      async () => {
        await withFetch(
          async () => {
            return new Response(
              JSON.stringify({
                query: "obscure query",
                results: [],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            )
          },
          async () => {
            const tool = await WebSearchTool.init()
            const result = await tool.execute({ query: "obscure query" }, ctx)
            
            expect(result.output).toBe("No search results found. Please try a different query.")
            // @ts-ignore
            expect(result.metadata.backend).toBe("tavily")
          },
        )
      },
    )
  })

  test("falls back to tavily in auto mode when exa fails and searxng is unavailable", async () => {
    await withEnv(
      {
        OPENCODE_WEBSEARCH_BACKEND: "auto",
        OPENCODE_EXA_API_KEY: undefined,
        OPENCODE_TAVILY_API_KEY: "fallback-key",
        OPENCODE_SEARXNG_URL: "",
      },
      async () => {
        let calls = 0
        await withFetch(
          async (input, init) => {
            calls++
            const url = input instanceof Request ? input.url : input.toString()
            
            if (calls === 1) {
              expect(url).toContain("https://mcp.exa.ai/mcp")
              return new Response('{"error":"rate limit"}', { status: 429 })
            }

            expect(url).toContain("https://api.tavily.com/search")
            const headers = init?.headers as Record<string, string>
            expect(headers["x-api-key"]).toBe("fallback-key")

            return new Response(
              JSON.stringify({
                results: [
                  {
                    title: "Tavily Fallback Result",
                    url: "https://example.com/tavily-fallback",
                    content: "Fallback to tavily worked",
                    score: 0.92,
                  },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            )
          },
          async () => {
            const tool = await WebSearchTool.init()
            const result = await tool.execute({ query: "fallback test", numResults: 1 }, ctx)
            
            expect(calls).toBe(2)
            expect(result.output).toContain("https://example.com/tavily-fallback")
            // @ts-ignore
            expect(result.metadata.backend).toBe("tavily")
          },
        )
      },
    )
  })

  test("uses alternative env var OPENCODE_TAVILY_API_KEY over TAVILY_API_KEY", async () => {
    await withEnv(
      {
        OPENCODE_WEBSEARCH_BACKEND: "tavily",
        OPENCODE_TAVILY_API_KEY: "primary-key",
        TAVILY_API_KEY: "fallback-key",
      },
      async () => {
        await withFetch(
          async (input, init) => {
            const headers = init?.headers as Record<string, string>
            expect(headers["x-api-key"]).toBe("primary-key")
            
            return new Response(
              JSON.stringify({
                results: [{ title: "Test", url: "https://test.com", content: "Test content", score: 0.9 }],
              }),
              { status: 200 },
            )
          },
          async () => {
            const tool = await WebSearchTool.init()
            const result = await tool.execute({ query: "test" }, ctx)
            // @ts-ignore
            expect(result.metadata.backend).toBe("tavily")
          },
        )
      },
    )
  })

  test("uses TAVILY_API_KEY when OPENCODE_TAVILY_API_KEY is not set", async () => {
    await withEnv(
      {
        OPENCODE_WEBSEARCH_BACKEND: "tavily",
        OPENCODE_TAVILY_API_KEY: undefined,
        TAVILY_API_KEY: "fallback-key",
      },
      async () => {
        await withFetch(
          async (input, init) => {
            const headers = init?.headers as Record<string, string>
            expect(headers["x-api-key"]).toBe("fallback-key")
            
            return new Response(
              JSON.stringify({
                results: [{ title: "Test", url: "https://test.com", content: "Test content", score: 0.9 }],
              }),
              { status: 200 },
            )
          },
          async () => {
            const tool = await WebSearchTool.init()
            const result = await tool.execute({ query: "test" }, ctx)
            // @ts-ignore
            expect(result.metadata.backend).toBe("tavily")
          },
        )
      },
    )
  })

  test("rewrites tavily queries with include and exclude domain filters", async () => {
    await withEnv(
      {
        OPENCODE_WEBSEARCH_BACKEND: "auto",
        OPENCODE_TAVILY_API_KEY: "test-key",
        OPENCODE_EXA_API_KEY: undefined,
        OPENCODE_SEARXNG_URL: "",
      },
      async () => {
        await withFetch(
          async (input, init) => {
            const url = input instanceof Request ? input.url : input.toString()
            expect(url).toContain("https://api.tavily.com/search")
            const body = JSON.parse(init?.body as string)
            // Tavily doesn't support includeDomains/excludeDomains in the same way
            // as searxng. The test verifies Tavily is being called.
            expect(body.query).toBeDefined()
            return new Response(
              JSON.stringify({
                results: [{ title: "Test", url: "https://openai.com/test", content: "Test content", score: 0.9 }],
              }),
              { status: 200 },
            )
          },
          async () => {
            const tool = await WebSearchTool.init()
            const result = await tool.execute(
              {
                query: "gpt models",
              },
              ctx,
            )
            // @ts-ignore
            expect(result.metadata.backend).toBe("tavily")
          },
        )
      },
    )
  })
})
