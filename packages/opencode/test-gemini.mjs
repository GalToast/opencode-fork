import { Instance } from "./src/project/instance"
import { Provider } from "./src/provider/provider"
import { Log } from "./src/util/log"
import { streamText } from "ai"

Log.init({ print: true })

const ROOT = "C:/Users/HP/Desktop/Temp while my comp is at the shop"

console.log("=== Testing opencode/gemini-3.1-pro ===\n")

await Instance.provide({
  directory: ROOT,
  fn: async () => {
    const started = performance.now()
    
    const model = await Provider.getModel("opencode", "gemini-3.1-pro")
    console.log(`Model: ${model.providerID}/${model.id}`)
    console.log(`Capabilities: ${JSON.stringify(model.capabilities)}`)
    
    const language = await Provider.getLanguage(model)
    
    const stream = streamText({
      model: language,
      messages: [{ role: "user", content: "Reply with exactly OK" }],
    })
    
    let firstChunkMS
    let response = ""
    
    for await (const chunk of stream.fullStream) {
      if (firstChunkMS === undefined) {
        firstChunkMS = Math.round(performance.now() - started)
        console.log(`First chunk: ${firstChunkMS}ms`)
      }
      if (chunk.type === "text-delta") {
        response += chunk.textDelta
        console.log(`Received: "${chunk.textDelta}"`)
      }
    }
    
    const totalMS = Math.round(performance.now() - started)
    console.log(`\nTotal: ${totalMS}ms`)
    console.log(`Full response: "${response.trim()}"`)
  },
})
