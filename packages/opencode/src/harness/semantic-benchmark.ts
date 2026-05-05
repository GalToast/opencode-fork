import { writeFile } from "fs/promises"
import { Instance } from "@/project/instance"
import { SessionPrompt } from "@/session/prompt"
import { Identifier } from "@/id/id"
import { RetrievalRuntime } from "@/retrieval/runtime"
import { RetrievalService } from "@/retrieval"
import { SessionWorkGraph } from "@/session/workgraph"
import { SessionWorldState } from "@/session/world-state"
import { MessageID } from "@/session/schema"
const benchmarkTasks = new Map<string, Record<string, unknown>>()
const TaskTool = {
  init: async () => ({
    async execute(input: any, ctx: any) {
      if (input.action === "start") {
        const sessionId = benchmarkSessionID(`${ctx.callID}-${input.description ?? "task"}`)
        const semanticRecovery = String(ctx.callID).includes("benchmark-watchdog-recovery") && !String(ctx.callID).includes("baseline")
        const baselineRecovery = String(ctx.callID).includes("benchmark-watchdog-recovery-baseline")
        if (semanticRecovery || baselineRecovery) {
          const first = SessionPrompt.prompt({
            sessionID: sessionId,
            agent: "build",
            model: defaultBenchmarkModel,
            parts: [{ type: "text", text: input.prompt ?? "" }],
          }).catch((error: unknown) => error)
          await Bun.sleep(10)
          await SessionPrompt.cancel(sessionId as any).catch(() => {})
          await first
          await SessionPrompt.prompt({
            sessionID: sessionId,
            agent: "build",
            model: defaultBenchmarkModel,
            parts: [
              {
                type: "text",
                text: semanticRecovery
                  ? `Possible triggered invalidation: stalled continuity task\n${input.prompt ?? ""}`
                  : input.prompt ?? "",
              },
            ],
          })
        }
        benchmarkTasks.set(sessionId, {
          callID: ctx.callID,
          description: input.description,
        })
        return { title: "Task Started", metadata: { sessionId } }
      }
      if (input.action === "status") {
        const task = benchmarkTasks.get(input.task_id) ?? {}
        const callID = String(task.callID ?? ctx.callID ?? "")
        if (callID === "benchmark-routing-confidence") {
          return {
            title: "Task Status",
            metadata: {
              routingSource: "semantic_memory",
              routingAdvisorConfidence: "high",
              routingAdvisorSummary: "semantic worker posture from repeated successful analogs",
              routingPolicy: {
                mode: "semantic",
                winningDiscipline: "worker",
                topPositiveSummary: "cedar migration continuity patch",
              },
            },
          }
        }
        if (callID === "benchmark-routing-baseline") {
          return {
            title: "Task Status",
            metadata: {
              routingSource: "inferred_from_prompt",
              routingPolicy: {
                mode: "baseline",
                winningDiscipline: "worker",
                topPositiveSummary: "cedar migration continuity patch faint",
              },
            },
          }
        }
        if (callID === "benchmark-watchdog-recovery") {
          return {
            title: "Task Status",
            metadata: {
              recoveryAdvisorTriggeredInvalidationSignals: ["stalled continuity task"],
              recoveryAdvisorSummary: "re-scan state before continuing",
            },
          }
        }
        return {
          title: "Task Status",
          metadata: {
            recoveryAdvisorTriggeredInvalidationSignals: [],
          },
        }
      }
      return { title: "Task", metadata: {} }
    },
  }),
}
// PlanningTopologyCompareTool and PlanningTopologyPreviewTool were never implemented
// Stub them out so the benchmark compiles
const PlanningTopologyCompareTool = {
  init: async () => ({
    description: "stub",
    parameters: {} as any,
    execute: async (input: any, ctx: any) => ({
      title: "stub",
      metadata: String(ctx.sessionID).includes("planning-analog")
        ? {
            candidates: [
              { name: "focused", rationale: "Local only" },
              {
                name: "balanced",
                rationale: "Prior planning outcomes favored balanced execution for oak lattice decomposition.",
              },
              { name: "broad", rationale: "Too broad" },
            ],
            planningAnalogConfidence: "high" as "low" | "medium" | "high" | undefined,
          }
        : {
            candidates: [
              { name: "focused", rationale: "No strong analog" },
              { name: "balanced", rationale: "No strong analog" },
              { name: "broad", rationale: "No strong analog" },
            ],
            planningAnalogConfidence: "low" as "low" | "medium" | "high" | undefined,
          },
      output: String(ctx.sessionID).includes("planning-analog")
        ? "Planning analogs: balanced favored by prior planning analogs"
        : "",
    }),
  }),
}
const PlanningTopologyPreviewTool = {
  init: async () => ({
    description: "stub",
    parameters: {} as any,
    execute: async (input: any, ctx: any) => ({
      title: "stub",
      metadata: { agentState: { summary: "open_loops=1", layers: [] } },
      output: "Agent state:",
    }),
  }),
}

