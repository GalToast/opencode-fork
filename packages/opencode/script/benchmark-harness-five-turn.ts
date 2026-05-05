// @ts-nocheck - TODO: fix after API stabilization
import { Log } from "../src/util/log"
import { Instance } from "../src/project/instance"
import { Session } from "../src/session"
import { SessionPrompt } from "../src/session/prompt"

const ROOT = process.env.FIVE_TURN_ROOT ?? "C:/Users/HP/Desktop/Temp while my comp is at the shop"
const AGENTS = (process.env.FIVE_TURN_AGENTS ?? "qwen35plus,glm5,kimi25,minimax25")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
const TURNS = Number(process.env.FIVE_TURN_COUNT ?? "5")
const TURN_TIMEOUT_MS = Number(process.env.FIVE_TURN_TIMEOUT_MS ?? "120000")

type TurnResult = {
  turn: number
  firstDeltaMS?: number
  firstReasoningMS?: number
  firstTextMS?: number
  totalMS: number
  output: string
  ok: boolean
}

type AgentResult = {
  agent: string
  sessionID: string
  turns: TurnResult[]
  ok: boolean
  error?: string
}

function textFromParts(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim()
}

async function runAgent(agent: string): Promise<AgentResult> {
  const session = await Session.create({ title: `five-turn-${agent}` })
  const tapID = `five_turn_${agent}_${Date.now()}`
  let currentTurn = 0
  let firstDeltaMS: number | undefined
  let firstReasoningMS: number | undefined
  let firstTextMS: number | undefined
  let turnStarted = 0
  const turns: TurnResult[] = []

  SessionPrompt.registerHarnessResultTap(tapID, (event) => {
    if (event.type !== "assistant.delta") return
    const elapsed = Math.round(performance.now() - turnStarted)
    if (firstDeltaMS === undefined) firstDeltaMS = elapsed
    if (event.partType === "reasoning" && firstReasoningMS === undefined) firstReasoningMS = elapsed
    if (event.partType === "text" && firstTextMS === undefined) firstTextMS = elapsed
  })

  try {
    for (let turn = 1; turn <= TURNS; turn++) {
      currentTurn = turn
      const token = `TURN_${turn}_${agent}_OK`
      firstDeltaMS = undefined
      firstReasoningMS = undefined
      firstTextMS = undefined
      turnStarted = performance.now()
      const reply = await Promise.race([
        SessionPrompt.prompt({
          sessionID: session.id,
          agent,
          resultTapID: tapID,
          parts: [
            {
              type: "text",
              text:
                turn === 1
                  ? `Reply with exactly ${token} and nothing else.`
                  : `Continue this back and forth. Reply with exactly ${token} and nothing else.`,
            },
          ],
        }),
        Bun.sleep(TURN_TIMEOUT_MS).then(() => {
          throw new Error(`timed out after ${TURN_TIMEOUT_MS}ms`)
        }),
      ])
      const output = textFromParts(reply.parts as any)
      turns.push({
        turn,
        firstDeltaMS,
        firstReasoningMS,
        firstTextMS,
        totalMS: Math.round(performance.now() - turnStarted),
        output,
        ok: output.includes(token),
      })
    }
    return {
      agent,
      sessionID: session.id,
      turns,
      ok: turns.every((turn) => turn.ok),
    }
  } catch (error) {
    return {
      agent,
      sessionID: session.id,
      turns,
      ok: false,
      error: `turn ${currentTurn}: ${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    SessionPrompt.unregisterHarnessResultTap(tapID)
    await Session.remove(session.id).catch(() => {})
  }
}

await Log.init({ print: false })

const results: AgentResult[] = []
await Instance.provide({
  directory: ROOT,
  fn: async () => {
    for (const agent of AGENTS) {
      console.log(`Testing five-turn harness path -> ${agent}`)
      results.push(await runAgent(agent))
    }
  },
})

console.log(JSON.stringify(results, null, 2))
if (results.some((item) => !item.ok)) process.exitCode = 1
