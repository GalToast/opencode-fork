// Test adaptive model routing
import { Instance } from "./src/project/instance"
import { Session } from "./src/session"
import { SessionPrompt } from "./src/session/prompt"
import { AdaptiveModelRouter } from "./src/provider/adaptive-router"
import { Log } from "./src/util/log"

Log.init({ print: true })

const ROOT = "C:/Users/HP/Desktop/Temp while my comp is at the shop"

console.log("=== Testing Adaptive Model Routing ===\n")

await Instance.provide({
  directory: ROOT,
  fn: async () => {
    // First, let's see current latency stats
    console.log("Current latency stats:")
    const stats = AdaptiveModelRouter.getAllLatencyStats()
    for (const stat of stats.slice(0, 5)) {
      console.log(`  ${stat.providerID}/${stat.modelID}: ${Math.round(stat.emaFirstTokenMS)}ms avg (${stat.slowCalls}/${stat.totalCalls} slow)`)
    }
    if (stats.length === 0) {
      console.log("  No latency data yet")
    }
    
    // Simulate a slow model by recording fake latency
    console.log("\nSimulating slow MiniMax-M2.5 (5000ms)...")
    AdaptiveModelRouter.recordLatency("alibaba-coding-plan", "MiniMax-M2.5", 5000, 6000)
    AdaptiveModelRouter.recordLatency("alibaba-coding-plan", "MiniMax-M2.5", 5200, 6100)
    AdaptiveModelRouter.recordLatency("alibaba-coding-plan", "MiniMax-M2.5", 4800, 5900)
    
    // Record fast kimi-k2.5
    console.log("Recording fast kimi-k2.5 (1500ms)...")
    AdaptiveModelRouter.recordLatency("alibaba-coding-plan", "kimi-k2.5", 1500, 2000)
    AdaptiveModelRouter.recordLatency("alibaba-coding-plan", "kimi-k2.5", 1400, 1900)
    AdaptiveModelRouter.recordLatency("alibaba-coding-plan", "kimi-k2.5", 1600, 2100)
    
    // Check if MiniMax is now considered slow
    const isSlow = AdaptiveModelRouter.isModelSlow("alibaba-coding-plan", "MiniMax-M2.5")
    console.log(`\nIs MiniMax-M2.5 slow? ${isSlow}`)
    
    // Get alternative
    const alternative = await AdaptiveModelRouter.getFastestAlternative(
      "alibaba-coding-plan",
      "MiniMax-M2.5"
    )
    console.log(`Recommended alternative: ${alternative ? `${alternative.providerID}/${alternative.modelID}` : "none found"}`)
    
    // Test with failover
    console.log("\nTesting selectModelWithFailover...")
    const selected = await AdaptiveModelRouter.selectModelWithFailover(
      { providerID: "alibaba-coding-plan", modelID: "MiniMax-M2.5" }
    )
    console.log(`Selected model: ${selected.providerID}/${selected.modelID}`)
    
    console.log("\n=== Test Complete ===")
  },
})