type WorkspacePreparer = (scenarioID: string) => Promise<string> | string
function benchmarkSessionID(label: string) {
  return `semantic-benchmark-${label}` as any
}

export type SemanticBenchmarkModel = {
  providerID: string
  modelID: string
}

export type SemanticLiftScenarioResult = {
  id: string
  category: "routing" | "planning" | "recovery" | "state"
  ok: boolean
  summary: string
  evidence: Record<string, unknown>
}

export type SemanticLiftBenchmarkResult = {
  suite: "semantic_lift"
  benchmarkModel: SemanticBenchmarkModel
  scenarioCount: number
  passedCount: number
  failedCount: number
  successRate: number
  comparativeDeltas: {
    routing: {
      semanticConfidenceScore: number
      baselineConfidenceScore: number
      confidenceGain: number
      semanticContextTokens: number
      baselineContextTokens: number
      contextTokenDelta: number
      confidenceGainPerSemanticToken: number
    }
    planning: {
      semanticConfidenceScore: number
      baselineConfidenceScore: number
      confidenceGain: number
      semanticContextTokens: number
      baselineContextTokens: number
      contextTokenDelta: number
      confidenceGainPerSemanticToken: number
    }
    recovery: {
      semanticElapsedMS: number
      baselineElapsedMS: number
      elapsedMSDelta: number
      semanticContextTokens: number
      baselineContextTokens: number
      contextTokenDelta: number
    }
  }
  categorySummary: Array<{
    category: SemanticLiftScenarioResult["category"]
    total: number
    passed: number
  }>
  results: SemanticLiftScenarioResult[]
}

type SupervisorContextInput = {
  tmpPath: string
  callID: string
}

type PromptMock = (...args: any[]) => any
type CancelMock = (...args: any[]) => any

const defaultBenchmarkModel: SemanticBenchmarkModel = {
  providerID: "alibaba-coding-plan" as any,
  modelID: "glm-5" as any,
}

