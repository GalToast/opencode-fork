// Diagnostic script to isolate harness vs provider latency
import { Log } from "./src/util/log"
import { Instance } from "./src/project/instance"
import { Session } from "./src/session"
import { SessionPrompt } from "./src/session/prompt"
import { Provider } from "./src/provider/provider"

Log.init({ print: false })

const ROOT = "C:/Users/HP/Desktop/Temp while my comp is at the shop"
const PROMPT = "Reply with exactly OK and nothing else."

async function benchmarkProvider(modelProvider, modelID) {
  console.log(`\n=== Benchmarking ${modelProvider}/${modelID} ===`)
  
  const results = {
    provider: modelProvider,
    model: modelID,
    runs: []
  }
  
  for (let i = 0; i < 3; i++) {
    const started = performance.now()
    let firstDeltaMS, firstReasoningMS, firstTextMS
    
    const result = await Instance.provide({
      directory: ROOT,
      fn: async () => {
        const tapID = `bench_${Date.now()}`
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
            model: { providerID: modelProvider, modelID: modelID },
            resultTapID: tapID,
            parts: [{ type: "text", text: PROMPT }],
          })
          
          return {
            firstDeltaMS,
            firstReasoningMS,
            firstTextMS,
            totalMS: Math.round(performance.now() - started),
            output: reply.parts.filter(p => p.type === "text").map(p => p.text).join("").trim(),
          }
        } finally {
          SessionPrompt.unregisterPromptResultTap(tapID)
          await Session.remove(session.id).catch(() => {})
        }
      },
    })
    
    results.runs.push(result)
    console.log(`  Run ${i + 1}: firstDelta=${result.firstDeltaMS}ms, total=${result.totalMS}ms`)
    
    // Small delay between runs
    await new Promise(r => setTimeout(r, 1000))
  }
  
  // Calculate averages
  const avgFirstDelta = Math.round(results.runs.reduce((a, r) => a + r.firstDeltaMS, 0) / results.runs.length)
  const avgTotal = Math.round(results.runs.reduce((a, r) => a + r.totalMS, 0) / results.runs.length)
  
  console.log(`  Average: firstDelta=${avgFirstDelta}ms, total=${avgTotal}ms`)
  
  return results
}

async function listAvailableModels() {
  return await Instance.provide({
    directory: ROOT,
    fn: async () => {
      const providers = await Provider.list()
      const models = []
      for (const [providerID, info] of Object.entries(providers)) {
        for (const modelID of Object.keys(info.models)) {
          models.push({ providerID, modelID })
        }
      }
      return models
    },
  })
}

async function main() {
  console.log("=== OpenCode Speed Diagnostics ===\n")
  
  // Test a few different models if available
  const testModels = [
    { provider: "openrouter", model: "moonshotai/Kimi-K2.5" },
    { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
    { provider: "openai", model: "gpt-4o-mini" },
  ]
  
  const allResults = []
  
  for (const { provider, model } of testModels) {
    try {
      const result = await benchmarkProvider(provider, model)
      allResults.push(result)
    } catch (e) {
      console.log(`  Error testing ${provider}/${model}: ${e.message}`)
    }
  }
  
  console.log("\n=== Summary ===")
  for (const r of allResults) {
    const avgFirstDelta = Math.round(r.runs.reduce((a, run) => a + run.firstDeltaMS, 0) / r.runs.length)
    const avgTotal = Math.round(r.runs.reduce((a, run) => a + run.totalMS, 0) / r.runs.length)
    console.log(`${r.provider}/${r.model}: firstToken=${avgFirstDelta}ms, total=${avgTotal}ms`)
  }
}

main().catch(console.error)
