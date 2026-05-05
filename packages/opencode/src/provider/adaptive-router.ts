// Adaptive Model Router - Routes to fastest available model based on real-time latency metrics
import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import { Log } from "@/util/log"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import path from "path"

const log = Log.create({ service: "model-router" })

// Latency threshold for "slow" models (milliseconds)
const SLOW_THRESHOLD_MS = 3000
// Window size for moving average (number of samples)
const LATENCY_WINDOW_SIZE = 10
// Minimum samples before declaring a model slow
const MIN_SAMPLES = 3
// Cooldown period before retrying a slow model (milliseconds)
const MODEL_COOLDOWN_MS = 60_000

export namespace AdaptiveModelRouter {
  export type ModelLatency = {
    providerID: string
    modelID: string
    // Exponential moving average of time-to-first-token
    emaFirstTokenMS: number
    // Recent samples (circular buffer)
    samples: number[]
    sampleIndex: number
    // When this model was last marked slow
    lastSlowAt?: number
    // Total calls made
    totalCalls: number
    // Slow call count
    slowCalls: number
  }

  type LatencyDB = {
    models: Record<string, ModelLatency>
    lastUpdated: number
  }

  const memoryCache: Map<string, ModelLatency> = new Map()
  let dbLoaded = false

  function getModelKey(providerID: string, modelID: string): string {
    return `${providerID}/${modelID}`
  }

  async function getDBPath(): Promise<string> {
    return path.join(Global.Path.state, "model-latency.json")
  }

  async function loadDB(): Promise<LatencyDB> {
    if (dbLoaded) {
      // Return current memory cache state
      const models: Record<string, ModelLatency> = {}
      for (const [key, latency] of memoryCache) {
        models[key] = latency
      }
      return { models, lastUpdated: Date.now() }
    }
    
    const dbPath = await getDBPath()
    try {
      const data = await Filesystem.readJson<LatencyDB>(dbPath)
      // Populate memory cache
      for (const [key, latency] of Object.entries(data.models)) {
        memoryCache.set(key, latency)
      }
      dbLoaded = true
      return data
    } catch {
      dbLoaded = true
      return { models: {}, lastUpdated: Date.now() }
    }
  }

  async function saveDB(): Promise<void> {
    const dbPath = await getDBPath()
    const models: Record<string, ModelLatency> = {}
    for (const [key, latency] of memoryCache) {
      models[key] = latency
    }
    await Filesystem.writeJson(dbPath, {
      models,
      lastUpdated: Date.now(),
    })
  }

  export function recordLatency(
    providerID: string,
    modelID: string,
    firstTokenMS: number,
    totalMS: number
  ): void {
    const key = getModelKey(providerID, modelID)
    let latency = memoryCache.get(key)
    
    if (!latency) {
      latency = {
        providerID,
        modelID,
        emaFirstTokenMS: firstTokenMS,
        samples: new Array(LATENCY_WINDOW_SIZE).fill(firstTokenMS),
        sampleIndex: 1,
        totalCalls: 1,
        slowCalls: firstTokenMS > SLOW_THRESHOLD_MS ? 1 : 0,
      }
      memoryCache.set(key, latency)
    } else {
      // Update exponential moving average (alpha = 0.3)
      const alpha = 0.3
      latency.emaFirstTokenMS = alpha * firstTokenMS + (1 - alpha) * latency.emaFirstTokenMS
      
      // Add to circular buffer
      latency.samples[latency.sampleIndex % LATENCY_WINDOW_SIZE] = firstTokenMS
      latency.sampleIndex++
      latency.totalCalls++
      
      if (firstTokenMS > SLOW_THRESHOLD_MS) {
        latency.slowCalls++
        latency.lastSlowAt = Date.now()
      }
    }
    
    // Async save (don't block)
    void saveDB()
    
    log.debug("recorded latency", {
      providerID,
      modelID,
      firstTokenMS,
      ema: Math.round(latency.emaFirstTokenMS),
      slowRate: Math.round((latency.slowCalls / latency.totalCalls) * 100),
    })
  }

