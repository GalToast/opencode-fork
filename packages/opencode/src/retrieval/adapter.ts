import { Auth } from "@/auth"
import { RetrievalModelSupervisor } from "./model-supervisor"
import { RetrievalRuntime } from "./runtime"

export function resetRetrievalRuntimeConfiguration(): void {
  RetrievalRuntime.reset()
}

export async function configureRetrievalRuntime(): Promise<void> {
  RetrievalRuntime.configure({
    embedText: async (input) => {
      const embedder = input.policy?.embedder as
        | {
            providerID?: string
            modelID?: string
            instructionPreset?: string
            instruction?: string
            dimensions?: number
            outputType?: string
            settings?: {
              baseURL?: string
              apiKey?: string
              task?: string
              localFallbackModel?: unknown
              supervisor?: {
                enabled?: boolean
                command?: string
                args?: string[]
                startupTimeoutMS?: number
                healthCheckIntervalMS?: number
                idleTimeoutMS?: number
              }
            }
          }
        | undefined

      if (!embedder) {
        return syntheticEmbed(input.text, input.purpose)
      }

      const baseURL = embedder.settings?.baseURL ?? "http://localhost:8091/v1"

      const supervisorConfig = resolveSupervisorConfig(
        embedder.settings?.supervisor,
        baseURL,
        "EMBEDDING",
      )

      let observedModelPath: string | undefined
      let observedModelID: string | undefined

      if (supervisorConfig) {
        observedModelPath = extractModelPath(supervisorConfig.args)
        observedModelID = observedModelPath ? deriveModelID(observedModelPath) : embedder.modelID

        await RetrievalModelSupervisor.ensureReady({
          key: supervisorConfig.healthURL,
          kind: "embedding",
          endpoint: baseURL,
          healthURL: supervisorConfig.healthURL,
          startupTimeoutMS: supervisorConfig.startupTimeoutMS,
          healthCheckIntervalMS: supervisorConfig.healthCheckIntervalMS,
          idleTimeoutMS: supervisorConfig.idleTimeoutMS,
          command: supervisorConfig.command,
          args: supervisorConfig.args,
          modelPath: observedModelPath,
          modelID: embedder.modelID,
        })
      }

      if (embedder.providerID === "openrouter") {
        let apiKey = embedder.settings?.apiKey
        if (!apiKey) {
          const auth = await Auth.get("openrouter")
          if (auth && auth.type === "api") {
            apiKey = auth.key
          }
        }

        const openrouterResult = await callProviderEmbed(
          input.text,
          { ...embedder, settings: { ...embedder.settings, apiKey, baseURL: embedder.settings?.baseURL ?? "https://openrouter.ai/api/v1" } },
          input.purpose,
        )
        if (openrouterResult) {
          return {
            ...openrouterResult,
            metadata: {
              ...openrouterResult.metadata,
              ...(observedModelPath ? { observedModelPath, observedModelID, requestedModelID: embedder.modelID } : {}),
            },
          }
        }

        const localFallback = embedder.settings?.localFallbackModel as
          | {
              providerID?: string
              modelID?: string
              instructionPreset?: string
              outputType?: string
              settings?: { baseURL?: string; apiKey?: string; task?: string }
            }
          | undefined

        if (localFallback) {
          const localResult = await callProviderEmbed(input.text, localFallback, input.purpose)
          if (localResult) {
            return {
              ...localResult,
              metadata: {
                ...localResult.metadata,
                providerID: localFallback.providerID ?? "local",
                ...(observedModelPath ? { observedModelPath, observedModelID, requestedModelID: embedder.modelID } : {}),
              },
            }
          }
        }

        return syntheticEmbed(input.text, input.purpose)
      }

      const result = await callProviderEmbed(input.text, { ...embedder, settings: { ...embedder.settings, baseURL } }, input.purpose)
      if (result) {
        return {
          ...result,
          metadata: {
            ...result.metadata,
            ...(observedModelPath ? { observedModelPath, observedModelID, requestedModelID: embedder.modelID } : {}),
          },
        }
      }

      return syntheticEmbed(input.text, input.purpose)
    },

    rerank: async (input) => {
      const reranker = input.policy?.reranker as
        | {
            providerID?: string
            modelID?: string
            instructionPreset?: string
            instruction?: string
            outputType?: string
            settings?: {
              baseURL?: string
              apiKey?: string
              supervisor?: {
                enabled?: boolean
                command?: string
                args?: string[]
                startupTimeoutMS?: number
                healthCheckIntervalMS?: number
                idleTimeoutMS?: number
              }
            }
          }
        | undefined

      if (!reranker) {
        return syntheticRerank(input)
      }

      const baseURL = reranker.settings?.baseURL ?? "http://localhost:8092/v1"

      const supervisorConfig = resolveSupervisorConfig(
        reranker.settings?.supervisor,
        baseURL,
        "RERANKER",
      )

      let observedModelPath: string | undefined
      let observedModelID: string | undefined

      if (supervisorConfig) {
        observedModelPath = extractModelPath(supervisorConfig.args)
        observedModelID = observedModelPath ? deriveModelID(observedModelPath) : reranker.modelID

        await RetrievalModelSupervisor.ensureReady({
          key: supervisorConfig.healthURL,
          kind: "reranking",
          endpoint: baseURL,
          healthURL: supervisorConfig.healthURL,
          startupTimeoutMS: supervisorConfig.startupTimeoutMS,
          healthCheckIntervalMS: supervisorConfig.healthCheckIntervalMS,
          idleTimeoutMS: supervisorConfig.idleTimeoutMS,
          command: supervisorConfig.command,
          args: supervisorConfig.args,
          modelPath: observedModelPath,
          modelID: reranker.modelID,
        })
      }

      const result = await callProviderRerank(input, { ...reranker, settings: { ...reranker.settings, baseURL } })
      if (result) {
        return {
          ...result,
          metadata: {
            ...result.metadata,
            modelID: observedModelID ?? result.metadata?.modelID ?? reranker.modelID,
            instructionPreset: reranker.instructionPreset,
            ...(observedModelPath ? { observedModelPath, requestedModelID: reranker.modelID } : {}),
          },
        }
      }

      return syntheticRerank(input)
    },
  })
}

