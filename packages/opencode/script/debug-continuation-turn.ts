// @ts-nocheck - TODO: fix after API stabilization
import { Log } from "../src/util/log"
import { Instance } from "../src/project/instance"
import { Session } from "../src/session"
import { SessionPrompt } from "../src/session/prompt"
import { MessageV2 } from "../src/session/message-v2"

const ROOT = process.env.DEBUG_TURN_ROOT ?? "C:/Users/HP/Desktop/Temp while my comp is at the shop"
const AGENT = process.env.DEBUG_TURN_AGENT ?? "qwen35plus"
const TURN_TIMEOUT_MS = Number(process.env.DEBUG_TURN_TIMEOUT_MS ?? "90000")
const FIRST_TEXT =
  process.env.DEBUG_TURN_FIRST_TEXT ?? "Reply with exactly TURN_1_DEBUG_OK and nothing else."
const SECOND_TEXT =
  process.env.DEBUG_TURN_SECOND_TEXT ??
  "Continue this back and forth. Reply with exactly TURN_2_DEBUG_OK and nothing else."

type AssistantTap =
  | {
      type: "assistant.delta"
      partType: "text" | "reasoning"
      elapsedMS: number
      deltaLength: number
      snapshotLength: number
    }
  | {
      type: "assistant.part"
      partType: "text" | "reasoning"
      elapsedMS: number
      textLength: number
      preview: string
    }

function preview(text: string, max = 120) {
  return text.length > max ? text.slice(0, max) + "..." : text
}

function textFromParts(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim()
}

async function latestAssistant(sessionID: string) {
  const rows = await Session.messages({ sessionID })
  const assistant = [...rows].reverse().find((message) => message.info.role === "assistant")
  if (!assistant) return undefined
  return {
    info: assistant.info,
    parts: await MessageV2.parts(assistant.info.id),
  }
}

async function messageSummary(sessionID: string) {
  const rows = await Session.messages({ sessionID })
  return Promise.all(
    rows.map(async (row) => ({
      id: row.info.id,
      role: row.info.role,
      parentID: row.info.role === "assistant" ? row.info.parentID : undefined,
      agent: row.info.agent,
      finish: row.info.role === "assistant" ? row.info.finish : undefined,
      completed: "completed" in row.info.time ? row.info.time.completed : undefined,
      text: preview(textFromParts(row.parts as any), 80),
      parts: (await MessageV2.parts(row.info.id)).map((part) =>
        part.type === "tool"
          ? { type: part.type, tool: part.tool, status: part.state.status }
          : part.type === "text" || part.type === "reasoning"
            ? { type: part.type, length: part.text.length, preview: preview(part.text, 60) }
            : { type: part.type },
      ),
    })),
  )
}

await Log.init({ print: false })

await Instance.provide({
  directory: ROOT,
  fn: async () => {
    const session = await Session.create({ title: `debug-continuation-${AGENT}` })
    const tapID = `debug_continuation_${AGENT}_${Date.now()}`
    const turn2Events: AssistantTap[] = []
    let turn2StartedAt = 0
    try {
      await SessionPrompt.prompt({
        sessionID: session.id,
        agent: AGENT,
        parts: [{ type: "text", text: FIRST_TEXT }],
      })

      SessionPrompt.registerHarnessResultTap(tapID, (event) => {
        const elapsedMS = Math.round(performance.now() - turn2StartedAt)
        if (event.type === "assistant.delta") {
          turn2Events.push({
            type: event.type,
            partType: event.partType,
            elapsedMS,
            deltaLength: event.delta.length,
            snapshotLength: event.snapshot.length,
          })
        }
        if (event.type === "assistant.part") {
          turn2Events.push({
            type: event.type,
            partType: event.partType,
            elapsedMS,
            textLength: event.text.length,
            preview: preview(event.text),
          })
        }
      })

      turn2StartedAt = performance.now()
      let timeout = false
      let reply: Awaited<ReturnType<typeof SessionPrompt.prompt>> | undefined
      let error: string | undefined

      try {
        reply = await Promise.race([
          SessionPrompt.prompt({
            sessionID: session.id,
            agent: AGENT,
            resultTapID: tapID,
            parts: [{ type: "text", text: SECOND_TEXT }],
          }),
          Bun.sleep(TURN_TIMEOUT_MS).then(() => {
            timeout = true
            throw new Error(`timed out after ${TURN_TIMEOUT_MS}ms`)
          }),
        ])
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }

      const latest = await latestAssistant(session.id)
      const messages = await messageSummary(session.id)
      const summary = {
        agent: AGENT,
        sessionID: session.id,
        firstText: FIRST_TEXT,
        secondText: SECOND_TEXT,
        timeout,
        error,
        replyText: reply ? textFromParts(reply.parts as any) : undefined,
        turn2Events,
        messages,
        latestAssistant: latest
          ? {
              id: latest.info.id,
              parentID: latest.info.role === "assistant" ? latest.info.parentID : undefined,
              finish: latest.info.role === "assistant" ? latest.info.finish : undefined,
              completed: latest.info.role === "assistant" ? latest.info.time.completed : undefined,
              error: latest.info.role === "assistant" ? latest.info.error : undefined,
              parts: latest.parts.map((part) => {
                if (part.type === "text" || part.type === "reasoning") {
                  return {
                    id: part.id,
                    type: part.type,
                    length: part.text.length,
                    preview: preview(part.text),
                  }
                }
                if (part.type === "tool") {
                  return {
                    id: part.id,
                    type: part.type,
                    tool: part.tool,
                    status: part.state.status,
                    title: "title" in part.state ? part.state.title : undefined,
                    metadata: "metadata" in part.state ? part.state.metadata : undefined,
                    input: part.state.input,
                    error: "error" in part.state ? part.state.error : undefined,
                  }
                }
                if (part.type === "step-finish") {
                  return {
                    id: part.id,
                    type: part.type,
                    reason: part.reason,
                    tokens: part.tokens,
                  }
                }
                return {
                  id: part.id,
                  type: part.type,
                }
              }),
            }
          : undefined,
      }

      console.log(JSON.stringify(summary, null, 2))
    } finally {
      SessionPrompt.unregisterHarnessResultTap(tapID)
      await Session.remove(session.id).catch(() => {})
    }
  },
})
