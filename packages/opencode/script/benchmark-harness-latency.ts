// @ts-nocheck - TODO: fix after API stabilization
import { Log } from "../src/util/log"
import { Instance } from "../src/project/instance"
import { Session } from "../src/session"
import { SessionPrompt } from "../src/session/prompt"

Log.init({ print: false })

const ROOT = process.env.HARNESS_BENCH_ROOT ?? "C:/Users/HP/Desktop/Temp while my comp is at the shop"
const AGENTS = (process.env.HARNESS_BENCH_AGENTS ?? "qwen35plus,minimax25")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
const PROMPT = process.env.HARNESS_BENCH_PROMPT ?? "Reply with exactly OK and nothing else."
const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"

type BenchResult = {
  agent: string
  firstDeltaMS?: number
  firstReasoningMS?: number
  firstTextMS?: number
  totalMS: number
  output: string
  error?: string
}

async function runOne(agent: string): Promise<BenchResult> {
  const tapID = `bench_${agent}_${Date.now()}`
  const started = performance.now()
  let firstDeltaMS: number | undefined
  let firstReasoningMS: number | undefined
  let firstTextMS: number | undefined

  return await Instance.provide({
    directory: ROOT,
    fn: async () => {
      const session = await Session.create({})
      SessionPrompt.registerHarnessResultTap(tapID, (event) => {
        if (event.type !== "assistant.delta") return
        const elapsed = Math.round(performance.now() - started)
        if (firstDeltaMS === undefined) {
          firstDeltaMS = elapsed
        }
        if (event.partType === "reasoning" && firstReasoningMS === undefined) {
          firstReasoningMS = elapsed
        }
        if (event.partType === "text" && firstTextMS === undefined) {
          firstTextMS = elapsed
        }
      })

      try {
        const reply = await SessionPrompt.prompt({
          sessionID: session.id,
          agent,
          resultTapID: tapID,
          parts: [{ type: "text", text: PROMPT }],
        })

        const text = reply.parts
          .filter((part) => part.type === "text")
          .map((part) => (part as { type: "text"; text: string }).text)
          .join("")

        return {
          agent,
          firstDeltaMS,
          firstReasoningMS,
          firstTextMS,
          totalMS: Math.round(performance.now() - started),
          output: text.trim(),
        }
      } catch (error) {
        return {
          agent,
          firstDeltaMS,
          firstReasoningMS,
          firstTextMS,
          totalMS: Math.round(performance.now() - started),
          output: "",
          error: error instanceof Error ? error.message : String(error),
        }
      } finally {
        SessionPrompt.unregisterHarnessResultTap(tapID)
        await Session.remove(session.id).catch(() => {})
      }
    },
  })
}

const results: BenchResult[] = []
for (const agent of AGENTS) {
  console.log(`Testing harness prompt path -> ${agent}`)
  results.push(await runOne(agent))
}

if (JSON_OUTPUT) {
  console.log(JSON.stringify(results, null, 2))
} else {
  console.table(results)
}
