import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Instance } from "../src/project/instance"
import { Session } from "../src/session"
import { SessionPrompt } from "../src/session/prompt"
import { Log } from "../src/util/log"

type Capture = {
  body: any
  headers: Record<string, string>
}

const MODEL = process.env.INSPECT_MODEL ?? "kimi-k2.5"
const PROVIDER_ID = "alibaba-coding-plan"

function sseText(text: string) {
  const chunks = [
    {
      type: "message_start",
      message: {
        id: "msg-capture-1",
        model: MODEL,
        usage: {
          input_tokens: 3,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
        },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Plan first." },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text },
    },
    { type: "content_block_stop", index: 1 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null, container: null },
      usage: {
        input_tokens: 3,
        output_tokens: 2,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    },
    { type: "message_stop" },
  ]
  return chunks.map((chunk) => `event: message_start\ndata: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"
}

async function main() {
  await Log.init({ print: false, dev: false })
  const captures: Capture[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const headers = Object.fromEntries(req.headers.entries())
      const body = await req.json()
      captures.push({ body, headers })
      return new Response(sseText("OK"), {
        headers: {
          "content-type": "text/event-stream",
        },
      })
    },
  })

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inspect-alibaba-turn2-"))
  try {
    await Bun.write(
      path.join(dir, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        enabled_providers: [PROVIDER_ID],
        provider: {
          [PROVIDER_ID]: {
            npm: "@ai-sdk/anthropic",
            options: {
              apiKey: "test-alibaba-key",
              baseURL: server.url.toString(),
            },
            models: {
              [MODEL]: {
                id: MODEL,
                name: MODEL,
                reasoning: true,
                tool_call: true,
                attachment: MODEL === "kimi-k2.5",
                interleaved: MODEL === "qwen3.5-plus" ? undefined : { field: "reasoning_content" },
                limit: {
                  context: MODEL === "glm-5" ? 202_752 : MODEL === "MiniMax-M2.5" ? 196_608 : 262_144,
                  output:
                    MODEL === "glm-5" ? 16_384 : MODEL === "MiniMax-M2.5" ? 24_576 : MODEL === "kimi-k2.5" ? 32_768 : 65_536,
                },
              },
            },
          },
        },
        agent: {
          inspect: {
            model: `${PROVIDER_ID}/${MODEL}`,
            options: {
              thinking: {
                type: "enabled",
                budgetTokens: MODEL === "glm-5" ? 16_384 : MODEL === "MiniMax-M2.5" ? 24_575 : MODEL === "kimi-k2.5" ? 32_768 : 32_768,
              },
            },
          },
        },
      }),
    )

    await Instance.provide({
      directory: dir,
      fn: async () => {
        const session = await Session.create({ title: `inspect-${MODEL}` })
        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "inspect",
            parts: [{ type: "text", text: "Reply with exactly FIRST_OK and nothing else." }],
          })
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "inspect",
            parts: [{ type: "text", text: "Reply with exactly SECOND_OK and nothing else." }],
          })
        } finally {
          await Session.remove(session.id).catch(() => {})
        }
      },
    })
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  server.stop(true)
  const second = captures[1]
  console.log(
    JSON.stringify(
      {
        model: MODEL,
        captureCount: captures.length,
        second: second
          ? {
              keys: Object.keys(second.body ?? {}),
              contentLength: JSON.stringify(second.body ?? {}).length,
              max_tokens: second.body?.max_tokens,
              thinking: second.body?.thinking,
              system:
                typeof second.body?.system === "string"
                  ? { type: "string", length: second.body.system.length }
                  : Array.isArray(second.body?.system)
                    ? { type: "array", length: second.body.system.length }
                    : second.body?.system ?? null,
              toolsCount: Array.isArray(second.body?.tools) ? second.body.tools.length : null,
              messageCount: Array.isArray(second.body?.messages) ? second.body.messages.length : null,
              messages: second.body?.messages,
            }
          : null,
      },
      null,
      2,
    ),
  )
}

await main()