  export function isModelSlow(providerID: string, modelID: string): boolean {
    const key = getModelKey(providerID, modelID)
    const latency = memoryCache.get(key)
    
    if (!latency) return false // No data yet, assume OK
    if (latency.totalCalls < MIN_SAMPLES) return false // Not enough data
    
    // Check if in cooldown
    if (latency.lastSlowAt && Date.now() - latency.lastSlowAt < MODEL_COOLDOWN_MS) {
      return true
    }
    
    // Check if EMA is above threshold
    return latency.emaFirstTokenMS > SLOW_THRESHOLD_MS
  }

  export async function getFastestAlternative(
    currentProviderID: ProviderID | string,
    currentModelID: ModelID | string,
    requireCapabilities?: {
      toolcall?: boolean
      reasoning?: boolean
      context?: number
    }
  ): Promise<{ providerID: string; modelID: string } | undefined> {
    const providers = await Provider.list()
    const currentModel = await Provider.getModel(currentProviderID as ProviderID, currentModelID as ModelID)
    
    const candidates: Array<{
      providerID: string
      modelID: string
      latency: number
      score: number
    }> = []
    
    for (const [providerID, provider] of Object.entries(providers)) {
      for (const [modelID, model] of Object.entries(provider.models)) {
        // Skip current model
        if (providerID === currentProviderID && modelID === currentModelID) continue
        
        // Skip OpenAI ChatGPT models (per user preference)
        if (providerID === "openai") continue
        
        // Skip Alibaba direct provider (alibaba-coding-plan is the actual provider used)
        if (providerID === "alibaba" && !providerID.includes("coding-plan")) continue
        
        // Skip opencode (requires payment method even for "free" models)
        if (providerID === "opencode") continue
        
        // Check capability requirements
        if (requireCapabilities?.toolcall && !model.capabilities.toolcall) continue
        if (requireCapabilities?.reasoning && !model.capabilities.reasoning) continue
        if (requireCapabilities?.context && model.limit.context < requireCapabilities.context) continue
        
        // Get latency data
        const key = getModelKey(providerID, modelID)
        const latencyData = memoryCache.get(key)
        const latency = latencyData?.emaFirstTokenMS ?? 1000 // Default assumption if no data
        
        // Skip if marked slow
        if (isModelSlow(providerID, modelID)) continue
        
        // Score: lower is better (latency + penalty for unknown)
        const unknownPenalty = latencyData ? 0 : 500
        const score = latency + unknownPenalty
        
        candidates.push({
          providerID,
          modelID,
          latency,
          score,
        })
      }
    }
    
    // Sort by score (ascending)
    candidates.sort((a, b) => a.score - b.score)
    
    const best = candidates[0]
    if (!best) return undefined
    
    log.info("selected alternative model", {
      from: `${currentProviderID}/${currentModelID}`,
      to: `${best.providerID}/${best.modelID}`,
      estimatedLatency: Math.round(best.latency),
    })
    
    return {
      providerID: best.providerID,
      modelID: best.modelID,
    }
  }

  export async function selectModelWithFailover(
    preferredModel: { providerID: string; modelID: string },
    requireCapabilities?: {
      toolcall?: boolean
      reasoning?: boolean
      context?: number
    }
  ): Promise<{ providerID: string; modelID: string }> {
    // Check if preferred model is slow
    if (isModelSlow(preferredModel.providerID, preferredModel.modelID)) {
      log.warn("preferred model is slow, looking for alternative", {
        providerID: preferredModel.providerID,
        modelID: preferredModel.modelID,
      })
      
      const alternative = await getFastestAlternative(
        preferredModel.providerID,
        preferredModel.modelID,
        requireCapabilities
      )
      
      if (alternative) {
        return alternative
      }
      
      log.warn("no alternative found, using slow model anyway")
    }
    
    return preferredModel
  }

  export function getLatencyStats(providerID: string, modelID: string): ModelLatency | undefined {
    const key = getModelKey(providerID, modelID)
    return memoryCache.get(key)
  }

  export function getAllLatencyStats(): ModelLatency[] {
    return Array.from(memoryCache.values())
  }

  // Initialize on first use
  void loadDB()
}