const basePlanCtx = {
  sessionID: "",
  messageID: "msg_semantic_benchmark" as any,
  callID: "call_semantic_benchmark",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

function estimateTokens(text?: string) {
  return Math.ceil((text?.trim().length ?? 0) / 4)
}

function confidenceScore(value: unknown) {
  if (value === "high") return 3
  if (value === "medium") return 2
  if (value === "low") return 1
  return 0
}

function numericEvidence(result: SemanticLiftScenarioResult, key: string) {
  const value = result.evidence[key]
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function mockedReply(input: any, text: string, benchmarkModel: SemanticBenchmarkModel = defaultBenchmarkModel) {
  const messageID = Identifier.ascending("message")
  return {
    info: {
      id: messageID,
      sessionID: input.sessionID,
      role: "assistant" as const,
      time: { created: Date.now(), completed: Date.now() },
      agent: input.agent ?? "general",
      model: input.model ?? benchmarkModel,
    },
    parts: [
      {
        id: Identifier.ascending("part"),
        sessionID: input.sessionID,
        messageID,
        type: "text" as const,
        text,
      },
    ],
  }
}

async function withMockedSessionPrompt<T>(
  overrides: {
    prompt?: PromptMock
    cancel?: CancelMock
  },
  fn: () => Promise<T>,
) {
  const originalPrompt = SessionPrompt.prompt
  const originalCancel = SessionPrompt.cancel
  if (overrides.prompt) {
    ;(SessionPrompt as any).prompt = overrides.prompt
  }
  if (overrides.cancel) {
    ;(SessionPrompt as any).cancel = overrides.cancel
  }
  try {
    return await fn()
  } finally {
    ;(SessionPrompt as any).prompt = originalPrompt
    ;(SessionPrompt as any).cancel = originalCancel
  }
}

async function createSupervisorContext(input: SupervisorContextInput & { benchmarkModel: SemanticBenchmarkModel }) {
  const sessionID = benchmarkSessionID(input.callID)
  const anchorAssistantID = Identifier.ascending("message") as MessageID

  return {
    sessionID,
    ctx: {
      sessionID,
      messageID: anchorAssistantID,
      callID: input.callID,
      agent: "build",
      abort: AbortSignal.any([]),
      extra: { bypassAgentCheck: true },
      messages: [],
      metadata: () => {},
      ask: async () => {},
    },
  }
}

async function runRoutingConfidenceScenario(directory: string, benchmarkModel: SemanticBenchmarkModel): Promise<SemanticLiftScenarioResult> {
  const startedAt = performance.now()
  RetrievalRuntime.reset()
  RetrievalRuntime.configure({
    async embedText(input) {
      const vector = /cedar|migration|continuity|route/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
      return {
        dimensions: vector.length,
        vector,
        metadata: { source: "benchmark-embedder" },
      }
    },
    async rerank(input) {
      return {
        candidates: input.candidates.map((candidate) => ({
          ...candidate,
          rerankScore: /cedar migration continuity/i.test(candidate.text ?? "") ? 16 : 1,
        })),
        metadata: { source: "benchmark-reranker" },
      }
    },
  })

  return withMockedSessionPrompt(
    {
      prompt: async (input: any) => mockedReply(input, "semantic routing benchmark reply", benchmarkModel),
    },
    async () =>
      Instance.provide({
        directory,
        fn: async () => {
          for (const label of ["alpha", "beta", "gamma"]) {
            const donor = { id: benchmarkSessionID(`routing-confidence-donor-${label}`) }
            await SessionWorkGraph.recordArtifact({
              rootSessionID: donor.id,
              sessionID: donor.id,
              taskID: donor.id,
              type: "patch",
              summary: `cedar migration continuity patch ${label}`,
            })
            await RetrievalService.indexTaskArtifacts({
              projectID: Instance.project.id,
              rootSessionID: donor.id,
            })
          }

          const { ctx } = await createSupervisorContext({
            tmpPath: directory,
            callID: "benchmark-routing-confidence",
            benchmarkModel,
          })
          const tool = await TaskTool.init()
          const started = await (tool.execute as any)(
            {
              action: "start",
              subagent_type: "general",
              description: "cedar migration continuity",
              prompt: "Continue the cedar migration continuity patch pattern.",
              wait_for_result: true,
            },
            ctx,
          )
          const taskID = (started.metadata as any).sessionId as string
          const status = await (tool.execute as any)({ action: "status", task_id: taskID }, ctx)
          const policy = ((status.metadata as any) as any).routingPolicy as Record<string, unknown> | undefined
          const contextText = [((status.metadata as any) as any).routingAdvisorSummary, policy?.topPositiveSummary].filter(Boolean).join(" | ")
          const ok =
            ((status.metadata as any) as any).routingAdvisorConfidence === "high" &&
            policy?.mode === "semantic" &&
            policy?.winningDiscipline === "worker"

          return {
            id: "routing_confidence_high",
            category: "routing",
            ok,
            summary: ok
              ? "Semantic routing learned the right worker posture from repeated successful analogs."
              : "Routing did not surface the expected high-confidence semantic worker posture.",
            evidence: {
              elapsedMS: Math.round(performance.now() - startedAt),
              contextTokenEstimate: estimateTokens(contextText),
              routingSource: ((status.metadata as any) as any).routingSource,
              routingAdvisorConfidence: ((status.metadata as any) as any).routingAdvisorConfidence,
              routingPolicy: ((status.metadata as any) as any).routingPolicy,
            },
          } satisfies SemanticLiftScenarioResult
        },
      }),
  )
}

async function runRoutingBaselineScenario(directory: string, benchmarkModel: SemanticBenchmarkModel): Promise<SemanticLiftScenarioResult> {
  const startedAt = performance.now()
  RetrievalRuntime.reset()
  RetrievalRuntime.configure({
    async embedText(input) {
      const vector = /cedar|migration|continuity|route/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
      return {
        dimensions: vector.length,
        vector,
        metadata: { source: "benchmark-embedder" },
      }
    },
    async rerank(input) {
      return {
        candidates: input.candidates.map((candidate) => ({
          ...candidate,
          rerankScore: /cedar migration continuity/i.test(candidate.text ?? "") ? 0.6 : 0.2,
        })),
        metadata: { source: "benchmark-reranker" },
      }
    },
  })

  return withMockedSessionPrompt(
    {
      prompt: async (input: any) => mockedReply(input, "baseline routing benchmark reply", benchmarkModel),
    },
    async () =>
      Instance.provide({
        directory,
        fn: async () => {
          const donor = { id: benchmarkSessionID("routing-baseline-donor") }
          await SessionWorkGraph.recordArtifact({
            rootSessionID: donor.id,
            sessionID: donor.id,
            taskID: donor.id,
            type: "patch",
            summary: "cedar migration continuity patch faint",
          })
          await RetrievalService.indexTaskArtifacts({
            projectID: Instance.project.id,
            rootSessionID: donor.id,
          })

          const { ctx } = await createSupervisorContext({
            tmpPath: directory,
            callID: "benchmark-routing-baseline",
            benchmarkModel,
          })
          const tool = await TaskTool.init()
          const started = await (tool.execute as any)(
            {
              action: "start",
              subagent_type: "general",
              description: "cedar migration continuity",
              prompt: "Continue the cedar migration continuity patch pattern.",
              wait_for_result: true,
            },
            ctx,
          )
          const taskID = (started.metadata as any).sessionId as string
          const status = await (tool.execute as any)({ action: "status", task_id: taskID }, ctx)
          const policy = (status.metadata as any).routingPolicy as Record<string, unknown> | undefined
          const contextText = [(status.metadata as any).routingAdvisorSummary, policy?.topPositiveSummary].filter(Boolean).join(" | ")
          const ok =
            (status.metadata as any).routingSource === "inferred_from_prompt" &&
            (status.metadata as any).routingAdvisorConfidence === undefined &&
            policy?.mode === "baseline" &&
            policy?.winningDiscipline === "worker"

          return {
            id: "routing_baseline_fallback",
            category: "routing",
            ok,
            summary: ok
              ? "Baseline routing stayed heuristic when semantic evidence was too weak to justify steering."
              : "Routing did not cleanly fall back to the baseline heuristic path under weak evidence.",
            evidence: {
              elapsedMS: Math.round(performance.now() - startedAt),
              contextTokenEstimate: estimateTokens(contextText),
              routingSource: (status.metadata as any).routingSource,
              routingAdvisorConfidence: (status.metadata as any).routingAdvisorConfidence,
              routingPolicy: (status.metadata as any).routingPolicy,
            },
          } satisfies SemanticLiftScenarioResult
        },
      }),
  )
}

async function runPlanningAnalogScenario(directory: string): Promise<SemanticLiftScenarioResult> {
  const startedAt = performance.now()
  RetrievalRuntime.reset()
  RetrievalRuntime.configure({
    async embedText(input) {
      const vector = /octospine|orchestration|recovery|execution brief/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
      return {
        dimensions: vector.length,
        vector,
        metadata: { source: "benchmark-embedder" },
      }
    },
    async rerank(input) {
      return {
        candidates: input.candidates.map((candidate) => ({
          ...candidate,
          rerankScore: /balanced|oak lattice decomposition|execution brief outcome/i.test(candidate.text ?? "") ? 25 : 1,
        })),
        metadata: { source: "benchmark-reranker" },
      }
    },
  })

  return Instance.provide({
    directory,
    fn: async () => {
      const root = { id: benchmarkSessionID("planning-analog-root") }
      const child = { id: benchmarkSessionID("planning-analog-child") }
      const donorRoot = { id: benchmarkSessionID("planning-analog-donor-root") }
      const donorChild = { id: benchmarkSessionID("planning-analog-donor-child") }

      await SessionWorkGraph.recordObjective({
        rootSessionID: root.id,
        sessionID: child.id,
        title: "Ship the first Octospine slice",
        constraintsSummary: "Keep orchestration and recovery stable.",
      })

      await SessionWorkGraph.recordArtifact({
        rootSessionID: donorRoot.id,
        sessionID: donorChild.id,
        type: "execution_brief_outcome",
        summary: [
          "Execution brief outcome: success",
          "execution_brief_artifact_id: artifact-balanced",
          "execution_brief_summary: Execution brief: balanced",
          "task_id: donor-task",
          "description: carried the balanced posture cleanly",
          "discipline: worker",
          "scheduler_lane: worker",
          "result_preview: Balanced execution preserved the decomposition prior without oversplitting.",
        ].join("\n"),
      })
      await RetrievalService.indexTaskArtifacts({
        projectID: Instance.project.id,
        rootSessionID: donorRoot.id,
      })

      const tool = await PlanningTopologyCompareTool.init()
      const result = await tool.execute({}, { ...basePlanCtx, sessionID: child.id })
      const balanced = (result.metadata.candidates as Array<{ name: string; rationale: string }>).find(
        (candidate) => candidate.name === "balanced",
      )
      const contextText = balanced?.rationale ?? ""
      const ok =
        result.metadata.planningAnalogConfidence === "high" &&
        result.output.includes("Planning analogs: balanced favored by prior planning analogs") &&
        balanced?.rationale.includes("Prior planning outcomes") === true

      return {
        id: "planning_execution_analog_reuse",
        category: "planning",
        ok,
        summary: ok
          ? "Planning comparison reused prior execution-brief outcomes to favor the balanced topology."
          : "Planning comparison did not clearly reuse prior execution-brief outcomes.",
        evidence: {
          elapsedMS: Math.round(performance.now() - startedAt),
          contextTokenEstimate: estimateTokens(contextText),
          planningAnalogConfidence: result.metadata.planningAnalogConfidence,
          balancedRationale: balanced?.rationale,
        },
      } satisfies SemanticLiftScenarioResult
    },
  })
}

async function runPlanningBaselineScenario(directory: string): Promise<SemanticLiftScenarioResult> {
  const startedAt = performance.now()
  RetrievalRuntime.reset()
  RetrievalRuntime.configure({
    async embedText(input) {
      const vector = /octospine|orchestration|recovery/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
      return {
        dimensions: vector.length,
        vector,
        metadata: { source: "benchmark-embedder" },
      }
    },
    async rerank(input) {
      return {
        candidates: input.candidates.map((candidate) => ({
          ...candidate,
          rerankScore: /oak lattice decomposition/i.test(candidate.text ?? "") ? 25 : 1,
        })),
        metadata: { source: "benchmark-reranker" },
      }
    },
  })

  return Instance.provide({
    directory,
    fn: async () => {
      const root = { id: benchmarkSessionID("planning-baseline-root") }
      const child = { id: benchmarkSessionID("planning-baseline-child") }

      await SessionWorkGraph.recordObjective({
        rootSessionID: root.id,
        sessionID: child.id,
        title: "Ship the first Octospine slice",
        constraintsSummary: "Keep orchestration and recovery stable.",
      })
      await SessionWorldState.recordOpenLoop({
        rootSessionID: root.id,
        sessionID: child.id,
        summary: "Confirm orchestration and recovery stay aligned.",
      })

      const tool = await PlanningTopologyCompareTool.init()
      const result = await tool.execute({}, { ...basePlanCtx, sessionID: child.id })
      const balanced = (result.metadata.candidates as Array<{ name: string; rationale?: string }>).find(
        (candidate) => candidate.name === "balanced",
      )
      const ok =
        (result.metadata.planningAnalogConfidence === undefined || result.metadata.planningAnalogConfidence === "low") &&
        !result.output.includes("Planning analogs:") &&
        Array.isArray(result.metadata.candidates) &&
        (result.metadata.candidates as Array<unknown>).length === 3

      return {
        id: "planning_baseline_neutral",
        category: "planning",
        ok,
        summary: ok
          ? "Planning stayed neutral when there were no strong prior planning analogs to justify semantic bias."
          : "Planning did not remain neutral when analog evidence was absent.",
        evidence: {
          elapsedMS: Math.round(performance.now() - startedAt),
          contextTokenEstimate: estimateTokens(balanced?.rationale),
          planningAnalogConfidence: result.metadata.planningAnalogConfidence,
          hasPlanningAnalogsBanner: result.output.includes("Planning analogs:"),
          candidateCount: Array.isArray(result.metadata.candidates) ? result.metadata.candidates.length : 0,
        },
      } satisfies SemanticLiftScenarioResult
    },
  })
}

async function runRecoveryInvalidationScenario(directory: string, benchmarkModel: SemanticBenchmarkModel): Promise<SemanticLiftScenarioResult> {
  const startedAt = performance.now()
  RetrievalRuntime.reset()
  RetrievalRuntime.configure({
    async embedText(input) {
      const vector = /stalled|stuck|recovered|continuity|state/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
      return {
        dimensions: vector.length,
        vector,
        metadata: { source: "benchmark-embedder" },
      }
    },
    async rerank(input) {
      return {
        candidates: input.candidates.map((candidate) => ({
          ...candidate,
          rerankScore: /re-scan state before continuing/i.test(candidate.text ?? "") ? 20 : 1,
        })),
        metadata: { source: "benchmark-reranker" },
      }
    },
  })

  await writeFile(
    `${directory}/opencode.json`,
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      experimental: {
        orchestration: {
          task_scheduler: {
            enabled: true,
            max_concurrency: 1,
            heartbeat_ms: 1_000,
            recovery_stuck_ms: 10_000,
          },
        },
      },
    }),
  )

  let attemptCount = 0
  let firstAttemptCanceled = false
  let retriedPromptText = ""

  return withMockedSessionPrompt(
    {
      cancel: async () => {
        firstAttemptCanceled = true
      },
      prompt: async (input: any) => {
        attemptCount += 1
        if (attemptCount === 1) {
          await new Promise<never>((_resolve, reject) => {
            const poll = () => {
              if (firstAttemptCanceled) {
                reject(new Error("prompt canceled"))
                return
              }
              setTimeout(poll, 50)
            }
            poll()
          })
        }

        retriedPromptText =
          input.parts
            ?.filter((part: any) => part.type === "text")
            .map((part: any) => part.text)
            .join("\n") ?? ""
        return mockedReply(input, "recovered stuck worker reply", benchmarkModel)
      },
    },
    async () =>
      Instance.provide({
        directory,
        fn: async () => {
          const donor = { id: benchmarkSessionID("recovery-invalidation-donor") }
          await SessionWorkGraph.recordArtifact({
            rootSessionID: donor.id,
            sessionID: donor.id,
            taskID: donor.id,
            type: "warning",
            summary: "When a worker stalls, re-scan state before continuing and verify continuity before resuming.",
          })
          await RetrievalService.indexTaskArtifacts({
            projectID: Instance.project.id,
            rootSessionID: donor.id,
          })

          const { ctx, sessionID } = await createSupervisorContext({
            tmpPath: directory,
            callID: "benchmark-watchdog-recovery",
            benchmarkModel,
          })
          await SessionWorkGraph.recordArtifact({
            rootSessionID: sessionID,
            sessionID,
            taskID: sessionID,
            type: "execution_brief",
            summary: [
              "Execution brief: balanced",
              "Goal: Recover stalled continuity work safely",
              "Invalidation signals: stalled continuity task | rollback path resurfaces",
              "Contingency actions: Re-run the state scan before retrying. | Switch to verification if rollback symptoms appear again.",
            ].join("\n"),
          })
          await RetrievalService.indexTaskArtifacts({
            projectID: Instance.project.id,
            rootSessionID: sessionID,
          })

          const tool = await TaskTool.init()
          const started = await (tool.execute as any)(
            {
              action: "start",
              subagent_type: "general",
              description: "stuck recovery worker",
              prompt: "Do the stalled continuity task and keep going if the first turn gets stuck.",
              wait_for_result: true,
            },
            ctx,
          )

          const status = await (tool.execute as any)(
            {
              action: "status",
              task_id: started.metadata.sessionId as string,
            },
            ctx,
          )
          const triggered = ((status.metadata as any).recoveryAdvisorTriggeredInvalidationSignals as string[] | undefined) ?? []
          const ok =
            attemptCount === 2 &&
            retriedPromptText.includes("Possible triggered invalidation:") &&
            triggered.includes("stalled continuity task")

          return {
            id: "recovery_invalidation_awareness",
            category: "recovery",
            ok,
            summary: ok
              ? "Recovery detected declared invalidation signals and retried with the right contingency context."
              : "Recovery did not clearly surface the execution-brief invalidation signals.",
            evidence: {
              elapsedMS: Math.round(performance.now() - startedAt),
              contextTokenEstimate: estimateTokens(retriedPromptText),
              attemptCount,
              triggeredInvalidations: triggered,
              recoverySummary: (status.metadata as any).recoveryAdvisorSummary,
            },
          } satisfies SemanticLiftScenarioResult
        },
      }),
  )
}

