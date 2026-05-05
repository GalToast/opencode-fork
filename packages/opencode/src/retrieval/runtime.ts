import type { RetrievalPolicyName } from "./types"

interface EmbedHook {
  (input: { text: string; policy: { name: RetrievalPolicyName; embedder?: unknown }; purpose: string }): Promise<{
    vector: number[]
    dimensions: number
    metadata?: Record<string, unknown>
  }>
}

interface RerankHook {
  (input: {
    policy: { name: RetrievalPolicyName; reranker?: unknown }
    queryText: string
    queryVector: number[]
    candidates: Array<{ score?: number; documentID?: string; chunkID?: string; text?: string; metadata?: Record<string, unknown>; [key: string]: unknown }>
    candidateVectors: Map<string, number[]>
  }): Promise<{
    candidates: Array<{ score?: number; documentID?: string; chunkID?: string; text?: string; metadata?: Record<string, unknown>; [key: string]: unknown }>
    metadata?: Record<string, unknown>
  }>
}

interface RuntimeConfig {
  embedText?: EmbedHook
  rerank?: RerankHook
}

let config: RuntimeConfig | null = null

export namespace RetrievalRuntime {
  export function configure(input: { embedText?: EmbedHook; rerank?: RerankHook }): void {
    config = { ...input }
  }

  export function reset(): void {
    config = null
  }

  export function isConfigured(): boolean {
    return config != null && (config.embedText != null || config.rerank != null)
  }

  export async function embedText(input: {
    text: string
    policy: { name: RetrievalPolicyName; embedder?: unknown }
    purpose: string
  }): Promise<{ vector: number[]; dimensions: number; metadata?: Record<string, unknown> }> {
    if (config?.embedText) {
      return config.embedText(input)
    }

    if (input.policy?.embedder) {
      const embedder = input.policy.embedder as {
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
        }
      }

      if (embedder.settings?.baseURL) {
        const result = await callProviderEmbed(input.text, embedder, input.purpose)
        if (result) {
          return result
        }
      }
    }

    return syntheticEmbed(input.text, input.purpose)
  }

  export async function rerank(input: {
    policy: { name: RetrievalPolicyName; reranker?: unknown }
    queryText: string
    queryVector: number[]
    candidates: Array<{ score?: number; documentID?: string; chunkID?: string; text?: string; metadata?: Record<string, unknown>; [key: string]: unknown }>
    candidateVectors: Map<string, number[]>
  }): Promise<{ candidates: Array<{ score?: number; documentID?: string; chunkID?: string; text?: string; metadata?: Record<string, unknown>; [key: string]: unknown }>; metadata?: Record<string, unknown> }> {
    if (config?.rerank) {
      return config.rerank(input)
    }

    if (input.policy?.reranker) {
      const reranker = input.policy.reranker as {
        providerID?: string
        modelID?: string
        instructionPreset?: string
        instruction?: string
        outputType?: string
        settings?: {
          baseURL?: string
          apiKey?: string
        }
      }

      if (reranker.settings?.baseURL) {
        const result = await callProviderRerank(input, reranker)
        if (result) {
          return result
        }
      }
    }

    return syntheticRerank(input)
  }
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

    if (embedder.settings?.apiKey) {
      headers.Authorization = `Bearer ${embedder.settings.apiKey}`
    }

    const response = await fetch(`${baseURL}/embeddings`, {
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

    const response = await fetch(`${baseURL}/rerank`, {
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
      "Retrieve similar failures, regressions, and recoveries. Focus on the failure pattern, root cause, and successful recovery path. Consider the index-space of prior incidents.",
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
