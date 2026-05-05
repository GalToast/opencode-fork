import { bootstrap } from "./src/cli/bootstrap"
import { Log } from "./src/util/log"
import { Instance } from "./src/project/instance"
import { Session } from "./src/session"
import { SessionPrompt } from "./src/session/prompt"

const ROOT = process.env.AB_ROOT ?? "C:/Users/HP/Desktop/Temp while my comp is at the shop"
const AGENT = process.env.AB_AGENT ?? "kimi25"
const USE_TAP = process.env.AB_USE_TAP === "1"
const SECOND = process.env.AB_SECOND ?? "Continue this back and forth. Reply with exactly TURN_2_OK and nothing else."

function textFromParts(parts) {
  return parts.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text).join("").trim()
}

await Log.init({ print: false, dev: true, level: "ERROR" })
await bootstrap(process.cwd(), async () => {
  await Instance.provide({
    directory: ROOT,
    fn: async () => {
      const session = await Session.create({ title: `ab-${AGENT}` })
      const tapID = `ab_${Date.now()}`
      try {
        const first = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: AGENT,
          parts: [{ type: "text", text: "Reply with exactly TURN_1_OK and nothing else." }],
        })
        if (USE_TAP) SessionPrompt.registerPromptResultTap(tapID, () => {})
        const started = performance.now()
        const second = await Promise.race([
          SessionPrompt.prompt({
            sessionID: session.id,
            agent: AGENT,
            resultTapID: USE_TAP ? tapID : undefined,
            parts: [{ type: "text", text: SECOND }],
          }),
          Bun.sleep(30000).then(() => { throw new Error("timeout") }),
        ])
        console.log(JSON.stringify({ ok: true, useTap: USE_TAP, second: SECOND, first: textFromParts(first.parts), secondText: textFromParts(second.parts), elapsed: Math.round(performance.now()-started) }, null, 2))
      } catch (error) {
        console.log(JSON.stringify({ ok: false, useTap: USE_TAP, second: SECOND, error: error instanceof Error ? error.message : String(error) }, null, 2))
      } finally {
        SessionPrompt.unregisterPromptResultTap(tapID)
        await Session.remove(session.id).catch(() => {})
      }
    },
  })
})