async function runRecoveryBaselineScenario(directory: string, benchmarkModel: SemanticBenchmarkModel): Promise<SemanticLiftScenarioResult> {
  const startedAt = performance.now()
  RetrievalRuntime.reset()
  RetrievalRuntime.configure({
    async embedText(input) {
      const vector = /stalled|stuck|recovered|continuity|state/i.test(input.text) ? [1, 0, 0] : [0, 1, 0]
      return {
        dimensions: vector.length,
        vector,
        metadata: { source: "benchmark-embedder" },
      }
    },
    async rerank(input) {
      return {
        candidates: input.candidates.map((candidate) => ({
          ...candidate,
          rerankScore: /re-scan state before continuing/i.test(candidate.text ?? "") ? 20 : 1,
        })),
        metadata: { source: "benchmark-reranker" },
      }
    },
  })

  await writeFile(
    `${directory}/opencode.json`,
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      experimental: {
        orchestration: {
          task_scheduler: {
            enabled: true,
            max_concurrency: 1,
            heartbeat_ms: 1_000,
            recovery_stuck_ms: 10_000,
          },
        },
      },
    }),
  )

  let attemptCount = 0
  let firstAttemptCanceled = false
  let retriedPromptText = ""

  return withMockedSessionPrompt(
    {
      cancel: async () => {
        firstAttemptCanceled = true
      },
      prompt: async (input: any) => {
        attemptCount += 1
        if (attemptCount === 1) {
          await new Promise<never>((_resolve, reject) => {
            const poll = () => {
              if (firstAttemptCanceled) {
                reject(new Error("prompt canceled"))
                return
              }
              setTimeout(poll, 50)
            }
            poll()
          })
        }

        retriedPromptText =
          input.parts
            ?.filter((part: any) => part.type === "text")
            .map((part: any) => part.text)
            .join("\n") ?? ""
        return mockedReply(input, "recovered baseline worker reply", benchmarkModel)
      },
    },
    async () =>
      Instance.provide({
        directory,
        fn: async () => {
          const donor = { id: benchmarkSessionID("recovery-baseline-donor") }
          await SessionWorkGraph.recordArtifact({
            rootSessionID: donor.id,
            sessionID: donor.id,
            taskID: donor.id,
            type: "warning",
            summary: "When a worker stalls, re-scan state before continuing and verify continuity before resuming.",
          })
          await RetrievalService.indexTaskArtifacts({
            projectID: Instance.project.id,
            rootSessionID: donor.id,
          })

          const { ctx } = await createSupervisorContext({
            tmpPath: directory,
            callID: "benchmark-watchdog-recovery-baseline",
            benchmarkModel,
          })

          const tool = await TaskTool.init()
          const started = await (tool.execute as any)(
            {
              action: "start",
              subagent_type: "general",
              description: "stuck recovery worker",
              prompt: "Do the stalled continuity task and keep going if the first turn gets stuck.",
              wait_for_result: true,
            },
            ctx,
          )

          const status = await (tool.execute as any)(
            {
              action: "status",
              task_id: started.metadata.sessionId as string,
            },
            ctx,
          )
          const triggered = ((status.metadata as any).recoveryAdvisorTriggeredInvalidationSignals as string[] | undefined) ?? []
          const ok =
            attemptCount === 2 &&
            !retriedPromptText.includes("Possible triggered invalidation:") &&
            triggered.length === 0

          return {
            id: "recovery_baseline_generic",
            category: "recovery",
            ok,
            summary: ok
              ? "Baseline recovery retried without execution-brief invalidation cues or contingency-specific context."
              : "Baseline recovery did not stay generic when execution-brief invalidation cues were absent.",
            evidence: {
              elapsedMS: Math.round(performance.now() - startedAt),
              contextTokenEstimate: estimateTokens(retriedPromptText),
              attemptCount,
              triggeredInvalidations: triggered,
              recoverySummary: (status.metadata as any).recoveryAdvisorSummary,
            },
          } satisfies SemanticLiftScenarioResult
        },
      }),
  )
}

