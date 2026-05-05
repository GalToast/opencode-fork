import { Instance } from "./src/project/instance"
import { Provider } from "./src/provider/provider"
import { Log } from "./src/util/log"
import { streamText } from "ai"

Log.init({ print: true })

const ROOT = "C:/Users/HP/Desktop/Temp while my comp is at the shop"

const modelsToTest = [
  "opencode/gpt-5-codex",
  "opencode/glm-5",
  "opencode/gpt-5.1-codex-max",
  "opencode/gpt-4o-mini",
]

console.log("=== Testing opencode models (checking which respond) ===\n")

await Instance.provide({
  directory: ROOT,
  fn: async () => {
    const providers = await Provider.list()
    const opencodeProvider = providers["opencode"]
    
    console.log(`Available opencode models: ${Object.keys(opencodeProvider.models).length}`)
    console.log("First 10:", Object.keys(opencodeProvider.models).slice(0, 10).join(", "))
    console.log("")
    
    for (const modelPath of modelsToTest) {
      const [providerID, modelID] = modelPath.split("/")
      console.log(`\n--- Testing ${modelPath} ---`)
      
      try {
        const model = await Provider.getModel(providerID, modelID)
        console.log(`  Capabilities: toolcall=${model.capabilities.toolcall}, reasoning=${model.capabilities.reasoning}`)
        
        const language = await Provider.getLanguage(model)
        const started = performance.now()
        
        const stream = streamText({
          model: language,
          messages: [{ role: "user", content: "Say OK" }],
        })
        
        let response = ""
        let gotResponse = false
        
        for await (const chunk of stream.fullStream) {
          if (!gotResponse) {
            gotResponse = true
            console.log(`  First chunk: ${Math.round(performance.now() - started)}ms`)
          }
          if (chunk.type === "text-delta") {
            response += chunk.textDelta
          }
        }
        
        console.log(`  ✓ SUCCESS: "${response.trim()}" (${Math.round(performance.now() - started)}ms total)`)
      } catch (e) {
        const errorMsg = e.message || String(e)
        if (errorMsg.includes("401") || errorMsg.includes("Unauthorized") || errorMsg.includes("payment")) {
          console.log(`  ✗ REQUIRES PAYMENT: ${errorMsg.slice(0, 100)}`)
        } else {
          console.log(`  ✗ ERROR: ${errorMsg.slice(0, 100)}`)
        }
      }
    }
  },
})
