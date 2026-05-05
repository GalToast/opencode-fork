// @ts-nocheck - TODO: fix after API stabilization
import { bootstrap } from "../src/cli/bootstrap"
import { Log } from "../src/util/log"
import { Instance } from "../src/project/instance"
import { Session } from "../src/session"
import { SessionPrompt } from "../src/session/prompt"

type Mode = "direct"

type Attempt = {
  mode: Mode
  agent: string
  sessionID: string
  firstPromptMS: number
  secondPromptMS: number
  firstAssistantText: string
  secondAssistantText: string
  ok: boolean
  reason?: string
}

const ROOT = process.env.BACKFORTH_ROOT ?? "C:/Users/HP/Desktop/Temp while my comp is at the shop"
const AGENTS = (process.env.BACKFORTH_AGENTS ?? "qwen35plus,minimax25")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)

function textFromParts(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim()
}

function textFromMessage(message: any) {
  return textFromParts(Array.isArray(message?.parts) ? message.parts : [])
}

async function waitForAssistantAfterUserToken(sessionID: string, token: string, timeoutMS = 90_000) {
  const deadline = Date.now() + timeoutMS
  while (Date.now() < deadline) {
    const rows = (await Session.messages({ sessionID })) as any[]
    const userIndex = rows.findIndex((message) => message?.info?.role === "user" && textFromMessage(message).includes(token))
    if (userIndex >= 0) {
      const assistant = rows.slice(userIndex + 1).find((message) => message?.info?.role === "assistant")
      if (assistant?.info?.time?.completed) return assistant
    }
    await Bun.sleep(500)
  }
  throw new Error(`Timed out waiting for assistant after token ${token}`)
}

async function runDirect(agent: string): Promise<Attempt> {
  const session = await Session.create({ title: `backforth-direct-${agent}` })
  const firstToken = `FIRST_${agent}_${Date.now()}`
  const secondToken = `SECOND_${agent}_${Date.now()}`
  try {
    const firstStarted = performance.now()
    const first = await SessionPrompt.prompt({
      sessionID: session.id,
      agent,
      parts: [{ type: "text", text: `Reply with exactly ${firstToken} and nothing else.` }],
    })
    const secondStarted = performance.now()
    const second = await SessionPrompt.prompt({
      sessionID: session.id,
      agent,
      parts: [{ type: "text", text: `Reply with exactly ${secondToken} and nothing else.` }],
    })
    const firstAssistantText = textFromParts(first.parts as any)
    const secondAssistantText = textFromParts(second.parts as any)
    const ok = firstAssistantText.includes(firstToken) && secondAssistantText.includes(secondToken)
    return {
      mode: "direct",
      agent,
      sessionID: session.id,
      firstPromptMS: Math.round(performance.now() - firstStarted),
      secondPromptMS: Math.round(performance.now() - secondStarted),
      firstAssistantText,
      secondAssistantText,
      ok,
      reason: ok ? undefined : JSON.stringify({ firstAssistantText, secondAssistantText }),
    }
  } finally {
    await Session.remove(session.id).catch(() => {})
  }
}

await Log.init({
  print: false,
  dev: true,
  level: "ERROR",
})

await bootstrap(process.cwd(), async () => {
  const results: Attempt[] = []
  await Instance.provide({
    directory: ROOT,
    fn: async () => {
      for (const agent of AGENTS) {
        results.push(await runDirect(agent))
      }
    },
  })
  console.log(JSON.stringify(results, null, 2))
  if (results.some((item) => !item.ok)) process.exitCode = 1
})