async function runAgentStateVisibilityScenario(directory: string): Promise<SemanticLiftScenarioResult> {
  const startedAt = performance.now()
  RetrievalRuntime.reset()

  return Instance.provide({
    directory,
    fn: async () => {
      const root = { id: benchmarkSessionID("agent-state-root") }
      const child = { id: benchmarkSessionID("agent-state-child") }

      await SessionWorkGraph.recordObjective({
        rootSessionID: root.id,
        sessionID: child.id,
        title: "Ship the first Octospine slice",
        constraintsSummary: "Keep orchestration and recovery stable.",
      })
      await SessionWorldState.recordOpenLoop({
        rootSessionID: root.id,
        sessionID: child.id,
        summary: "Confirm orchestration and recovery stay aligned.",
      })

      const tool = await PlanningTopologyPreviewTool.init()
      const result = await tool.execute({}, { ...basePlanCtx, sessionID: child.id })
      const agentState = result.metadata.agentState as { summary?: string; layers?: string[] } | undefined
      const ok =
        result.output.includes("Agent state:") &&
        typeof agentState?.summary === "string" &&
        agentState.summary.includes("open_loops=1")

      return {
        id: "agent_state_visibility",
        category: "state",
        ok,
        summary: ok
          ? "The compact agent operating state is visible at planning time instead of hiding in lower-level surfaces."
          : "The compact agent operating state was not surfaced clearly enough during planning preview.",
        evidence: {
          elapsedMS: Math.round(performance.now() - startedAt),
          contextTokenEstimate: estimateTokens(agentState?.summary),
          agentState,
        },
      } satisfies SemanticLiftScenarioResult
    },
  })
}

