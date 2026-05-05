import { Instance } from "./src/project/instance"
import { Provider } from "./src/provider/provider"
import { Session } from "./src/session"
import { SessionPrompt } from "./src/session/prompt"
import { Log } from "./src/util/log"

Log.init({ print: false })

const ROOT = "C:/Users/HP/Desktop/Temp while my comp is at the shop"
const PROMPT = "Reply with exactly OK and nothing else."

async function benchmark(modelProvider, modelID) {
  console.log(`\n=== ${modelProvider}/${modelID} ===`)
  
  const results = []
  
  for (let i = 0; i < 3; i++) {
    const started = performance.now()
    let firstDeltaMS, firstTextMS
    
    const result = await Instance.provide({
      directory: ROOT,
      fn: async () => {
        const tapID = `bench_${Date.now()}`
        const session = await Session.create({})
        
        SessionPrompt.registerPromptResultTap(tapID, (event) => {
          if (event.type !== "assistant.delta") return
          const elapsed = Math.round(performance.now() - started)
          if (firstDeltaMS === undefined) firstDeltaMS = elapsed
          if (event.partType === "text" && firstTextMS === undefined) firstTextMS = elapsed
        })
        
        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: modelProvider, modelID: modelID },
            resultTapID: tapID,
            parts: [{ type: "text", text: PROMPT }],
          })
          
          return {
            firstDeltaMS,
            firstTextMS,
            totalMS: Math.round(performance.now() - started),
          }
        } finally {
          SessionPrompt.unregisterPromptResultTap(tapID)
          await Session.remove(session.id).catch(() => {})
        }
      },
    })
    
    results.push(result)
    console.log(`  Run ${i + 1}: firstToken=${result.firstDeltaMS}ms, total=${result.totalMS}ms`)
    
    await new Promise(r => setTimeout(r, 500))
  }
  
  const avgFirst = Math.round(results.reduce((a, r) => a + r.firstDeltaMS, 0) / results.length)
  const avgTotal = Math.round(results.reduce((a, r) => a + r.totalMS, 0) / results.length)
  
  console.log(`  AVERAGE: firstToken=${avgFirst}ms, total=${avgTotal}ms`)
  return { provider: modelProvider, model: modelID, avgFirst, avgTotal }
}

console.log("=== OpenCode Speed Diagnostics ===\n")

const modelsToTest = [
  { provider: "alibaba-coding-plan", model: "MiniMax-M2.5" },
  { provider: "alibaba-coding-plan", model: "kimi-k2.5" },
  { provider: "openai", model: "gpt-4o-mini" },
]

const results = []
for (const { provider, model } of modelsToTest) {
  try {
    const result = await benchmark(provider, model)
    results.push(result)
  } catch (e) {
    console.log(`  ERROR: ${e.message}`)
  }
}

console.log("\n=== SUMMARY ===")
for (const r of results) {
  console.log(`${r.provider}/${r.model}: firstToken=${r.avgFirst}ms, total=${r.avgTotal}ms`)
}
