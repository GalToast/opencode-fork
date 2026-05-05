export type ExecutionBriefContract = {
  checkpoints?: string[]
  invalidationSignals?: string[]
  contingencyActions?: string[]
}

export const ExecutionBriefLabels = {
  checkpoints: "Execution checkpoints",
  invalidationSignals: "Invalidation signals",
  contingencyActions: "Contingency actions",
} as const

export function parseExecutionBriefLine(text: string | undefined, label: string) {
  const prefix = `${label}:`
  const line = text
    ?.split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
  if (!line) return []
  return line
    .slice(prefix.length)
    .split(/\s+\|\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function parseExecutionBriefContract(text: string | undefined): ExecutionBriefContract {
  return {
    checkpoints: parseExecutionBriefLine(text, ExecutionBriefLabels.checkpoints),
    invalidationSignals: parseExecutionBriefLine(text, ExecutionBriefLabels.invalidationSignals),
    contingencyActions: parseExecutionBriefLine(text, ExecutionBriefLabels.contingencyActions),
  }
}

export function executionBriefContractLines(contract: ExecutionBriefContract) {
  return [
    contract.checkpoints?.length ? `${ExecutionBriefLabels.checkpoints}: ${contract.checkpoints.join(" | ")}` : undefined,
    contract.invalidationSignals?.length
      ? `${ExecutionBriefLabels.invalidationSignals}: ${contract.invalidationSignals.join(" | ")}`
      : undefined,
    contract.contingencyActions?.length
      ? `${ExecutionBriefLabels.contingencyActions}: ${contract.contingencyActions.join(" | ")}`
      : undefined,
  ].filter((line): line is string => !!line)
}