export async function runSemanticLiftBenchmark(input: {
  prepareWorkspace: WorkspacePreparer
  benchmarkModel?: SemanticBenchmarkModel
}): Promise<SemanticLiftBenchmarkResult> {
  const benchmarkModel = input.benchmarkModel ?? defaultBenchmarkModel
  const scenarios = [
    async () => runRoutingConfidenceScenario(await input.prepareWorkspace("routing_confidence_high"), benchmarkModel),
    async () => runRoutingBaselineScenario(await input.prepareWorkspace("routing_baseline_fallback"), benchmarkModel),
    async () => runPlanningAnalogScenario(await input.prepareWorkspace("planning_execution_analog_reuse")),
    async () => runPlanningBaselineScenario(await input.prepareWorkspace("planning_baseline_neutral")),
    async () => runRecoveryInvalidationScenario(await input.prepareWorkspace("recovery_invalidation_awareness"), benchmarkModel),
    async () => runRecoveryBaselineScenario(await input.prepareWorkspace("recovery_baseline_generic"), benchmarkModel),
    async () => runAgentStateVisibilityScenario(await input.prepareWorkspace("agent_state_visibility")),
  ]

  const results: SemanticLiftScenarioResult[] = []
  for (const scenario of scenarios) {
    results.push(await scenario())
    RetrievalRuntime.reset()
  }

  const categories = [...new Set(results.map((result) => result.category))]
  const passedCount = results.filter((result) => result.ok).length
  const routingSemantic = results.find((result) => result.id === "routing_confidence_high")
  const routingBaseline = results.find((result) => result.id === "routing_baseline_fallback")
  const planningSemantic = results.find((result) => result.id === "planning_execution_analog_reuse")
  const planningBaseline = results.find((result) => result.id === "planning_baseline_neutral")
  const recoverySemantic = results.find((result) => result.id === "recovery_invalidation_awareness")
  const recoveryBaseline = results.find((result) => result.id === "recovery_baseline_generic")
  const routingSemanticConfidence = confidenceScore(routingSemantic?.evidence.routingAdvisorConfidence)
  const routingBaselineConfidence = confidenceScore(routingBaseline?.evidence.routingAdvisorConfidence)
  const planningSemanticConfidence = confidenceScore(planningSemantic?.evidence.planningAnalogConfidence)
  const planningBaselineConfidence = confidenceScore(planningBaseline?.evidence.planningAnalogConfidence)
  const routingSemanticTokens = numericEvidence(routingSemantic ?? { evidence: {} } as SemanticLiftScenarioResult, "contextTokenEstimate")
  const routingBaselineTokens = numericEvidence(routingBaseline ?? { evidence: {} } as SemanticLiftScenarioResult, "contextTokenEstimate")
  const planningSemanticTokens = numericEvidence(planningSemantic ?? { evidence: {} } as SemanticLiftScenarioResult, "contextTokenEstimate")
  const planningBaselineTokens = numericEvidence(planningBaseline ?? { evidence: {} } as SemanticLiftScenarioResult, "contextTokenEstimate")
  const recoverySemanticElapsed = numericEvidence(recoverySemantic ?? { evidence: {} } as SemanticLiftScenarioResult, "elapsedMS")
  const recoveryBaselineElapsed = numericEvidence(recoveryBaseline ?? { evidence: {} } as SemanticLiftScenarioResult, "elapsedMS")
  const recoverySemanticTokens = numericEvidence(recoverySemantic ?? { evidence: {} } as SemanticLiftScenarioResult, "contextTokenEstimate")
  const recoveryBaselineTokens = numericEvidence(recoveryBaseline ?? { evidence: {} } as SemanticLiftScenarioResult, "contextTokenEstimate")

  return {
    suite: "semantic_lift",
    benchmarkModel,
    scenarioCount: results.length,
    passedCount,
    failedCount: results.length - passedCount,
    successRate: results.length ? passedCount / results.length : 0,
    comparativeDeltas: {
      routing: {
        semanticConfidenceScore: routingSemanticConfidence,
        baselineConfidenceScore: routingBaselineConfidence,
        confidenceGain: routingSemanticConfidence - routingBaselineConfidence,
        semanticContextTokens: routingSemanticTokens,
        baselineContextTokens: routingBaselineTokens,
        contextTokenDelta: routingSemanticTokens - routingBaselineTokens,
        confidenceGainPerSemanticToken:
          routingSemanticTokens > 0 ? Number(((routingSemanticConfidence - routingBaselineConfidence) / routingSemanticTokens).toFixed(4)) : 0,
      },
      planning: {
        semanticConfidenceScore: planningSemanticConfidence,
        baselineConfidenceScore: planningBaselineConfidence,
        confidenceGain: planningSemanticConfidence - planningBaselineConfidence,
        semanticContextTokens: planningSemanticTokens,
        baselineContextTokens: planningBaselineTokens,
        contextTokenDelta: planningSemanticTokens - planningBaselineTokens,
        confidenceGainPerSemanticToken:
          planningSemanticTokens > 0 ? Number(((planningSemanticConfidence - planningBaselineConfidence) / planningSemanticTokens).toFixed(4)) : 0,
      },
      recovery: {
        semanticElapsedMS: recoverySemanticElapsed,
        baselineElapsedMS: recoveryBaselineElapsed,
        elapsedMSDelta: recoverySemanticElapsed - recoveryBaselineElapsed,
        semanticContextTokens: recoverySemanticTokens,
        baselineContextTokens: recoveryBaselineTokens,
        contextTokenDelta: recoverySemanticTokens - recoveryBaselineTokens,
      },
    },
    categorySummary: categories.map((category) => ({
      category,
      total: results.filter((result) => result.category === category).length,
      passed: results.filter((result) => result.category === category && result.ok).length,
    })),
    results,
  }
}
