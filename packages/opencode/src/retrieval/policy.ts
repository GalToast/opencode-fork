export type RetrievalPolicyName = "auto" | "fast" | "quality" | "local" | "isolated"

export interface RetrievalPolicyConfig {
  name: RetrievalPolicyName
  embedder?: {
    providerID?: string
    modelID: string
    instructionPreset?: string
    instruction?: string
    settings: {
      indexSpace: string
      runtime: "cuda" | "remote"
      baseURL?: string
      localFallbackModel?: {
        providerID: string
        modelID: string
        settings: {
          indexSpace: string
          runtime: "cuda"
        }
      }
    }
  }
  reranker?: {
    providerID?: string
    modelID: string
    instructionPreset?: string
    instruction?: string
    settings: {
      runtime: "cuda" | "remote"
      localFallbackModel?: {
        providerID: string
        modelID: string
        settings: {
          runtime: "cuda"
        }
      }
    }
  }
  metadata?: {
    strategy: string
    indexSpace: string
    intendedUse?: string
    retrievalProvider?: string
    routingMode?: string
    routingApplied?: boolean
    routingConfidence?: string
    routingStrategy?: string
    routedIntent?: string
    routedIntentSecondary?: string
    baseEmbedderInstructionPreset?: string
    baseRerankerInstructionPreset?: string
  }
}

const LOCAL_EMBEDDER_MODEL = "qwen3-embedding-0.6b"
const QUALITY_EMBEDDER_MODEL = "qwen3-embedding-4b-gguf"
const LOCAL_RERANKER_MODEL = "qwen3-reranker-0.6b"

function isOpenRouterEnabled(): boolean {
  return !!process.env.OPENROUTER_API_KEY
}

function getOpenRouterEmbedderModel(): string {
  return (
    process.env.OPENCODE_RETRIEVAL_OPENROUTER_EMBEDDING_MODEL ||
    process.env.OPENCODE_RETRIEVAL_FAST_OPENROUTER_EMBEDDING_MODEL ||
    process.env.OPENCODE_RETRIEVAL_QUALITY_OPENROUTER_EMBEDDING_MODEL ||
    process.env.OPENCODE_RETRIEVAL_AUTO_OPENROUTER_EMBEDDING_MODEL ||
    "qwen/qwen3-embedding-4b"
  )
}

function getOpenRouterRerankerModel(): string {
  return (
    process.env.OPENCODE_RETRIEVAL_OPENROUTER_RERANK_MODEL ||
    process.env.OPENCODE_RETRIEVAL_FAST_OPENROUTER_RERANK_MODEL ||
    process.env.OPENCODE_RETRIEVAL_QUALITY_OPENROUTER_RERANK_MODEL ||
    process.env.OPENCODE_RETRIEVAL_AUTO_OPENROUTER_RERANK_MODEL ||
    "qwen/qwen3-reranker-4b"
  )
}

function createLocalEmbedderConfig(
  indexSpace: string,
  modelID = LOCAL_EMBEDDER_MODEL,
): RetrievalPolicyConfig["embedder"] {
  return {
    modelID,
    settings: {
      indexSpace,
      runtime: "cuda",
    },
  }
}

function createLocalRerankerConfig(): RetrievalPolicyConfig["reranker"] {
  return {
    modelID: LOCAL_RERANKER_MODEL,
    settings: {
      runtime: "cuda",
    },
  }
}

function createOpenRouterEmbedderConfig(modelID: string): RetrievalPolicyConfig["embedder"] {
  const indexSpace = `openrouter:${modelID}`
  return {
    providerID: "openrouter" as any,
    modelID,
    settings: {
      indexSpace,
      runtime: "remote",
      baseURL: "https://openrouter.ai/api/v1",
      localFallbackModel: {
        providerID: "local" as any,
        modelID: LOCAL_EMBEDDER_MODEL,
        settings: {
          indexSpace: LOCAL_EMBEDDER_MODEL,
          runtime: "cuda",
        },
      },
    },
  }
}

