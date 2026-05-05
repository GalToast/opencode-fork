import { Log } from "./src/util/log"
import { Instance } from "./src/project/instance"
import { Session } from "./src/session"
import { SessionPrompt } from "./src/session/prompt"

Log.init({ print: false })
const ROOT = "C:/Users/HP/Desktop/Temp while my comp is at the shop"
const AGENT = "minimax25"
const PROMPT = "Reply with exactly OK and nothing else."

const tapID = `bench_${AGENT}_${Date.now()}`
const started = performance.now()
let firstDeltaMS
let firstReasoningMS
let firstTextMS

const result = await Instance.provide({
  directory: ROOT,
  fn: async () => {
    const session = await Session.create({})
    SessionPrompt.registerPromptResultTap(tapID, (event) => {
      if (event.type !== "assistant.delta") return
      const elapsed = Math.round(performance.now() - started)
      if (firstDeltaMS === undefined) firstDeltaMS = elapsed
      if (event.partType === "reasoning" && firstReasoningMS === undefined) firstReasoningMS = elapsed
      if (event.partType === "text" && firstTextMS === undefined) firstTextMS = elapsed
    })
    try {
      const reply = await SessionPrompt.prompt({
        sessionID: session.id,
        agent: AGENT,
        resultTapID: tapID,
        parts: [{ type: "text", text: PROMPT }],
      })
      const text = reply.parts.filter((part) => part.type === "text").map((part) => part.text).join("")
      return {
        role: reply.info.role,
        firstDeltaMS,
        firstReasoningMS,
        firstTextMS,
        totalMS: Math.round(performance.now() - started),
        output: text.trim(),
        parts: reply.parts.map((part) => ({ type: part.type, text: part.type === "text" ? part.text.slice(0, 200) : undefined })),
        info: {
          id: reply.info.id,
          error: reply.info.error,
          completed: reply.info.time.completed,
        },
      }
    } catch (error) {
      return {
        firstDeltaMS,
        firstReasoningMS,
        firstTextMS,
        totalMS: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      SessionPrompt.unregisterPromptResultTap(tapID)
      await Session.remove(session.id).catch(() => {})
    }
  },
})

console.log(JSON.stringify(result, null, 2))
