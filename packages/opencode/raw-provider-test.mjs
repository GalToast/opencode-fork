// Test raw provider SDK vs harness overhead
import { Instance } from "./src/project/instance"
import { Provider } from "./src/provider/provider"
import { Log } from "./src/util/log"
import { streamText } from "ai"

Log.init({ print: false })

const ROOT = "C:/Users/HP/Desktop/Temp while my comp is at the shop"

async function testRawProvider(providerID, modelID) {
  console.log(`\n=== Raw SDK Test: ${providerID}/${modelID} ===`)
  
  return await Instance.provide({
    directory: ROOT,
    fn: async () => {
      const started = performance.now()
      let firstChunkMS
      
      const model = await Provider.getModel(providerID, modelID)
      const language = await Provider.getLanguage(model)
      
      const stream = streamText({
        model: language,
        messages: [{ role: "user", content: "Reply with exactly OK" }],
      })
      
      for await (const chunk of stream.fullStream) {
        if (firstChunkMS === undefined) {
          firstChunkMS = Math.round(performance.now() - started)
        }
        if (chunk.type === "text-delta") break
      }
      
      const totalMS = Math.round(performance.now() - started)
      console.log(`  Raw SDK: firstChunk=${firstChunkMS}ms, total=${totalMS}ms`)
      
      return { firstChunkMS, totalMS }
    },
  })
}

console.log("=== SDK vs Harness Overhead Test ===")

const result = await testRawProvider("alibaba-coding-plan", "MiniMax-M2.5")
console.log(`\nRaw SDK first chunk: ${result.firstChunkMS}ms`)
console.log("Compare to harness: ~7300ms (first test from earlier)")
console.log("\nOverhead: ~" + (7300 - result.firstChunkMS) + "ms")
