// Hypothesis Testing — enables the agent to form hypotheses about code
// behavior, design test experiments, and validate them. This is the
// "scientific method" for autonomous debugging.

import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "session.hypothesis" })

export type HypothesisStatus =
  | "proposed"
  | "testing"
  | "supported"
  | "refuted"
  | "inconclusive"

export type Experiment = {
  id: string
  description: string
  tool: string
  args: Record<string, unknown>
  expected: string
  actual?: string
  passed?: boolean
  at?: number
}

export type Hypothesis = {
  id: string
  sessionID: string
  statement: string
  rationale: string
  status: HypothesisStatus
  confidence: number
  experiments: Experiment[]
  conclusion?: string
  at: number
}

// Active hypotheses per session
const active = Instance.state(() => new Map<string, Hypothesis[]>())

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function propose(input: {
  sessionID: string
  statement: string
  rationale: string
  confidence?: number
}): Hypothesis {
  const hypothesis: Hypothesis = {
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    statement: input.statement,
    rationale: input.rationale,
    status: "proposed",
    confidence: input.confidence ?? 0.5,
    experiments: [],
    at: Date.now(),
  }

  const list = active().get(input.sessionID) ?? []
  list.push(hypothesis)
  active().set(input.sessionID, list)

  log.debug("hypothesis.proposed", {
    id: hypothesis.id,
    statement: hypothesis.statement.slice(0, 60),
  })

  return hypothesis
}

function experiment(input: {
  sessionID: string
  hypothesisID: string
  description: string
  tool: string
  args: Record<string, unknown>
  expected: string
}): Experiment {
  const hypothesis = find(input.sessionID, input.hypothesisID)
  if (!hypothesis) throw new Error(`Hypothesis not found: ${input.hypothesisID}`)

  hypothesis.status = "testing"

  const exp: Experiment = {
    id: Identifier.ascending("part"),
    description: input.description,
    tool: input.tool,
    args: input.args,
    expected: input.expected,
  }

  hypothesis.experiments.push(exp)
  return exp
}

function observe(input: {
  sessionID: string
  hypothesisID: string
  experimentID: string
  actual: string
  passed: boolean
}) {
  const hypothesis = find(input.sessionID, input.hypothesisID)
  if (!hypothesis) return

  const exp = hypothesis.experiments.find((e) => e.id === input.experimentID)
  if (!exp) return

  exp.actual = input.actual
  exp.passed = input.passed
  exp.at = Date.now()

  // Auto-evaluate after each observation
  evaluate(input.sessionID, input.hypothesisID)
}

function conclude(input: {
  sessionID: string
  hypothesisID: string
  status: "supported" | "refuted" | "inconclusive"
  conclusion: string
}) {
  const hypothesis = find(input.sessionID, input.hypothesisID)
  if (!hypothesis) return

  hypothesis.status = input.status
  hypothesis.conclusion = input.conclusion

  // Adjust confidence based on experiment results
  const total = hypothesis.experiments.filter((e) => e.passed !== undefined)
  const passed = total.filter((e) => e.passed)
  if (total.length > 0) {
    hypothesis.confidence = passed.length / total.length
  }

  log.debug("hypothesis.concluded", {
    id: hypothesis.id,
    status: hypothesis.status,
    confidence: hypothesis.confidence,
    experiments: total.length,
  })

  // Persist refuted hypotheses as negative knowledge
  if (input.status === "refuted") {
    void persistNegative(hypothesis)
  }
}

// ---------------------------------------------------------------------------
// Auto-evaluation
// ---------------------------------------------------------------------------

function evaluate(sessionID: string, hypothesisID: string) {
  const hypothesis = find(sessionID, hypothesisID)
  if (!hypothesis) return

  const results = hypothesis.experiments.filter((e) => e.passed !== undefined)
  if (results.length === 0) return

  const passed = results.filter((e) => e.passed)
  const failed = results.filter((e) => !e.passed)

  // Auto-conclude if we have strong signal
  if (failed.length >= 2 && passed.length === 0) {
    conclude({
      sessionID,
      hypothesisID,
      status: "refuted",
      conclusion: `All ${results.length} experiments failed — hypothesis is refuted`,
    })
  } else if (passed.length >= 3 && failed.length === 0) {
    conclude({
      sessionID,
      hypothesisID,
      status: "supported",
      conclusion: `All ${results.length} experiments passed — hypothesis is supported`,
    })
  }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

function list(sessionID: string): Hypothesis[] {
  return active().get(sessionID) ?? []
}

function pending(sessionID: string): Hypothesis[] {
  return list(sessionID).filter((h) =>
    h.status === "proposed" || h.status === "testing",
  )
}

function find(sessionID: string, hypothesisID: string): Hypothesis | undefined {
  return list(sessionID).find((h) => h.id === hypothesisID)
}

function clear(sessionID: string) {
  active().delete(sessionID)
}

// ---------------------------------------------------------------------------
// Negative knowledge integration
// ---------------------------------------------------------------------------

async function persistNegative(hypothesis: Hypothesis) {
  // Negative knowledge system has been simplified/removed
}

export const HypothesisTesting = {
  propose,
  experiment,
  observe,
  conclude,
  list,
  pending,
  find,
  clear,
} as const