function createOpenRouterRerankerConfig(modelID: string): RetrievalPolicyConfig["reranker"] {
  return {
    providerID: "openrouter" as any,
    modelID,
    settings: {
      runtime: "remote",
      localFallbackModel: {
        providerID: "local" as any,
        modelID: LOCAL_RERANKER_MODEL,
        settings: {
          runtime: "cuda",
        },
      },
    },
  }
}

export namespace RetrievalPolicy {
  export function resolve(name: RetrievalPolicyName): RetrievalPolicyConfig {
    const openRouterEnabled = isOpenRouterEnabled()

    if (name === "fast") {
      if (openRouterEnabled) {
        const embedderModel = process.env.OPENCODE_RETRIEVAL_FAST_OPENROUTER_EMBEDDING_MODEL || getOpenRouterEmbedderModel()
        const rerankerModel = process.env.OPENCODE_RETRIEVAL_FAST_OPENROUTER_RERANK_MODEL || getOpenRouterRerankerModel()
        return {
          name,
          embedder: createOpenRouterEmbedderConfig(embedderModel),
          reranker: createOpenRouterRerankerConfig(rerankerModel),
          metadata: {
            strategy: "matched_pair",
            indexSpace: `openrouter:${embedderModel}`,
            retrievalProvider: "openrouter_primary_local_fallback",
          },
        }
      }
      return {
        name,
        embedder: createLocalEmbedderConfig(LOCAL_EMBEDDER_MODEL),
        reranker: createLocalRerankerConfig(),
        metadata: {
          strategy: "matched_pair",
          indexSpace: LOCAL_EMBEDDER_MODEL,
        },
      }
    }

    if (name === "quality") {
      if (openRouterEnabled) {
        const embedderModel = process.env.OPENCODE_RETRIEVAL_QUALITY_OPENROUTER_EMBEDDING_MODEL || getOpenRouterEmbedderModel()
        const rerankerModel = process.env.OPENCODE_RETRIEVAL_QUALITY_OPENROUTER_RERANK_MODEL || getOpenRouterRerankerModel()
        return {
          name,
          embedder: createOpenRouterEmbedderConfig(embedderModel),
          reranker: createOpenRouterRerankerConfig(rerankerModel),
          metadata: {
            strategy: "matched_pair",
            indexSpace: `openrouter:${embedderModel}`,
            retrievalProvider: "openrouter_primary_local_fallback",
          },
        }
      }
      return {
        name,
        embedder: createLocalEmbedderConfig(QUALITY_EMBEDDER_MODEL, QUALITY_EMBEDDER_MODEL),
        reranker: createLocalRerankerConfig(),
        metadata: {
          strategy: "matched_pair",
          indexSpace: QUALITY_EMBEDDER_MODEL,
        },
      }
    }

    if (name === "auto") {
      if (openRouterEnabled) {
        const embedderModel = process.env.OPENCODE_RETRIEVAL_AUTO_OPENROUTER_EMBEDDING_MODEL || getOpenRouterEmbedderModel()
        const rerankerModel = process.env.OPENCODE_RETRIEVAL_AUTO_OPENROUTER_RERANK_MODEL || getOpenRouterRerankerModel()
        return {
          name,
          embedder: createOpenRouterEmbedderConfig(embedderModel),
          reranker: createOpenRouterRerankerConfig(rerankerModel),
          metadata: {
            strategy: "matched_pair",
            indexSpace: `openrouter:${embedderModel}`,
            intendedUse: "always_on_low_latency_default",
            retrievalProvider: "openrouter_primary_local_fallback",
          },
        }
      }
      return {
        name,
        embedder: createLocalEmbedderConfig(LOCAL_EMBEDDER_MODEL),
        reranker: createLocalRerankerConfig(),
        metadata: {
          strategy: "matched_pair",
          indexSpace: LOCAL_EMBEDDER_MODEL,
          intendedUse: "always_on_low_latency_default",
        },
      }
    }

    return {
      name,
      embedder: createLocalEmbedderConfig(LOCAL_EMBEDDER_MODEL),
      reranker: createLocalRerankerConfig(),
      metadata: {
        strategy: "matched_pair",
        indexSpace: LOCAL_EMBEDDER_MODEL,
      },
    }
  }
}