function resolveSupervisorConfig(
  supervisor: {
    enabled?: boolean
    command?: string
    args?: string[]
    startupTimeoutMS?: number
    healthCheckIntervalMS?: number
    idleTimeoutMS?: number
  } | undefined,
  baseURL: string,
  kind: "EMBEDDING" | "RERANKER",
): {
  healthURL: string
  startupTimeoutMS: number
  healthCheckIntervalMS: number
  idleTimeoutMS: number
  command: string
  args: string[]
} | undefined {
  const envCommand =
    process.env[`OPENCODE_RETRIEVAL_${kind}_SUPERVISOR_COMMAND`] ??
    process.env[`OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_COMMAND`]

  const supervisorEnabled = supervisor?.enabled ?? envCommand != null

  if (!supervisorEnabled) return undefined

  const endpoint = baseURL.replace(/\/v1.*$/, "")
  const healthURL =
    process.env[`OPENCODE_RETRIEVAL_${kind}_SUPERVISOR_HEALTH_URL`] ??
    process.env[`OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_HEALTH_URL`] ??
    `${endpoint}/health`

  const command =
    supervisor?.command ??
    process.env[`OPENCODE_RETRIEVAL_${kind}_SUPERVISOR_COMMAND`] ??
    process.env[`OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_COMMAND`] ??
    "llama-server"

  const args =
    supervisor?.args ??
    parseJSON<string[] | undefined>(process.env[`OPENCODE_RETRIEVAL_${kind}_SUPERVISOR_ARGS`], undefined) ??
    parseJSON(process.env[`OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_ARGS`], [] as string[])

  const startupTimeoutMS =
    supervisor?.startupTimeoutMS ??
    parseInt(
      process.env[`OPENCODE_RETRIEVAL_${kind}_SUPERVISOR_STARTUP_TIMEOUT_MS`] ??
        process.env[`OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_STARTUP_TIMEOUT_MS`] ??
        "50",
      10,
    )

  const healthCheckIntervalMS =
    supervisor?.healthCheckIntervalMS ??
    parseInt(
      process.env[`OPENCODE_RETRIEVAL_${kind}_SUPERVISOR_HEALTHCHECK_INTERVAL_MS`] ??
        process.env[`OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_HEALTHCHECK_INTERVAL_MS`] ??
        "1",
      10,
    )

  const idleTimeoutMS =
    supervisor?.idleTimeoutMS ??
    parseInt(
      process.env[`OPENCODE_RETRIEVAL_${kind}_SUPERVISOR_IDLE_TIMEOUT_MS`] ??
        process.env[`OPENCODE_RETRIEVAL_EMBEDDING_SUPERVISOR_IDLE_TIMEOUT_MS`] ??
        "20",
      10,
    )

  return {
    healthURL,
    startupTimeoutMS,
    healthCheckIntervalMS,
    idleTimeoutMS,
    command,
    args,
  }
}

