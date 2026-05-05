export type PreferredModelFamily = "kimi-2.5" | "glm-5" | "minmax-2.5" | "qwen-3.5-plus" | "codex-spark"

const preferredFamilyOrder: PreferredModelFamily[] = ["kimi-2.5", "glm-5", "minmax-2.5", "qwen-3.5-plus", "codex-spark"]

function normalizeModelID(modelID: string) {
  return modelID.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

export function preferredModelFamily(modelID: string): PreferredModelFamily | undefined {
  const normalized = normalizeModelID(modelID)
  if (normalized.includes("kimi") && (normalized.includes("k25") || normalized.includes("k2p5"))) {
    return "kimi-2.5"
  }
  if (normalized.includes("glm5")) {
    return "glm-5"
  }
  if (normalized.includes("minimaxm25") || normalized.includes("minimax25")) {
    return "minmax-2.5"
  }
  if (normalized.includes("qwen35plus")) {
    return "qwen-3.5-plus"
  }
  if (normalized.includes("codexspark")) {
    return "codex-spark"
  }
  return
}

export function isPreferredModel(modelID: string) {
  return preferredModelFamily(modelID) !== undefined
}

export function preferredModelRank(modelID: string) {
  const family = preferredModelFamily(modelID)
  if (!family) return Number.POSITIVE_INFINITY
  return preferredFamilyOrder.indexOf(family)
}

export function sortPreferredModels<T>(items: T[], getModelID: (item: T) => string) {
  return [...items].sort((a, b) => {
    const rankDiff = preferredModelRank(getModelID(a)) - preferredModelRank(getModelID(b))
    if (rankDiff !== 0) return rankDiff
    return getModelID(a).localeCompare(getModelID(b))
  })
}
