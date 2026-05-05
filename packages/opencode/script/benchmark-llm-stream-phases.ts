// @ts-nocheck - TODO: fix after API stabilization
import { Log } from "../src/util/log"
import { Agent } from "../src/agent/agent"
import { Instance } from "../src/project/instance"
import { Identifier } from "../src/id/id"
import { Provider } from "../src/provider/provider"
import { LLM } from "../src/session/llm"
import { MessageV2 } from "../src/session/message-v2"

type Timings = {
  phases: {
    getLanguage?: number
    getConfig?: number
    getProvider?: number
    getAuth?: number
  }
  streamTextReadyMs?: number
  firstChunkMs?: number
}

type BenchResult = {
  iteration: number
  model: string
  provider: string
  getLanguageMs?: number
  getConfigMs?: number
  getProviderMs?: number
  getAuthMs?: number
  streamTextReadyMs?: number
  firstChunkMs?: number
  totalMs?: number
  error?: string
}

process.env.OPENCODE_LLM_STREAM_TRACE = "1"

const ROOT = process.env.OPENCODE_BENCH_ROOT ?? "C:/Users/HP/Desktop/Temp while my comp is at the shop"
const AGENT_NAME = process.env.OPENCODE_BENCH_AGENT
const MODEL = process.env.OPENCODE_BENCH_MODEL
const ROUNDS = Number(process.env.OPENCODE_BENCH_ROUNDS ?? "3")
const PROMPT = process.env.OPENCODE_BENCH_PROMPT ?? "Reply with exactly OK and nothing else."
const TIMEOUT_MS = Number(process.env.OPENCODE_BENCH_TIMEOUT_MS ?? "30000")

async function runOne(iteration: number): Promise<BenchResult> {
  const sessionID = Identifier.ascending("session")
  const started = performance.now()

  const agentName = AGENT_NAME ?? (await Agent.defaultAgent())
  const agent = await Agent.get(agentName)
  if (!agent) {
    return {
      iteration,
      model: "",
      provider: "",
      error: `agent not found: ${agentName}`,
    }
  }

  const parsedModel = (() => {
    if (MODEL) return Provider.parseModel(MODEL)
    if (agent.model) return agent.model
    return undefined
  })()

  const modelRef = parsedModel ?? (await Provider.defaultModel())
  const model = await Provider.getModel(modelRef.providerID, modelRef.modelID)

  const user: MessageV2.User = {
    id: Identifier.ascending("user"),
    sessionID,
    role: "user",
    time: {
      created: Date.now(),
    },
    agent: agent.name,
    model: {
      providerID: model.providerID,
      modelID: model.id,
    },
  }

  const abortController = new AbortController()
  const timer = setTimeout(() => {
    abortController.abort(new Error(`stream timed out after ${TIMEOUT_MS}ms`))
  }, TIMEOUT_MS)

  try {
    const result = await LLM.stream({
      user,
      sessionID,
      model,
      agent,
      system: [],
      abort: abortController.signal,
      messages: [{ role: "user", content: PROMPT }],
      tools: {},
    })

    const streamStarted = performance.now()
    for await (const part of result.fullStream) {
      const firstChunkMs = Math.round(performance.now() - streamStarted)
      const timings = ((result as any).timings as Timings | undefined) ?? {
        phases: {},
      }

      return {
        iteration,
        model: model.id,
        provider: model.providerID,
        getLanguageMs: timings.phases.getLanguage,
        getConfigMs: timings.phases.getConfig,
        getProviderMs: timings.phases.getProvider,
        getAuthMs: timings.phases.getAuth,
        streamTextReadyMs: timings.streamTextReadyMs,
        firstChunkMs,
        totalMs: Math.round(performance.now() - started),
      }
    }

    return {
      iteration,
      model: model.id,
      provider: model.providerID,
      totalMs: Math.round(performance.now() - started),
      error: "stream produced no chunks",
    }
  } catch (error) {
    return {
      iteration,
      model: model.id,
      provider: model.providerID,
      totalMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

await Log.init({ print: true, level: "DEBUG" })

const results: BenchResult[] = []

await Instance.provide({
  directory: ROOT,
  fn: async () => {
    for (let i = 1; i <= ROUNDS; i++) {
      console.log(`LLM.stream timing run #${i}/${ROUNDS}`)
      const result = await runOne(i)
      results.push(result)
      if (result.error) {
        console.error(`run #${i} failed: ${result.error}`)
        break
      }
    }
  },
})

console.log("\nLLM.stream phase timing breakdown")
console.table(results.map((item) => ({
  iteration: item.iteration,
  model: item.model,
  provider: item.provider,
  getLanguageMs: item.getLanguageMs ?? "",
  getConfigMs: item.getConfigMs ?? "",
  getProviderMs: item.getProviderMs ?? "",
  getAuthMs: item.getAuthMs ?? "",
  streamTextReadyMs: item.streamTextReadyMs ?? "",
  firstChunkMs: item.firstChunkMs ?? "",
  totalMs: item.totalMs ?? "",
  error: item.error ?? "",
})))

const valid = results.filter((x) => x.error === undefined)
if (valid.length) {
  const avg = {
    getLanguageMs: Math.round(valid.reduce((acc, item) => acc + (item.getLanguageMs ?? 0), 0) / valid.length),
    getConfigMs: Math.round(valid.reduce((acc, item) => acc + (item.getConfigMs ?? 0), 0) / valid.length),
    getProviderMs: Math.round(valid.reduce((acc, item) => acc + (item.getProviderMs ?? 0), 0) / valid.length),
    getAuthMs: Math.round(valid.reduce((acc, item) => acc + (item.getAuthMs ?? 0), 0) / valid.length),
    streamTextReadyMs: Math.round(valid.reduce((acc, item) => acc + (item.streamTextReadyMs ?? 0), 0) / valid.length),
    firstChunkMs: Math.round(valid.reduce((acc, item) => acc + (item.firstChunkMs ?? 0), 0) / valid.length),
    totalMs: Math.round(valid.reduce((acc, item) => acc + (item.totalMs ?? 0), 0) / valid.length),
  }
  console.log("\nAverages")
  console.table([avg])
} else {
  process.exitCode = 1
}