function extractModelPath(args: string[]): string | undefined {
  const modelIdx = args.indexOf("--model")
  if (modelIdx >= 0 && modelIdx < args.length - 1) {
    return args[modelIdx + 1]
  }
  return undefined
}

function deriveModelID(modelPath: string): string {
  const base = modelPath.split(/[\\/]/).pop() ?? modelPath
  const normalized = base.toLowerCase().replace(/\.gguf$/, "")
  if (normalized.includes("reranker") && normalized.includes("4b")) {
    return "qwen3-reranker-4b-gguf"
  }
  if (normalized.includes("embedding") && normalized.includes("4b")) {
    return "qwen3-embedding-4b-gguf"
  }
  if (normalized.includes("reranker") && normalized.includes("0.6b")) {
    return "qwen3-reranker-0.6b"
  }
  if (normalized.includes("embedding") && normalized.includes("0.6b")) {
    return "qwen3-embedding-0.6b"
  }
  return normalized
}

function parseJSON<T>(str: string | undefined, fallback: T): T {
  if (!str) return fallback
  try {
    return JSON.parse(str) as T
  } catch {
    return fallback
  }
}

async function callProviderEmbed(
  text: string,
  embedder: {
    providerID?: string
    modelID?: string
    instructionPreset?: string
    instruction?: string
    dimensions?: number
    outputType?: string
    settings?: {
      baseURL?: string
      apiKey?: string
      task?: string
    }
  },
  purpose?: string,
): Promise<{ vector: number[]; dimensions: number; metadata: Record<string, unknown> } | null> {
  try {
    const baseURL = embedder.settings?.baseURL
    if (!baseURL) return null

    const body: Record<string, unknown> = {
      model: embedder.modelID,
      input: text,
    }

    if (purpose) {
      body.purpose = purpose
    }

    if (embedder.instructionPreset) {
      body.instruction = resolveInstructionPreset(embedder.instructionPreset)
    } else if (embedder.instruction) {
      body.instruction = embedder.instruction
    }

    if (embedder.dimensions) {
      body.dimensions = embedder.dimensions
    }

    if (embedder.outputType) {
      body.output_type = embedder.outputType
    }

    if (embedder.settings?.task) {
      body.task = embedder.settings.task
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    const apiKey = embedder.settings?.apiKey ?? embedder.providerID
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const response = await globalThis.fetch(`${baseURL}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    const embeddingData = data.data?.[0]
    const embedding = embeddingData?.embedding ?? []

    return {
      vector: embedding,
      dimensions: embedding.length,
      metadata: {
        source: "provider",
        providerID: embedder.providerID,
        modelID: embedder.modelID,
        instructionPreset: embedder.instructionPreset,
      },
    }
  } catch {
    return null
  }
}

async function callProviderRerank(
  input: {
    queryText: string
    candidates: Array<{ score?: number; documentID?: string; chunkID?: string; text?: string; metadata?: Record<string, unknown>; [key: string]: unknown }>
  },
  reranker: {
    providerID?: string
    modelID?: string
    instructionPreset?: string
    instruction?: string
    outputType?: string
    settings?: {
      baseURL?: string
      apiKey?: string
    }
  },
): Promise<{ candidates: Array<{ score?: number; documentID?: string; chunkID?: string; text?: string; metadata?: Record<string, unknown>; [key: string]: unknown }>; metadata: Record<string, unknown> } | null> {
  try {
    const baseURL = reranker.settings?.baseURL
    if (!baseURL) return null

    const documents = input.candidates.map((c: any) => c.content ?? "")

    const body: Record<string, unknown> = {
      model: reranker.modelID,
      query: input.queryText,
      documents,
    }

    if (reranker.instructionPreset) {
      body.instruction = resolveInstructionPreset(reranker.instructionPreset)
    } else if (reranker.instruction) {
      body.instruction = reranker.instruction
    }

    if (reranker.outputType) {
      body.output_type = reranker.outputType
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (reranker.settings?.apiKey) {
      headers.Authorization = `Bearer ${reranker.settings.apiKey}`
    }

    const response = await globalThis.fetch(`${baseURL}/rerank`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      return null
    }

    const data = await response.json()
    const results = data.results ?? []

    const scoredCandidates = input.candidates.map((candidate: any, index: number) => {
      const result = results.find((r: any) => r.index === index)
      const score = result?.relevance_score ?? 0
      return {
        ...candidate,
        rerankScore: score,
      }
    })

    scoredCandidates.sort((a: any, b: any) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))

    return {
      candidates: scoredCandidates,
      metadata: {
        source: "provider",
        providerID: reranker.providerID,
        modelID: reranker.modelID,
        instructionPreset: reranker.instructionPreset,
        instruction: reranker.instruction,
      },
    }
  } catch {
    return null
  }
}

function resolveInstructionPreset(preset: string): string {
  const presets: Record<string, string> = {
    "memory.decision":
      "Retrieve prior decisions, constraints, and preferences from the session memory. Focus on user preferences, architectural decisions, explicit constraints, and index-space organization.",
    "memory.failure":
      "Retrieve prior failures, regressions, and recoveries. Focus on the failure pattern, root cause, successful recovery path, and fallback path. Consider the index-space of prior incidents.",
    "memory.task_pattern":
      "Retrieve similar work episodes and successful decompositions. Focus on task structure, tool usage patterns, and successful strategies within the index-space.",
    "memory.file": "Retrieve likely relevant docs, files, or modules. Focus on file paths, module names, documentation content, and index-space location.",
    "memory.code":
      "Retrieve curated code slices and symbol-adjacent chunks. Focus on function names, class definitions, code structure, and index-space positioning.",
    "memory.compaction":
      "Score semantically central facts for retention during compaction. Focus on high-salience information that should be preserved in the index-space.",
  }

  return presets[preset] ?? preset
}

function syntheticEmbed(text: string, purpose?: string): { vector: number[]; dimensions: number; metadata: Record<string, unknown> } {
  const hash = hashString(text)
  const dimensions = 8
  const vector = new Array<number>(dimensions)

  for (let i = 0; i < dimensions; i++) {
    const h = rotateLeft(hash ^ (i * 0x9e3779b9), 13 + (i % 7))
    vector[i] = ((h >>> 16) / 32767.5) - 1
  }

  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1
  for (let i = 0; i < dimensions; i++) {
    vector[i] /= norm
  }

  return {
    vector,
    dimensions,
    metadata: {
      source: "synthetic_fallback",
      purpose,
    },
  }
}

function syntheticRerank(input: {
  queryVector: number[]
  candidates: Array<{ score?: number; documentID?: string; chunkID?: string; text?: string; metadata?: Record<string, unknown>; [key: string]: unknown }>
  candidateVectors: Map<string, number[]>
}): { candidates: Array<{ score?: number; documentID?: string; chunkID?: string; text?: string; metadata?: Record<string, unknown>; [key: string]: unknown }>; metadata: Record<string, unknown> } {
  const queryNorm = normalizeVector(input.queryVector)

  const scored = input.candidates.map((candidate: any) => {
    const chunkID = candidate.chunkID as string
    const candidateVector = input.candidateVectors.get(chunkID)
    let score = 0

    if (candidateVector) {
      const normCandidate = normalizeVector(candidateVector)
      score = dotProduct(queryNorm, normCandidate)
    }

    return {
      ...candidate,
      rerankScore: score,
    }
  })

  scored.sort((a: any, b: any) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))

  return {
    candidates: scored,
    metadata: {
      source: "synthetic_fallback",
    },
  }
}

function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    sum += a[i] * b[i]
  }
  return sum
}

function hashString(str: string): number {
  let hash = 0x9e3779b9
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x85ebca6b)
    hash ^= hash >>> 13
  }
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return hash >>> 0
}

function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0
}
