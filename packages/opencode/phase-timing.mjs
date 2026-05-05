import { Instance } from "./src/project/instance"
import { Provider } from "./src/provider/provider"
import { Session } from "./src/session"
import { SessionPrompt } from "./src/session/prompt"
import { LLM } from "./src/session/llm"
import { Agent } from "./src/agent/agent"
import { Log } from "./src/util/log"
import { MessageV2 } from "./src/session/message-v2"
import { SystemPrompt } from "./src/session/system"
import { InstructionPrompt } from "./src/session/instruction"

Log.init({ print: true })

const ROOT = "C:/Users/HP/Desktop/Temp while my comp is at the shop"

console.log("=== Detailed Phase Timing ===\n")

await Instance.provide({
  directory: ROOT,
  fn: async () => {
    const session = await Session.create({})
    const model = await Provider.getModel("alibaba-coding-plan", "MiniMax-M2.5")
    const agent = await Agent.get("build")
    
    // Create a simple user message
    const userMsg = {
      id: "test-msg",
      role: "user",
      agent: "build",
      sessionID: session.id,
      time: { created: Date.now() },
      parts: [{ type: "text", text: "Reply with exactly OK" }],
    }
    
    console.log("Phase 1: System prompt generation")
    const t1 = performance.now()
    const system = [...(await SystemPrompt.environment(model))]
    system.push(...(await InstructionPrompt.system()))
    const phase1 = Math.round(performance.now() - t1)
    console.log(`  System prompt: ${phase1}ms (${system.length} parts)`)
    
    console.log("\nPhase 2: Message conversion")
    const t2 = performance.now()
    const messages = MessageV2.toModelMessages([{ info: userMsg, parts: userMsg.parts }], model)
    const phase2 = Math.round(performance.now() - t2)
    console.log(`  Message conversion: ${phase2}ms (${messages.length} messages)`)
    
    console.log("\nPhase 3: Tool resolution")
    const t3 = performance.now()
    // Minimal tool set
    const tools = {}
    const phase3 = Math.round(performance.now() - t3)
    console.log(`  Tool resolution: ${phase3}ms`)
    
    console.log("\nPhase 4: LLM.stream() call")
    const t4 = performance.now()
    let firstChunkMS
    
    const stream = await LLM.stream({
      user: userMsg,
      sessionID: session.id,
      model,
      agent: agent,
      system,
      abort: new AbortController().signal,
      messages,
      tools,
    })
    const streamInit = Math.round(performance.now() - t4)
    console.log(`  LLM.stream() init: ${streamInit}ms`)
    
    console.log("\nPhase 5: Streaming response")
    const t5 = performance.now()
    for await (const chunk of stream.fullStream) {
      if (firstChunkMS === undefined) {
        firstChunkMS = Math.round(performance.now() - t5)
        console.log(`  First chunk: ${firstChunkMS}ms`)
      }
      if (chunk.type === "text-delta" && chunk.textDelta?.includes("OK")) {
        break
      }
    }
    const totalStream = Math.round(performance.now() - t5)
    console.log(`  Total stream: ${totalStream}ms`)
    
    console.log("\n=== SUMMARY ===")
    console.log(`System prompt:     ${phase1}ms`)
    console.log(`Message convert:   ${phase2}ms`)
    console.log(`Tool resolution:   ${phase3}ms`)
    console.log(`Stream init:       ${streamInit}ms`)
    console.log(`First chunk:       ${firstChunkMS}ms`)
    console.log(`Total stream:      ${totalStream}ms`)
    console.log(`------------------------`)
    console.log(`Total:             ${phase1 + phase2 + phase3 + streamInit + totalStream}ms`)
    
    await Session.remove(session.id).catch(() => {})
  },
})
