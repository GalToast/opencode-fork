export const ALIBABA_CODING_PLAN_CATEGORY = "Alibaba Coding Plan"
export const ALIBABA_API_PACK_CATEGORY = "Alibaba API Pack"

export function isAlibabaCodingPlanProvider(input: { id: string; name?: string }) {
  return /coding[\s-_]*plan/i.test(input.id) || /coding[\s-_]*plan/i.test(input.name ?? "")
}

function isAlibabaApiPackProvider(input: { id: string; name?: string }) {
  if (isAlibabaCodingPlanProvider(input)) return false
  return input.id === "alibaba-cn" || /^alibaba(?:[-_]|$)/i.test(input.id) || /dashscope|alibaba/i.test(input.name ?? "")
}

export function modelSelectorCategory(input: {
  provider: { id: string; name: string }
  model?: { providerID?: string }
}) {
  const provider = {
    id: input.model?.providerID ?? input.provider.id,
    name: input.provider.name,
  }
  if (isAlibabaCodingPlanProvider(provider)) return ALIBABA_CODING_PLAN_CATEGORY
  if (isAlibabaApiPackProvider(provider)) return ALIBABA_API_PACK_CATEGORY
  return input.provider.name
}

export function keepModelVisibleInProviderSection(input: { providerID: string; providerName?: string }) {
  return isAlibabaCodingPlanProvider({
    id: input.providerID,
    name: input.providerName,
  })
}

export function keepModelOutOfExtraSections(input: { providerID: string; providerName?: string }) {
  return keepModelVisibleInProviderSection(input)
}

export function dialogSelectableProviderModels<T extends { providerID: string; status?: string }>(input: {
  models: Record<string, T>
  providerID?: string
}) {
  return Object.entries(input.models).filter(([_, info]) => {
    if (info.status === "deprecated") return false
    if (input.providerID && info.providerID !== input.providerID) return false
    return true
  })
}

export function formatModelOptionDescription(input: {
  providerName: string
  favorite?: boolean
}) {
  return input.favorite ? `${input.providerName} - Favorite` : input.providerName
}
