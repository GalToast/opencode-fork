import { Instance } from "./src/project/instance"
import { Provider } from "./src/provider/provider"
import { Session } from "./src/session"
import { SessionPrompt } from "./src/session/prompt"
import { Log } from "./src/util/log"

// Enable debug logging
Log.init({ print: true, level: "DEBUG" })

const ROOT = "C:/Users/HP/Desktop/Temp while my comp is at the shop"

console.log("=== Timing Trace with Debug Logs ===\n")

await Instance.provide({
  directory: ROOT,
  fn: async () => {
    const session = await Session.create({})
    
    const started = performance.now()
    
    const result = await SessionPrompt.prompt({
      sessionID: session.id,
      model: { providerID: "alibaba-coding-plan", modelID: "MiniMax-M2.5" },
      parts: [{ type: "text", text: "Reply with exactly OK" }],
    })
    
    const total = Math.round(performance.now() - started)
    console.log(`\n=== Total time: ${total}ms ===`)
    
    await Session.remove(session.id).catch(() => {})
  },
})
