import { afterEach, describe, expect, test } from "bun:test"
import { RetrievalPolicy } from "../../src/retrieval/policy"
import { classifyRetrievalIntent, routeRetrievalPolicyByIntent } from "../../src/retrieval/prompt"

describe("retrieval.policy", () => {
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_BASE_URL
    delete process.env.OPENCODE_RETRIEVAL_OPENROUTER_EMBEDDING_MODEL
    delete process.env.OPENCODE_RETRIEVAL_OPENROUTER_RERANK_MODEL
    delete process.env.OPENCODE_RETRIEVAL_FAST_OPENROUTER_EMBEDDING_MODEL
    delete process.env.OPENCODE_RETRIEVAL_FAST_OPENROUTER_RERANK_MODEL
    delete process.env.OPENCODE_RETRIEVAL_QUALITY_OPENROUTER_EMBEDDING_MODEL
    delete process.env.OPENCODE_RETRIEVAL_QUALITY_OPENROUTER_RERANK_MODEL
    delete process.env.OPENCODE_RETRIEVAL_AUTO_OPENROUTER_EMBEDDING_MODEL
    delete process.env.OPENCODE_RETRIEVAL_AUTO_OPENROUTER_RERANK_MODEL
  })

  test("fast uses a matched 0.6B embedder and reranker lane", () => {
    const policy = RetrievalPolicy.resolve("fast")

    expect(policy.embedder?.modelID).toBe("qwen3-embedding-0.6b")
    expect(policy.reranker?.modelID).toBe("qwen3-reranker-0.6b")
    expect(policy.metadata?.strategy).toBe("matched_pair")
    expect(policy.metadata?.indexSpace).toBe("qwen3-embedding-0.6b")
    expect(policy.embedder?.settings?.indexSpace).toBe("qwen3-embedding-0.6b")
    expect(policy.embedder?.settings?.runtime).toBe("cuda")
  })

  test("quality uses a higher-capacity 4B embedder index space with the local reranker lane", () => {
    const policy = RetrievalPolicy.resolve("quality")

    expect(policy.embedder?.modelID).toBe("qwen3-embedding-4b-gguf")
    expect(policy.reranker?.modelID).toBe("qwen3-reranker-0.6b")
    expect(policy.metadata?.strategy).toBe("matched_pair")
    expect(policy.metadata?.indexSpace).toBe("qwen3-embedding-4b-gguf")
    expect(policy.embedder?.settings?.indexSpace).toBe("qwen3-embedding-4b-gguf")
    expect(policy.embedder?.settings?.runtime).toBe("cuda")
  })

  test("auto defaults to the low-latency matched 0.6B retrieval lane", () => {
    const policy = RetrievalPolicy.resolve("auto")

    expect(policy.embedder?.modelID).toBe("qwen3-embedding-0.6b")
    expect(policy.reranker?.modelID).toBe("qwen3-reranker-0.6b")
    expect(policy.metadata?.strategy).toBe("matched_pair")
    expect(policy.metadata?.indexSpace).toBe("qwen3-embedding-0.6b")
    expect(policy.metadata?.intendedUse).toBe("always_on_low_latency_default")
    expect(policy.embedder?.settings?.indexSpace).toBe("qwen3-embedding-0.6b")
    expect(policy.embedder?.settings?.runtime).toBe("cuda")
    expect(policy.reranker?.settings?.runtime).toBe("cuda")
  })

  test("optionally uses OpenRouter-first retrieval models with local qwen fallback metadata", () => {
    process.env.OPENROUTER_API_KEY = "openrouter-key"
    process.env.OPENCODE_RETRIEVAL_OPENROUTER_EMBEDDING_MODEL = "qwen/qwen3-embedding-4b"
    process.env.OPENCODE_RETRIEVAL_OPENROUTER_RERANK_MODEL = "qwen/qwen3-reranker-4b"

    const policy = RetrievalPolicy.resolve("quality")

    expect(policy.embedder?.providerID).toBe("openrouter")
    expect(policy.embedder?.modelID).toBe("qwen/qwen3-embedding-4b")
    expect(policy.embedder?.settings?.baseURL).toBe("https://openrouter.ai/api/v1")
    expect(policy.embedder?.settings?.runtime).toBe("remote")
    expect(policy.embedder?.settings?.indexSpace).toBe("openrouter:qwen/qwen3-embedding-4b")
    expect(policy.reranker?.providerID).toBe("openrouter")
    expect(policy.reranker?.modelID).toBe("qwen/qwen3-reranker-4b")
    expect(policy.reranker?.settings?.runtime).toBe("remote")
    expect(policy.metadata?.retrievalProvider).toBe("openrouter_primary_local_fallback")
    expect((policy.embedder?.settings as any)?.localFallbackModel?.providerID).toBe("local")
    expect((policy.reranker?.settings as any)?.localFallbackModel?.providerID).toBe("local")
  })

  test("classifies file, compaction, shorthand decision, and adversarial mixed intents from query text", () => {
    expect(
      classifyRetrievalIntent({
        query: "which file owns scoped feedback bias and retrieval run metadata",
      }),
    ).toBe("file")
    expect(
      classifyRetrievalIntent({
        query: "which file owns the short query compaction baton heuristic",
      }),
    ).toBe("file")
    expect(
      classifyRetrievalIntent({
        query: "keep foo.ts alive through compaction",
      }),
    ).toBe("compaction")
    expect(
      classifyRetrievalIntent({
        query: "what was the do not share vectors rule again for fast quality and auto",
      }),
    ).toBe("decision")
    expect(
      classifyRetrievalIntent({
        query: "which file had the rule about auto and quality not sharing vectors and what was the rule exactly",
      }),
    ).toBe("decision")
    expect(
      classifyRetrievalIntent({
        query: "which file had that fallback bug where ordering changed under us and what fixed it",
      }),
    ).toBe("recovery")
    expect(
      classifyRetrievalIntent({
        query: "what exactly defines embedding cache identity for a retrieval chunk now",
      }),
    ).toBe("decision")
    expect(
      classifyRetrievalIntent({
        query: "where did we fix stale chunk vectors after embedder instruction semantics changed",
      }),
    ).toBe("recovery")
    expect(
      classifyRetrievalIntent({
        query: "what was the degraded mode lie fix and which rule made recall tell the truth",
      }),
    ).toBe("recovery")
    expect(
      classifyRetrievalIntent({
        query: "keep the service.ts owner note and the index space rule alive when this gets compacted",
      }),
    ).toBe("compaction")
    expect(
      classifyRetrievalIntent({
        query: "show the pattern for finding the right patch first and only then the right file to touch",
      }),
    ).toBe("task_pattern")
  })

  test("routes only the auto lane and stamps routing metadata", () => {
    const routedAuto = routeRetrievalPolicyByIntent({
      policy: RetrievalPolicy.resolve("auto"),
      query: "which file owns scoped feedback bias and retrieval run metadata",
    })
    const untouchedQuality = routeRetrievalPolicyByIntent({
      policy: RetrievalPolicy.resolve("quality"),
      query: "which file owns scoped feedback bias and retrieval run metadata",
    })

    expect(routedAuto.metadata?.routingMode).toBe("intent_router")
    expect(routedAuto.metadata?.routingApplied).toBe(true)
    expect(routedAuto.metadata?.routedIntent).toBe("file")
    expect(routedAuto.metadata?.baseEmbedderInstructionPreset).toBe("memory.task_pattern")
    expect(routedAuto.metadata?.baseRerankerInstructionPreset).toBe("memory.decision")
    expect(routedAuto.embedder?.instructionPreset).toBeUndefined()
    expect(routedAuto.reranker?.instructionPreset).toBeUndefined()
    expect(routedAuto.embedder?.instruction).toContain("exact file paths")
    expect(routedAuto.reranker?.instruction).toContain("exact file or module")

    expect(untouchedQuality).toEqual(RetrievalPolicy.resolve("quality"))
  })

  test("uses a dual-intent blend when the query is low-confidence between two intents", () => {
    const routedAuto = routeRetrievalPolicyByIntent({
      policy: RetrievalPolicy.resolve("auto"),
      query: "which file owns the fallback diagnostics fix",
    })

    expect(routedAuto.metadata?.routingMode).toBe("intent_router")
    expect(routedAuto.metadata?.routingConfidence).toBe("low")
    expect(routedAuto.metadata?.routingStrategy).toBe("dual_intent_blend")
    expect(routedAuto.metadata?.routedIntent).toBe("file")
    expect(routedAuto.metadata?.routedIntentSecondary).toBe("recovery")
    expect(routedAuto.embedder?.instructionPreset).toBeUndefined()
    expect(routedAuto.reranker?.instructionPreset).toBeUndefined()
    expect(routedAuto.embedder?.instruction).toContain("Ambiguous retrieval query between file and recovery")
    expect(routedAuto.reranker?.instruction).toContain("Ambiguous retrieval query between file and recovery")
    expect(routedAuto.embedder?.instruction).toContain("Primary file:")
    expect(routedAuto.embedder?.instruction).toContain("Secondary recovery:")
  })

  test("routes evidence-like governing-fact queries through the decision memory lane", () => {
    const query =
      "what governing facts and settled constraints support the decision to add narrow continuity families before broad prompt injection"
    const routedAuto = routeRetrievalPolicyByIntent({
      policy: RetrievalPolicy.resolve("auto"),
      query,
    })

    expect(classifyRetrievalIntent({
      query,
    })).toBe("decision")
    expect(routedAuto.metadata?.routingMode).toBe("intent_router")
    expect(routedAuto.metadata?.routingApplied).toBe(true)
    expect(routedAuto.metadata?.routedIntent).toBe("decision")
    expect(routedAuto.embedder?.instructionPreset).toBe("memory.decision")
    expect(routedAuto.reranker?.instructionPreset).toBe("memory.decision")
  })

  test("routes explicit evidence queries through the evidence memory lane", () => {
    const query =
      "what verified evidence, source anchors, and trust basis support the current retrieval-first continuity plan"
    const routedAuto = routeRetrievalPolicyByIntent({
      policy: RetrievalPolicy.resolve("auto"),
      query,
    })

    expect(classifyRetrievalIntent({ query })).toBe("evidence")
    expect(routedAuto.metadata?.routingMode).toBe("intent_router")
    expect(routedAuto.metadata?.routingApplied).toBe(true)
    expect(routedAuto.metadata?.routedIntent).toBe("evidence")
    expect(routedAuto.embedder?.instructionPreset).toBe("memory.evidence")
    expect(routedAuto.reranker?.instructionPreset).toBe("memory.evidence")
  })
})
