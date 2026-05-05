export type ModelSelection = {
  providerID: string
  modelID: string
}

export type PersistedModelSelectionState = {
  model: Record<string, ModelSelection>
  recent: ModelSelection[]
  favorite: ModelSelection[]
  variant: Record<string, string | undefined>
}

export function resolveStartupModelSelection(input: {
  requested?: ModelSelection
  requestedValid: boolean
  providerCatalogReady: boolean
}) {
  if (!input.requested) {
    return {
      state: "none" as const,
      model: undefined,
    }
  }
  if (!input.providerCatalogReady) {
    return {
      state: "pending" as const,
      model: input.requested,
    }
  }
  return {
    state: input.requestedValid ? ("apply" as const) : ("invalid" as const),
    model: input.requested,
  }
}

export function shouldHydrateAgentDefaultModel(input: {
  stored?: ModelSelection
  storedValid: boolean
  agentDefault?: ModelSelection
  agentDefaultValid: boolean
}) {
  if (!input.agentDefault || !input.agentDefaultValid) return false
  if (!input.stored) return true
  return !input.storedValid
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined
  return value as Record<string, unknown>
}

function getString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  return typeof field === "string" ? field : undefined
}

function isModelSelection(value: unknown): value is ModelSelection {
  const record = getRecord(value)
  if (!record) return false
  return typeof getString(record, "providerID") === "string" && typeof getString(record, "modelID") === "string"
}

export function parsePersistedModelSelectionState(value: unknown): PersistedModelSelectionState {
  const input = getRecord(value) ?? {}
  const model = getRecord(input.model) ?? {}
  const recent = Array.isArray(input.recent) ? input.recent : []
  const favorite = Array.isArray(input.favorite) ? input.favorite : []
  const variant = getRecord(input.variant) ?? {}

  const modelEntries = Object.entries(model).filter((entry): entry is [string, ModelSelection] => {
    const [agentName, selection] = entry
    return typeof agentName === "string" && isModelSelection(selection)
  })

  return {
    model: Object.fromEntries(
      modelEntries.map(([agentName, selection]) => [
        agentName,
        {
          providerID: selection.providerID,
          modelID: selection.modelID,
        },
      ]),
    ),
    recent: recent.filter(isModelSelection),
    favorite: favorite.filter(isModelSelection),
    variant: Object.fromEntries(
      Object.entries(variant).filter(
        (entry): entry is [string, string | undefined] =>
          typeof entry[0] === "string" && (typeof entry[1] === "string" || entry[1] === undefined),
      ),
    ),
  }
}

export function serializePersistedModelSelectionState(input: PersistedModelSelectionState): PersistedModelSelectionState {
  return {
    model: Object.fromEntries(
      Object.entries(input.model).map(([agentName, selection]) => [
        agentName,
        {
          providerID: selection.providerID,
          modelID: selection.modelID,
        },
      ]),
    ),
    recent: input.recent.map((selection) => ({
      providerID: selection.providerID,
      modelID: selection.modelID,
    })),
    favorite: input.favorite.map((selection) => ({
      providerID: selection.providerID,
      modelID: selection.modelID,
    })),
    variant: { ...input.variant },
  }
}
