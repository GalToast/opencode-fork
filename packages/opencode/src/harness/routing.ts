import { Provider } from "@/provider/provider"
import { HarnessState } from "./state"

type HarnessRole = "author" | "reviewer"

type Candidate = {
  id: string
  providerID: string
  modelID: string
  reasoning: number
  coding: number
  context: number
  output: number
}

function baseCandidateScore(role: HarnessRole, candidate: Candidate) {
  if (role === "author") {
    return candidate.coding * 3 + candidate.reasoning * 2 + candidate.context / 100_000 + candidate.output / 100_000
  }
  return candidate.reasoning * 4 + candidate.context / 100_000 + candidate.output / 100_000 + candidate.coding
}

async function candidateModels(role: HarnessRole) {
  const providers = await Provider.list().catch(() => undefined)
  if (!providers) return [] as Candidate[]
  return Object.values(providers).flatMap((provider) =>
    Object.values(provider.models)
      .map((model) => ({
        id: `${provider.id}/${model.id}`,
        providerID: provider.id,
        modelID: model.id,
        reasoning: Number(model.capabilities.reasoning),
        coding: Number(model.capabilities.toolcall && model.capabilities.input.text && model.capabilities.output.text),
        context: model.limit.context,
        output: model.limit.output,
      }))
      .filter((candidate) => (role === "author" ? candidate.coding > 0 : candidate.reasoning > 0)),
  )
}

function accumulateOutcomeScores(observations: HarnessState.Observation[]) {
  const scores = new Map<string, number>()
  const add = (model: string | undefined, delta: number) => {
    if (!model) return
    scores.set(model, (scores.get(model) ?? 0) + delta)
  }

  for (const observation of observations) {
    const data = observation.data ?? {}
    const model = typeof data.model === "string" ? data.model : undefined
    switch (observation.kind) {
      case "patch.generated":
        add(model, data.attempts === 1 ? 3 : 1)
        break
      case "patch.generation_retry":
        add(model, -2)
        break
      case "review.completed":
        add(model, data.reviewMode === "text_fallback" ? 0 : 2)
        break
      case "review.fallback":
        add(model, -2)
        break
      default:
        break
    }
  }

  return scores
}

export async function chooseHarnessModel(input: {
  role: HarnessRole
  fallback: string
  excludeProviderID?: string
}) {
  const candidates = (await candidateModels(input.role)).filter((candidate) =>
    input.excludeProviderID ? candidate.providerID !== input.excludeProviderID : true,
  )
  if (candidates.length === 0) return input.fallback

  const observations = await HarnessState.listObservations(250).catch(() => [])
  const scores = accumulateOutcomeScores(observations)

  const best = [...candidates].sort((left, right) => {
    const leftScore = (scores.get(left.id) ?? 0) + baseCandidateScore(input.role, left)
    const rightScore = (scores.get(right.id) ?? 0) + baseCandidateScore(input.role, right)
    if (leftScore !== rightScore) return rightScore - leftScore
    return left.id.localeCompare(right.id)
  })[0]

  return best?.id ?? input.fallback
}
