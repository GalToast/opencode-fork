// Trace harness latency breakdown
import { Instance } from "./src/project/instance"
import { Provider } from "./src/provider/provider"
import { Session } from "./src/session"
import { SessionPrompt } from "./src/session/prompt"
import { Log } from "./src/util/log"

Log.init({ print: false })

const ROOT = "C:/Users/HP/Desktop/Temp while my comp is at the shop"

console.log("=== Harness Latency Breakdown ===\n")

const timings = {}

await Instance.provide({
  directory: ROOT,
  fn: async () => {
    // 1. Session creation
    const t1 = performance.now()
    const session = await Session.create({})
    timings.sessionCreate = Math.round(performance.now() - t1)
    console.log(`1. Session.create(): ${timings.sessionCreate}ms`)
    
    // 2. Provider list
    const t2 = performance.now()
    const providers = await Provider.list()
    timings.providerList = Math.round(performance.now() - t2)
    console.log(`2. Provider.list(): ${timings.providerList}ms`)
    
    // 3. Get model
    const t3 = performance.now()
    const model = await Provider.getModel("alibaba-coding-plan", "MiniMax-M2.5")
    timings.getModel = Math.round(performance.now() - t3)
    console.log(`3. Provider.getModel(): ${timings.getModel}ms`)
    
    // 4. Get language (SDK init)
    const t4 = performance.now()
    const language = await Provider.getLanguage(model)
    timings.getLanguage = Math.round(performance.now() - t4)
    console.log(`4. Provider.getLanguage(): ${timings.getLanguage}ms`)
    
    // 5. Register tap
    const t5 = performance.now()
    const tapID = `trace_${Date.now()}`
    let firstTapMS
    SessionPrompt.registerPromptResultTap(tapID, (event) => {
      if (event.type === "assistant.delta" && firstTapMS === undefined) {
        firstTapMS = Math.round(performance.now() - t0)
      }
    })
    timings.registerTap = Math.round(performance.now() - t5)
    console.log(`5. Register tap: ${timings.registerTap}ms`)
    
    // 6. Full prompt call
    const t0 = performance.now()
    await SessionPrompt.prompt({
      sessionID: session.id,
      model: { providerID: "alibaba-coding-plan", modelID: "MiniMax-M2.5" },
      resultTapID: tapID,
      parts: [{ type: "text", text: "Reply with exactly OK" }],
    })
    const totalPrompt = Math.round(performance.now() - t0)
    
    SessionPrompt.unregisterPromptResultTap(tapID)
    await Session.remove(session.id).catch(() => {})
    
    console.log(`\n6. SessionPrompt.prompt() total: ${totalPrompt}ms`)
    console.log(`   First tap event: ${firstTapMS}ms`)
    console.log(`\nOverhead before streaming: ${firstTapMS - 134}ms (vs 134ms raw SDK)`)
  },
})
