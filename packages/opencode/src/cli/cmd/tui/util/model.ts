import type { Model, Provider } from "@opencode-ai/sdk/v2"

export function index(list: Provider[] | undefined): Map<string, Provider> {
  return new Map<string, Provider>((list ?? []).map((item): [string, Provider] => [item.id, item]))
}

export function get(
  list: Provider[] | ReadonlyMap<string, Provider> | undefined,
  providerID: string,
  modelID: string,
): Model | undefined {
  if (!list) return undefined
  const provider: Provider | undefined = Array.isArray(list) ? list.find((item) => item.id === providerID) : list.get(providerID)
  return provider?.models[modelID]
}

export function name(
  list: Provider[] | ReadonlyMap<string, Provider> | undefined,
  providerID: string,
  modelID: string,
): string {
  return get(list, providerID, modelID)?.name ?? modelID
}
