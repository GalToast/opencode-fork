import { describe, expect, test } from "bun:test"
import { CodeSearchTool } from "../../src/tool/codesearch"

const ctx = {
  sessionID: "test" as any,
  messageID: "message" as any,
  callID: "call",
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
  const original = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = original
  }
}

describe("tool.codesearch", () => {
  test("requests codesearch permission and parses the first SSE content block", async () => {
    const asks: Array<Record<string, unknown>> = []

    await withFetch(
      async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString()
        expect(url).toBe("https://mcp.exa.ai/mcp")
        expect(init?.method).toBe("POST")
        const body = JSON.parse(String(init?.body)) as {
          params: { name: string; arguments: { query: string; tokensNum: number } }
        }
        expect(body.params.name).toBe("get_code_context_exa")
        expect(body.params.arguments.query).toBe("react useState hook examples")
        expect(body.params.arguments.tokensNum).toBe(4000)

        return new Response(
          [
            'event: message',
            `data: ${JSON.stringify({
              jsonrpc: "2.0",
              result: {
                content: [{ type: "text", text: "useState returns state and a setter." }],
              },
            })}`,
            "",
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        )
      },
      async () => {
        const tool = await CodeSearchTool.init()
        const result = await tool.execute(
          {
            query: "react useState hook examples",
            tokensNum: 4000,
          },
          {
            ...ctx,
            ask: async (input: Record<string, unknown>) => {
              asks.push(input)
            },
          },
        )

        expect(asks).toHaveLength(1)
        expect(asks[0]?.permission).toBe("codesearch")
        expect(asks[0]?.patterns).toEqual(["react useState hook examples"])
        expect(result.title).toBe("Code search: react useState hook examples")
        expect(result.output).toContain("useState returns state and a setter.")
      },
    )
  })

  test("returns the empty-result fallback when the SSE stream carries no content blocks", async () => {
    await withFetch(
      async () =>
        new Response("event: message\ndata: {}\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      async () => {
        const tool = await CodeSearchTool.init()
        const result = await tool.execute(
          {
            query: "unknown framework",
            tokensNum: 2000,
          },
          ctx,
        )

        expect(result.title).toBe("Code search: unknown framework")
        expect(result.output).toContain("No code snippets or documentation found.")
      },
    )
  })
})
