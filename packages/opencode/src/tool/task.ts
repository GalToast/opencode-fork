import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { Instance } from "@/project/instance"
import { SessionStatus } from "@/session/status"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { SchedulerControl } from "@/scheduler/control-plane"
import { isSessionSteerInterrupt } from "@/session/interrupt"
import { ExecutionLedger, type ExecutionEvent } from "@/execution/ledger"
import { Provider } from "@/provider/provider"
import { SessionWorkGraph } from "@/session/workgraph"

const log = Log.create({ service: "tool.task" })
const parentAbortSteerGraceMS = 120
const supervisorInboxDedupMS = 750

const supervisorStatus = z.enum(["queued", "started", "completed", "error", "canceled"])
const taskPriority = z.enum(["urgent", "steer", "normal", "background"])
const schedulerEventKind = z.enum(["queued", "dispatched", "paused", "resumed", "escalated", "status", "heartbeat", "recovered"])
const supervisorInboxEvent = z.object({
  status: supervisorStatus,
  taskID: Identifier.schema("session"),
  supervisorSessionID: Identifier.schema("session").optional(),
  subagentType: z.string(),
  description: z.string(),
  pendingTurns: z.number().int().min(0),
  queuedTurns: z.number().int().min(0).optional(),
  priority: taskPriority.optional(),
  effectivePriority: taskPriority.optional(),
  queuePosition: z.number().int().min(1).optional(),
  paused: z.boolean().optional(),
  eventKind: schedulerEventKind.optional(),
  messageID: Identifier.schema("message").optional(),
  error: z.string().optional(),
  time: z.number(),
})

export const TaskEvent = {
  SupervisorInbox: BusEvent.define("supervisor.inbox.task", supervisorInboxEvent),
}

type TaskAction =
  | "start"
  | "message"
  | "status"
  | "wait"
  | "cancel"
  | "list"
  | "relay"
  | "broadcast"
  | "pause"
  | "resume"
  | "escalate"
type JobStatus = "running" | "completed" | "error" | "canceled"
type ModelRef = NonNullable<SessionPrompt.PromptInput["model"]>
type SupervisorStatus = z.infer<typeof supervisorStatus>
type TaskPriority = z.infer<typeof taskPriority>
type SchedulerEventKind = z.infer<typeof schedulerEventKind>
type TaskDiscipline = "general" | "orchestrator" | "adversarial" | "research" | "synthesis" | "worker"
type TaskSwarmTemplate = "search" | "patch" | "review" | "verify" | "synthesize"
type TaskArtifactType = "draft" | "fact" | "patch" | "summary" | "warning" | "test_result" | "critique"
type TaskArtifact = {
  id: string
  type: TaskArtifactType
  summary: string
  text: string
  createdAt: number
  messageID?: string
  template?: TaskSwarmTemplate
}
type TaskArtifactCandidate = {
  taskID: string
  type: TaskArtifactType
  summary: string
  score: number
  discipline: TaskDiscipline
  schedulerLane: SchedulerControl.Lane | string
  status: JobStatus
  template?: TaskSwarmTemplate
}
type DependencyState = {
  satisfied: boolean
  missingTaskIDs: string[]
  pendingTaskIDs: string[]
  failedTaskIDs: string[]
  canceledTaskIDs: string[]
}

const priorityRank: Record<TaskPriority, number> = {
  background: 0,
  normal: 1,
  steer: 2,
  urgent: 3,
}

type RuntimeJob = {
  taskID: string
  parentSessionID?: string
  parentTaskID?: string
  rootSupervisorSessionID?: string
  subagentType: string
  description: string
  model: ModelRef
  discipline?: TaskDiscipline
  schedulerLane?: SchedulerControl.Lane | string
  swarmTemplate?: TaskSwarmTemplate
  expectedArtifact?: TaskArtifactType
  artifacts?: TaskArtifact[]
  priority: TaskPriority
  dependsOnTaskIDs: string[]
  status: JobStatus
  pendingTurns: number
  queuedTurns: number
  paused: boolean
  heartbeatMS?: number
  lineageDepth: number
  childTaskIDs: string[]
  startedAt: number
  updatedAt: number
  finishedAt?: number
  lastMessageID?: string
  lastResult?: string
  lastError?: string
  latestExecution?: ExecutionEvent
  lastInboxKey?: string
  lastInboxAt?: number
  waiters: Array<() => void>
}

export function selectTaskArtifactCandidate(input: {
  job: Pick<RuntimeJob, "taskID" | "parentSessionID" | "swarmTemplate" | "expectedArtifact">
  jobs: Array<
    Pick<RuntimeJob, "taskID" | "parentSessionID" | "discipline" | "schedulerLane" | "status" | "swarmTemplate" | "artifacts">
  >
}): TaskArtifactCandidate | undefined {
  if (!input.job.parentSessionID) return
  const candidates: TaskArtifactCandidate[] = []
  for (const sibling of input.jobs) {
    if (sibling.taskID === input.job.taskID) continue
    if (sibling.parentSessionID !== input.job.parentSessionID) continue
    if (sibling.status !== "completed") continue
    const artifact = sibling.artifacts?.[0]
    if (!artifact) continue
    let score = 0
    if (input.job.expectedArtifact && artifact.type === input.job.expectedArtifact) score += 5
    if (input.job.swarmTemplate && artifact.template === input.job.swarmTemplate) score += 2
    score += 1
    if (sibling.discipline === "adversarial" && (artifact.type === "critique" || artifact.type === "warning")) score += 3
    if (sibling.discipline === "research" && artifact.type === "fact") score += 2
    if (sibling.discipline === "worker" && artifact.type === "patch") score += 2
    if (sibling.discipline === "synthesis" && (artifact.type === "summary" || artifact.type === "draft")) score += 2
    candidates.push({
      taskID: sibling.taskID,
      type: artifact.type,
      summary: artifact.summary,
      score,
      discipline: sibling.discipline ?? "general",
      schedulerLane: sibling.schedulerLane ?? "subagent_tasks",
      status: sibling.status,
      template: artifact.template,
    })
  }
  candidates.sort((a, b) => b.score - a.score || (a.taskID < b.taskID ? -1 : 1))
  return candidates[0]
}

type QueueTurn = {
  id: number
  taskID: string
  promptInput: SessionPrompt.PromptInput
  priority: TaskPriority
  createdAt: number
  supervisorSessionID?: string
  resolve?: (value: Awaited<ReturnType<typeof runTurn>>) => void
  reject?: (reason?: any) => void
}

type RuntimeState = {
  jobs: Record<string, RuntimeJob>
  queue: QueueTurn[]
  dispatching: boolean
  queueSeq: number
}

const runtime = Instance.state(
  (): RuntimeState => {
    return {
      jobs: {},
      queue: [],
      dispatching: false,
      queueSeq: 0,
    }
  },
  async (state) => {
    for (const timer of heartbeatTimers.values()) {
      clearInterval(timer)
    }
    heartbeatTimers.clear()
    for (const queued of state.queue) {
      queued.reject?.(new Error("Task scheduler disposed"))
    }
    for (const job of Object.values(state.jobs)) {
      if (job.pendingTurns > 0) {
        SessionPrompt.cancel(SessionID.make(job.taskID))
      }
    }
    state.jobs = {}
    state.queue = []
    state.dispatching = false
  },
)

const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()

function runtimeJobs() {
  return runtime().jobs
}

function runtimeQueue() {
  return runtime().queue
}

function scorePriority(priority: TaskPriority) {
  return priorityRank[priority]
}

function labelPriority(score: number): TaskPriority {
  if (score >= priorityRank.urgent) return "urgent"
  if (score >= priorityRank.steer) return "steer"
  if (score >= priorityRank.normal) return "normal"
  return "background"
}

function higherPriority(a: TaskPriority, b: TaskPriority) {
  return scorePriority(a) > scorePriority(b)
}

function resolvePriority(input: {
  requested?: TaskPriority
  action: "start" | "message" | "relay" | "broadcast"
  waitForResult: boolean
  steer: boolean
}): TaskPriority {
  if (input.requested) return input.requested
  if (input.action === "message" && input.steer) return "steer"
  if (!input.waitForResult) return "background"
  return "normal"
}

function taskResultOutput(taskID: string, text: string) {
  return [`task_id: ${taskID} (for resuming to continue this task if needed)`, "", "<task_result>", text, "</task_result>"].join(
    "\n",
  )
}

const taskModelOverride = z.union([
  z.object({
    providerID: z.string().min(1),
    modelID: z.string().min(1),
  }),
  z.string().min(1),
])

function parseModelOverride(value: z.infer<typeof taskModelOverride>): ModelRef {
  if (typeof value === "string") return Provider.parseModel(value)
  return value as ModelRef
}

function normalizeSubagentType(value?: string) {
  const normalized = value?.trim()
  if (!normalized) return normalized
  if (normalized === "search") return "explore"
  return normalized
}

function artifactSummary(text: string) {
  const match = text.match(/^\s*Artifact Summary:\s*(.+)$/im)
  if (match?.[1]?.trim()) return match[1].trim()
  return text.replace(/\s+/g, " ").trim().slice(0, 160)
}

function updateJobArtifact(job: RuntimeJob, text: string, messageID?: string) {
  const type = job.expectedArtifact
  if (!type || !text.trim()) return
  job.artifacts ??= []
  if (messageID && job.artifacts.some((artifact) => artifact.messageID === messageID && artifact.type === type)) return
  job.artifacts.unshift({
    id: Identifier.ascending("part"),
    type,
    summary: artifactSummary(text),
    text,
    createdAt: Date.now(),
    messageID,
    template: job.swarmTemplate,
  })
  job.artifacts = job.artifacts.slice(0, 8)
}

function latestArtifact(job: RuntimeJob) {
  return job.artifacts?.[0]
}

function artifactStatusLines(job: RuntimeJob) {
  const artifact = latestArtifact(job)
  return [
    ...(job.swarmTemplate ? [`swarm_template: ${job.swarmTemplate}`] : []),
    ...(job.expectedArtifact ? [`expected_artifact: ${job.expectedArtifact}`] : []),
    `artifact_count: ${job.artifacts?.length ?? 0}`,
    ...(artifact
      ? [
          `artifact_type: ${artifact.type}`,
          `artifact_summary: ${artifact.summary}`,
        ]
      : []),
  ]
}

function lineageStatusLines(job: RuntimeJob) {
  return [
    ...(job.parentTaskID ? [`parent_task_id: ${job.parentTaskID}`] : []),
    ...(job.rootSupervisorSessionID ? [`root_supervisor_session_id: ${job.rootSupervisorSessionID}`] : []),
    ...(job.dependsOnTaskIDs.length > 0 ? [`depends_on: ${job.dependsOnTaskIDs.join(",")}`] : []),
    `lineage_depth: ${job.lineageDepth}`,
    ...(job.childTaskIDs.length > 0 ? [`child_task_ids: ${job.childTaskIDs.join(",")}`] : []),
    `checkpoint_child_count: ${job.childTaskIDs.length}`,
    `checkpoint_child_artifact_count: ${job.childTaskIDs.filter((id) => (runtimeJobs()[id]?.artifacts?.length ?? 0) > 0).length}`,
  ]
}

function heartbeatHealth(job: RuntimeJob) {
  if (!job.heartbeatMS || job.pendingTurns <= 0) {
    return { state: "idle" as const, expectedMS: job.heartbeatMS, ageMS: 0 }
  }
  const ageMS = Math.max(0, Date.now() - job.updatedAt)
  const staleAfterMS = Math.max(job.heartbeatMS * 2, job.heartbeatMS + 1_000)
  return {
    state: ageMS > staleAfterMS ? ("stale" as const) : ("fresh" as const),
    expectedMS: job.heartbeatMS,
    ageMS,
  }
}

function hasOrchestratorLineage(job?: RuntimeJob): boolean {
  let current = job
  for (let i = 0; current && i < 32; i++) {
    if (current.discipline === "orchestrator") return true
    current = current.parentTaskID ? runtimeJobs()[current.parentTaskID] : undefined
  }
  return false
}

export function getEffectiveDispatchLane(lane: SchedulerControl.Lane | string | undefined): SchedulerControl.Lane {
  if (lane && SchedulerControl.Lane.options.includes(lane as SchedulerControl.Lane)) {
    return lane as SchedulerControl.Lane
  }
  return "subagent_tasks"
}

function publishWorkGraphLane(job: RuntimeJob, status: "queued" | "running" | "completed" | "error" | "canceled") {
  const rootSessionID = job.rootSupervisorSessionID ?? job.parentSessionID ?? job.taskID
  return SessionWorkGraph.recordLane({
    rootSessionID,
    sessionID: job.taskID,
    laneID: job.taskID,
    title: job.description,
    status,
    schedulerLane: String(job.schedulerLane ?? "subagent_tasks"),
    discipline: job.discipline,
    priority: job.priority,
    subagentType: job.subagentType,
    lastMessageID: job.lastMessageID,
  }).catch((error) => {
    log.warn("failed to publish task workgraph lane", { taskID: job.taskID, status, error })
  })
}

function publishWorkGraphArtifact(job: RuntimeJob) {
  const artifact = latestArtifact(job)
  if (!artifact) return
  const rootSessionID = job.rootSupervisorSessionID ?? job.parentSessionID ?? job.taskID
  return SessionWorkGraph.recordArtifact({
    rootSessionID,
    sessionID: job.taskID,
    taskID: job.taskID,
    messageID: artifact.messageID,
    type: artifact.type,
    summary: artifact.summary,
    outcome: job.status === "completed" ? "success" : job.status === "error" ? "failure" : "partial",
  }).catch((error) => {
    log.warn("failed to publish task workgraph artifact", { taskID: job.taskID, error })
  })
}

async function executionHistoryMetadata(taskID: string) {
  const events = await ExecutionLedger.list({
    jobID: taskID,
    order: "desc",
    limit: 20,
  }).catch(() => [])
  const latest = events[0]
  return {
    executionEvents: events,
    executionEventCount: events.length,
    executionLatestPhase: latest?.phase,
    executionLatestStatus: latest?.status,
    executionLatestAction: latest?.action,
  }
}

function executionHistoryLines(events: ExecutionEvent[]) {
  if (events.length === 0) return []
  return [
    `execution_event_count: ${events.length}`,
    "",
    "<task_execution>",
    ...events.slice(0, 8).map((event) =>
      [
        `phase: ${event.phase}`,
        `status: ${event.status}`,
        ...(event.action ? [`action: ${event.action}`] : []),
        `time: ${new Date(event.time).toISOString()}`,
        "---",
      ].join("\n"),
    ),
    "</task_execution>",
  ]
}

function arbitrationStatusLines(job: RuntimeJob) {
  if (job.discipline !== "orchestrator") return []
  const candidate = selectTaskArtifactCandidate({
    job,
    jobs: Object.values(runtimeJobs()),
  })
  if (!candidate) return [`arbitration_candidate: none`]
  return [
    `arbitration_candidate_task_id: ${candidate.taskID}`,
    `arbitration_candidate_type: ${candidate.type}`,
    `arbitration_candidate_score: ${candidate.score.toFixed(2)}`,
    `arbitration_candidate_summary: ${candidate.summary}`,
  ]
}

function dependencyState(job: RuntimeJob, jobs: Record<string, RuntimeJob>): DependencyState {
  const state: DependencyState = {
    satisfied: true,
    missingTaskIDs: [],
    pendingTaskIDs: [],
    failedTaskIDs: [],
    canceledTaskIDs: [],
  }
  for (const taskID of job.dependsOnTaskIDs) {
    const dependency = jobs[taskID]
    if (!dependency) {
      state.missingTaskIDs.push(taskID)
      state.satisfied = false
      continue
    }
    if (dependency.status === "completed") continue
    state.satisfied = false
    if (dependency.status === "error") {
      state.failedTaskIDs.push(taskID)
    } else if (dependency.status === "canceled") {
      state.canceledTaskIDs.push(taskID)
    } else {
      state.pendingTaskIDs.push(taskID)
    }
  }
  return state
}

function dependencyStatusLines(job: RuntimeJob, jobs: Record<string, RuntimeJob> = runtimeJobs()) {
  if (job.dependsOnTaskIDs.length === 0) return []
  const state = dependencyState(job, jobs)
  const terminalBlocked = state.missingTaskIDs.length > 0 || state.failedTaskIDs.length > 0 || state.canceledTaskIDs.length > 0
  return [
    `dependency_state: ${state.satisfied ? "satisfied" : terminalBlocked ? "failed" : "blocked"}`,
    ...(state.pendingTaskIDs.length > 0 ? [`dependency_pending: ${state.pendingTaskIDs.join(",")}`] : []),
    ...(state.missingTaskIDs.length > 0 ? [`dependency_missing: ${state.missingTaskIDs.join(",")}`] : []),
    ...(state.failedTaskIDs.length > 0 ? [`dependency_failed: ${state.failedTaskIDs.join(",")}`] : []),
    ...(state.canceledTaskIDs.length > 0 ? [`dependency_canceled: ${state.canceledTaskIDs.join(",")}`] : []),
  ]
}

function taskStatusOutput(job: RuntimeJob) {
  return [
    `task_id: ${job.taskID}`,
    `status: ${job.status}`,
    `pending_turns: ${job.pendingTurns}`,
    `queued_turns: ${job.queuedTurns}`,
    `paused: ${job.paused}`,
    `priority: ${job.priority}`,
    `subagent_type: ${job.subagentType}`,
    ...lineageStatusLines(job),
    ...dependencyStatusLines(job),
    ...(job.discipline ? [`discipline: ${job.discipline}`] : []),
    ...(job.schedulerLane ? [`scheduler_lane: ${job.schedulerLane}`] : []),
    ...artifactStatusLines(job),
    ...arbitrationStatusLines(job),
    ...(job.latestExecution ? [`execution_latest_phase: ${job.latestExecution.phase}`] : []),
    ...(job.latestExecution ? [`execution_latest_status: ${job.latestExecution.status}`] : []),
    `updated_at: ${new Date(job.updatedAt).toISOString()}`,
    ...(job.finishedAt ? [`finished_at: ${new Date(job.finishedAt).toISOString()}`] : []),
    `heartbeat_state: ${heartbeatHealth(job).state}`,
    ...(heartbeatHealth(job).expectedMS ? [`heartbeat_expected_ms: ${heartbeatHealth(job).expectedMS}`] : []),
    `heartbeat_age_ms: ${heartbeatHealth(job).ageMS}`,
    "",
    "<task_status>",
    ...(job.lastError ? [`last_error: ${job.lastError}`] : []),
    ...(job.lastResult ? [job.lastResult] : ["No result text captured yet."]),
    "</task_status>",
  ].join("\n")
}

function taskActionTitle(label: string, job: RuntimeJob) {
  return job.description ? `${label}: ${job.description}` : label
}

function taskPresentationMetadata(job: RuntimeJob, metadata: Record<string, any> = {}) {
  return {
    taskID: job.taskID,
    sessionId: job.taskID,
    taskDescription: job.description,
    subagentType: job.subagentType,
    status: job.status,
    ...metadata,
  }
}

function taskProgressLabel(action: TaskAction) {
  switch (action) {
    case "wait":
      return "Waiting for task"
    case "cancel":
      return "Cancel task"
    case "pause":
      return "Pause task"
    case "resume":
      return "Resume task"
    case "escalate":
      return "Escalate task"
    case "status":
    default:
      return "Task status"
  }
}

function toAction(value: string | undefined): TaskAction {
  return (value ?? "start") as TaskAction
}

function requireField(value: string | undefined, field: string, action: TaskAction) {
  if (!value?.trim()) throw new Error(`The task tool action="${action}" requires "${field}".`)
  return value
}

function extractText(result: MessageV2.WithParts) {
  return result.parts.findLast((x) => x.type === "text")?.text ?? ""
}

export function resolveTaskRouting(input: {
  laneHint?: string
  swarmTemplate?: string
  expectedArtifact?: string
  description?: string
  prompt?: string
  subagentType?: string
  existing?: {
    discipline?: TaskDiscipline
    schedulerLane?: SchedulerControl.Lane | string
    swarmTemplate?: TaskSwarmTemplate
    expectedArtifact?: TaskArtifactType
  }
}) {
  const lane = input.laneHint?.trim().toLowerCase()
  const combined = [input.description, input.prompt].filter(Boolean).join("\n")
  const hasExplicitOverride = Boolean(input.swarmTemplate || input.expectedArtifact)
  if ((!lane || lane === "auto") && !hasExplicitOverride && input.existing?.discipline) {
    return {
      discipline: input.existing.discipline,
      schedulerLane: input.existing.schedulerLane ?? "subagent_tasks",
      swarmTemplate: input.existing.swarmTemplate,
      expectedArtifact: input.existing.expectedArtifact,
    }
  }
  const isAnalysisOnly = /\b(analy[sz]e|analysis|inspect|audit|correctness|failure modes|research|source|fact)\b/i.test(combined) && /\b(do not edit|read[-\s]?only|only)\b/i.test(combined)
  const isVerifyWorker = /\b(verify|verification|run (the )?(checks|tests)|regression tests?)\b/i.test(combined)
  const isApplyWorker = /\b(apply|update|edit|fix|implement|remove|clean up|write|modify)\b/i.test(combined)
  const isPatchWorker = /\b(patch|worker)\b/i.test(combined)
  const isOrchestrator = /\b(orchestrat(e|or|ion)|dispatch|coordinate|coordinator|fan out|swarm|queue)\b/i.test(combined)
  const isAdversarial = /\b(red[\s-]?team|critic|critique|adversarial|reviewer|review\b.*\b(regressions?|hidden risks?|hidden bugs?)|regressions?\b.*\breview)\b/i.test(combined)
  const normalizedLane =
    lane === "analysis" || lane === "analyze" || lane === "analyst" || lane === "review" || lane === "reviewer"
      ? "research"
      : lane
  const discipline: TaskDiscipline =
    isAnalysisOnly
      ? "research"
      : isApplyWorker
        ? "worker"
        : normalizedLane === "orchestrator" ||
            normalizedLane === "adversarial" ||
            normalizedLane === "research" ||
            normalizedLane === "synthesis" ||
            normalizedLane === "worker"
          ? normalizedLane
          : isOrchestrator
            ? "orchestrator"
            : isAdversarial
              ? "adversarial"
              : /\b(research|search|source|fact|analy[sz]e|analysis|correctness|audit|inspect)\b/i.test(combined)
                ? "research"
                : isPatchWorker
                  ? "worker"
                  : "general"
  const defaults: Record<TaskDiscipline, { schedulerLane: SchedulerControl.Lane | string; swarmTemplate?: TaskSwarmTemplate; expectedArtifact?: TaskArtifactType }> = {
    general: { schedulerLane: "subagent_tasks" },
    orchestrator: { schedulerLane: "orchestrator_swarm", swarmTemplate: "synthesize", expectedArtifact: "summary" },
    adversarial: { schedulerLane: "adversarial_review", swarmTemplate: "review", expectedArtifact: "critique" },
    research: { schedulerLane: "subagent_tasks", swarmTemplate: "search", expectedArtifact: "fact" },
    synthesis: { schedulerLane: "subagent_tasks", swarmTemplate: "synthesize", expectedArtifact: "summary" },
    worker: { schedulerLane: "subagent_tasks", swarmTemplate: "patch", expectedArtifact: "patch" },
  }
  const base = defaults[discipline]
  const inferredSwarmTemplate = input.swarmTemplate ?? (discipline === "worker" && isVerifyWorker ? "verify" : base.swarmTemplate)
  const inferredExpectedArtifact = input.expectedArtifact ?? (discipline === "worker" && isVerifyWorker ? "test_result" : base.expectedArtifact)
  return {
    discipline,
    schedulerLane: base.schedulerLane,
    swarmTemplate: inferredSwarmTemplate as TaskSwarmTemplate | undefined,
    expectedArtifact: inferredExpectedArtifact as TaskArtifactType | undefined,
  }
}

export function applyTaskDisciplineEnvelope(input: {
  discipline: TaskDiscipline
  description: string
  prompt: string
  swarmTemplate?: TaskSwarmTemplate
  expectedArtifact?: TaskArtifactType
}) {
  if (input.discipline === "general" && !input.swarmTemplate && !input.expectedArtifact) {
    return input.prompt
  }
  const disciplineLine: Record<TaskDiscipline, string | undefined> = {
    general: undefined,
    orchestrator: "Operating discipline: orchestrator.",
    adversarial: "Operating discipline: adversarial reviewer.",
    research: "Operating discipline: research scout.",
    synthesis: "Operating discipline: synthesis editor.",
    worker: "Operating discipline: bounded worker.",
  }
  const lines = [
    disciplineLine[input.discipline],
    input.discipline === "adversarial" ? "Focus on regressions, unsupported claims, missing evidence, and hidden failure modes." : undefined,
    `Assigned task: ${input.description}`,
    input.swarmTemplate ? `Swarm template: ${input.swarmTemplate}.` : undefined,
    input.expectedArtifact
      ? `Return a primary artifact of type "${input.expectedArtifact}" and start the response with "Artifact Summary: <one-line summary>".`
      : undefined,
  ].filter(Boolean)
  if (lines.length === 0) return input.prompt
  return [...lines, "", input.prompt].join("\n")
}

async function recordTaskLedger(job: RuntimeJob, input: {
  phase: ExecutionEvent["phase"]
  status?: string
  action: string
  messageID?: string
  error?: string
  priority?: TaskPriority
}) {
  await ExecutionLedger.append({
    jobID: job.taskID,
    sessionID: SessionID.make(job.taskID),
    supervisorSessionID: job.parentSessionID ? SessionID.make(job.parentSessionID) : undefined,
    kind: "task",
    lane: String(job.schedulerLane ?? "subagent_tasks"),
    priority: input.priority ?? job.priority,
    phase: input.phase,
    status: input.status ?? (input.phase === "error" ? "error" : input.phase === "canceled" ? "canceled" : job.status),
    description: job.description,
    time: Date.now(),
    source: "task",
    action: input.action,
    messageID: input.messageID ? MessageID.make(input.messageID) : undefined,
    error: input.error,
    pendingTurns: job.pendingTurns,
    queuedTurns: job.queuedTurns,
    paused: job.paused,
  }).catch((error) => {
    log.warn("failed to record task execution ledger event", { taskID: job.taskID, action: input.action, error })
  })
}

function markRunning(job: RuntimeJob) {
  job.status = "running"
  job.finishedAt = undefined
  job.updatedAt = Date.now()
}

function resolveWaiters(job: RuntimeJob) {
  const waiters = job.waiters.splice(0, job.waiters.length)
  for (const resolve of waiters) resolve()
}

function queuePosition(job: RuntimeJob) {
  const idx = runtimeQueue().findIndex((turn) => turn.taskID === job.taskID)
  return idx >= 0 ? idx + 1 : undefined
}

function effectivePriority(input: {
  priority: TaskPriority
  createdAt: number
  agingMS: number
}): TaskPriority {
  const agingSteps = input.agingMS > 0 ? Math.floor((Date.now() - input.createdAt) / input.agingMS) : 0
  const boosted = scorePriority(input.priority) + agingSteps * 0.25
  return labelPriority(boosted)
}

function publishSupervisorInbox(
  job: RuntimeJob,
  status: SupervisorStatus,
  input?: {
    messageID?: string
    error?: string
    eventKind?: SchedulerEventKind
    priority?: TaskPriority
    effectivePriority?: TaskPriority
    queuePosition?: number
  },
) {
  const now = Date.now()
  const key = [
    status,
    input?.eventKind ?? "",
    String(job.pendingTurns),
    String(job.queuedTurns),
    String(input?.priority ?? job.priority),
    String(input?.effectivePriority ?? ""),
    String(input?.queuePosition ?? queuePosition(job) ?? ""),
    String(job.paused),
    String(input?.messageID ?? ""),
    String(input?.error ?? ""),
  ].join("|")
  if (job.lastInboxKey === key && now - (job.lastInboxAt ?? 0) <= supervisorInboxDedupMS) {
    return
  }
  job.lastInboxKey = key
  job.lastInboxAt = now
  void Bus.publish(TaskEvent.SupervisorInbox, {
    status,
    taskID: job.taskID,
    supervisorSessionID: job.parentSessionID,
    subagentType: job.subagentType,
    description: job.description,
    pendingTurns: job.pendingTurns,
    queuedTurns: job.queuedTurns,
    priority: input?.priority ?? job.priority,
    effectivePriority: input?.effectivePriority,
    queuePosition: input?.queuePosition ?? queuePosition(job),
    paused: job.paused,
    eventKind: input?.eventKind,
    messageID: input?.messageID,
    error: input?.error,
    time: now,
  })
}

function heartbeatStart(job: RuntimeJob, heartbeatMS: number) {
  if (heartbeatTimers.has(job.taskID)) return
  job.heartbeatMS = heartbeatMS
  const timer = setInterval(() => {
    job.updatedAt = Date.now()
    if (job.status !== "canceled") {
      publishSupervisorInbox(job, "started", {
        eventKind: "heartbeat",
      })
    }
  }, heartbeatMS)
  timer.unref?.()
  heartbeatTimers.set(job.taskID, timer)
}

function heartbeatStop(taskID: string) {
  const timer = heartbeatTimers.get(taskID)
  if (!timer) return
  clearInterval(timer)
  heartbeatTimers.delete(taskID)
  const job = runtimeJobs()[taskID]
  if (job) job.heartbeatMS = undefined
}

async function shouldCancelFromParentAbort(input: {
  supervisorSessionID: string
  signal: AbortSignal
}) {
  if (isSessionSteerInterrupt(input.signal.reason)) return false
  if (SessionPrompt.isSteerPending(input.supervisorSessionID)) return false
  await Bun.sleep(parentAbortSteerGraceMS)
  if (isSessionSteerInterrupt(input.signal.reason)) return false
  if (SessionPrompt.isSteerPending(input.supervisorSessionID)) return false
  return true
}

function ensureJob(input: {
  taskID: string
  parentSessionID?: string
  subagentType: string
  description: string
  model: ModelRef
  discipline?: TaskDiscipline
  schedulerLane?: SchedulerControl.Lane | string
  swarmTemplate?: TaskSwarmTemplate
  expectedArtifact?: TaskArtifactType
  priority?: TaskPriority
  dependsOnTaskIDs?: string[]
}) {
  const jobs = runtimeJobs()
  const existing = jobs[input.taskID]
  if (existing) {
    if (input.parentSessionID && !existing.parentSessionID) existing.parentSessionID = input.parentSessionID
    if (input.subagentType) existing.subagentType = input.subagentType
    if (input.description) existing.description = input.description
    existing.discipline = input.discipline ?? existing.discipline
    existing.schedulerLane = input.schedulerLane ?? existing.schedulerLane
    existing.swarmTemplate = input.swarmTemplate ?? existing.swarmTemplate
    existing.expectedArtifact = input.expectedArtifact ?? existing.expectedArtifact
    if (input.dependsOnTaskIDs) existing.dependsOnTaskIDs = [...new Set(input.dependsOnTaskIDs)]
    if (input.priority && higherPriority(input.priority, existing.priority)) existing.priority = input.priority
    existing.model = input.model
    return existing
  }

  const now = Date.now()
  const parentJob = input.parentSessionID ? jobs[input.parentSessionID] : undefined
  const parentTaskID = parentJob ? input.parentSessionID : undefined
  const rootSupervisorSessionID = parentJob?.rootSupervisorSessionID ?? input.parentSessionID
  const job: RuntimeJob = {
    taskID: input.taskID,
    parentSessionID: input.parentSessionID,
    parentTaskID,
    rootSupervisorSessionID,
    subagentType: input.subagentType,
    description: input.description,
    model: input.model,
    discipline: input.discipline,
    schedulerLane: input.schedulerLane,
    swarmTemplate: input.swarmTemplate,
    expectedArtifact: input.expectedArtifact,
    artifacts: [],
    priority: input.priority ?? "normal",
    dependsOnTaskIDs: [...new Set(input.dependsOnTaskIDs ?? [])],
    status: "completed",
    pendingTurns: 0,
    queuedTurns: 0,
    paused: false,
    lineageDepth: parentJob ? parentJob.lineageDepth + 1 : 0,
    childTaskIDs: [],
    lastInboxKey: undefined,
    lastInboxAt: undefined,
    startedAt: now,
    updatedAt: now,
    waiters: [],
  }
  jobs[input.taskID] = job
  if (parentJob && !parentJob.childTaskIDs.includes(input.taskID)) {
    parentJob.childTaskIDs.push(input.taskID)
  }
  return job
}

async function ensureJobFromSession(taskID: string, fallbackParentSessionID: string) {
  const existing = runtimeJobs()[taskID]
  if (existing) return refreshJobFromLedger(existing)

  const session = await Session.get(SessionID.make(taskID)).catch(() => undefined)
  if (!session) return

  let agentName: string | undefined
  let model: ModelRef | undefined
  for await (const item of MessageV2.stream(SessionID.make(taskID))) {
    if (item.info.role !== "user") continue
    agentName = item.info.agent
    model = item.info.model
    break
  }

  if (!agentName || !model) return
  const live = SessionStatus.get(SessionID.make(taskID))
  const pendingTurns = live.type === "idle" ? 0 : 1
  const status: JobStatus = pendingTurns > 0 ? "running" : "completed"

  const job = ensureJob({
    taskID,
    parentSessionID: session.parentID ?? fallbackParentSessionID,
    subagentType: agentName,
    description: `Resumed task @${agentName}`,
    model,
  })
  job.pendingTurns = pendingTurns
  job.queuedTurns = 0
  job.paused = false
  job.status = status
  job.updatedAt = Date.now()
  if (status !== "running") {
    job.finishedAt = Date.now()
  }
  return refreshJobFromLedger(job)
}

async function requireSupervisorOwnedJob(taskID: string, supervisorSessionID: string, field: string) {
  const job = (await ensureJobFromSession(taskID, supervisorSessionID)) ?? runtimeJobs()[taskID]
  if (!job) throw new Error(`Unknown ${field}: ${taskID}`)
  if (job.parentSessionID !== supervisorSessionID) {
    throw new Error(`${field} "${taskID}" is not owned by the current supervisor session.`)
  }
  return job
}

async function assertSupervisorSession(sessionID: string) {
  const session = await Session.get(SessionID.make(sessionID)).catch(() => undefined)
  if (session?.parentID) {
    throw new Error("Mailbox relay actions are only available to top-level supervisor sessions.")
  }
}

async function waitForIdle(job: RuntimeJob, timeoutMS: number) {
  await refreshJobFromLedger(job)
  if (job.status !== "running" && job.pendingTurns <= 0 && job.queuedTurns <= 0) return true
  if (timeoutMS <= 0) return false

  const end = Date.now() + timeoutMS
  while (Date.now() < end) {
    const settled = await new Promise<boolean>((resolve) => {
      let done = false
      const finish = (value: boolean) => {
        if (done) return
        done = true
        resolve(value)
      }

      const waiter = () => finish(true)
      job.waiters.push(waiter)
      const timer = setTimeout(() => {
        const idx = job.waiters.indexOf(waiter)
        if (idx >= 0) job.waiters.splice(idx, 1)
        finish(false)
      }, Math.min(250, Math.max(1, end - Date.now())))
      timer.unref?.()
    })
    await refreshJobFromLedger(job)
    if (settled || (job.status !== "running" && job.pendingTurns <= 0 && job.queuedTurns <= 0)) return true
  }
  await refreshJobFromLedger(job)
  return job.status !== "running" && job.pendingTurns <= 0 && job.queuedTurns <= 0
}

function taskSchedulerSettings(config: Awaited<ReturnType<typeof Config.get>>) {
  const settings = (config.experimental as any)?.orchestration?.task_scheduler
  const maxConcurrencyRaw = settings?.max_concurrency
  const heartbeatMSRaw = settings?.heartbeat_ms ?? 1_000
  const recoveryStuckMSRaw = settings?.recovery_stuck_ms
  return {
    enabled: settings?.enabled ?? true,
    maxConcurrency:
      typeof maxConcurrencyRaw === "number" && Number.isFinite(maxConcurrencyRaw)
        ? Math.max(1, maxConcurrencyRaw)
        : Number.MAX_SAFE_INTEGER,
    agingMS: Math.max(1_000, settings?.aging_ms ?? 45_000),
    preemption: settings?.preemption ?? "soft",
    heartbeatMS: Math.max(1_000, heartbeatMSRaw),
    recoveryStuckMS:
      typeof recoveryStuckMSRaw === "number" ? Math.max(10_000, recoveryStuckMSRaw) : undefined,
  }
}

async function refreshJobFromLedger(job: RuntimeJob) {
  if (job.status === "canceled") return job
  const events = (
    await ExecutionLedger.list({
      jobID: job.taskID,
      order: "desc",
      limit: 8,
    })
  )
  const latest = events.find((event) => event.source === "task") ?? events[0]
  if (!latest) return job
  job.latestExecution = latest
  if (
    (latest.phase === "queued" || latest.phase === "dispatched" || latest.phase === "running") &&
    (job.lastResult || job.lastError) &&
    !heartbeatTimers.has(job.taskID) &&
    !runtimeQueue().some((turn) => turn.taskID === job.taskID)
  ) {
    return job
  }
  job.pendingTurns = latest.pendingTurns ?? job.pendingTurns
  job.queuedTurns = latest.queuedTurns ?? job.queuedTurns
  job.paused = latest.paused ?? job.paused
  job.updatedAt = Math.max(job.updatedAt, latest.time)
  if (latest.phase === "completed") {
    if (job.status === "error") return job
    if (job.pendingTurns > 0 || runtimeQueue().some((turn) => turn.taskID === job.taskID)) return job
    job.status = "completed"
    job.pendingTurns = 0
    job.queuedTurns = 0
    job.finishedAt = latest.time
    resolveWaiters(job)
  }
  if (latest.phase === "error") {
    job.status = "error"
    job.pendingTurns = 0
    job.queuedTurns = 0
    job.finishedAt = latest.time
    job.lastError = latest.error ?? job.lastError
    resolveWaiters(job)
  }
  if (latest.phase === "canceled") {
    job.status = "canceled"
    job.pendingTurns = 0
    job.queuedTurns = 0
    job.finishedAt = latest.time
    resolveWaiters(job)
  }
  if (latest.phase === "queued" || latest.phase === "dispatched" || latest.phase === "running") {
    job.status = "running"
    job.finishedAt = undefined
  }
  return job
}

function pickDispatchIndex(input: {
  queue: QueueTurn[]
  jobs: Record<string, RuntimeJob>
  runningBySupervisor: Map<string, number>
  maxConcurrency: number
  agingMS: number
}) {
  let selectedIndex = -1
  let selectedScore = -Infinity
  for (let i = 0; i < input.queue.length; i++) {
    const turn = input.queue[i]
    const job = input.jobs[turn.taskID]
    if (!job) continue
    if (job.status === "canceled" || job.paused) continue
    if (!dependencyState(job, input.jobs).satisfied) continue
    const supervisor = job.parentSessionID ?? `self:${job.taskID}`
    const running = input.runningBySupervisor.get(supervisor) ?? 0
    if (running >= input.maxConcurrency) continue
    const effective = effectivePriority({
      priority: turn.priority,
      createdAt: turn.createdAt,
      agingMS: input.agingMS,
    })
    const score = scorePriority(effective) * 1_000_000 - turn.id
    if (score > selectedScore) {
      selectedIndex = i
      selectedScore = score
    }
  }
  return selectedIndex
}

function dependenciesSatisfied(job: RuntimeJob, jobs: Record<string, RuntimeJob>) {
  return dependencyState(job, jobs).satisfied
}

function terminalDependencyBlock(job: RuntimeJob, jobs: Record<string, RuntimeJob>) {
  const state = dependencyState(job, jobs)
  if (state.satisfied) return
  const reasons = [
    ...(state.missingTaskIDs.length > 0 ? [`missing: ${state.missingTaskIDs.join(",")}`] : []),
    ...(state.failedTaskIDs.length > 0 ? [`failed: ${state.failedTaskIDs.join(",")}`] : []),
    ...(state.canceledTaskIDs.length > 0 ? [`canceled: ${state.canceledTaskIDs.join(",")}`] : []),
  ]
  if (reasons.length === 0) return
  return `Task dependency blocked permanently (${reasons.join("; ")})`
}

async function failTerminalDependencyTurns() {
  const state = runtime()
  const jobs = runtimeJobs()
  const keep: QueueTurn[] = []
  for (const turn of state.queue) {
    const job = jobs[turn.taskID]
    if (!job) {
      turn.reject?.(new Error(`Task ${turn.taskID} is unavailable`))
      continue
    }
    const reason = terminalDependencyBlock(job, jobs)
    if (!reason) {
      keep.push(turn)
      continue
    }
    job.status = "error"
    job.pendingTurns = 0
    job.queuedTurns = Math.max(0, job.queuedTurns - 1)
    job.lastError = reason
    job.updatedAt = Date.now()
    job.finishedAt = job.updatedAt
    turn.reject?.(new Error(reason))
    await publishWorkGraphLane(job, "error")
    await recordTaskLedger(job, {
      phase: "error",
      status: "error",
      action: "dependency_blocked",
      error: reason,
      priority: turn.priority,
    })
    publishSupervisorInbox(job, "error", { eventKind: "status", error: reason })
    resolveWaiters(job)
  }
  state.queue = keep
}

function triggerDispatch() {
  void dispatchTurns().catch((error) => {
    log.error("task scheduler dispatch failed", { error })
  })
}

function clearQueuedTurns(taskID: string, reason: Error) {
  const state = runtime()
  const queue = state.queue
  const keep: QueueTurn[] = []
  for (const turn of queue) {
    if (turn.taskID === taskID) {
      turn.reject?.(reason)
      continue
    }
    keep.push(turn)
  }
  state.queue = keep
}

async function dispatchTurns() {
  const state = runtime()
  if (state.dispatching) return
  state.dispatching = true
  try {
    const config = await Config.get()
    const scheduler = taskSchedulerSettings(config)
    await failTerminalDependencyTurns()
    if (!scheduler.enabled) {
      while (state.queue.length > 0) {
        const turn = state.queue.shift()!
        const job = runtimeJobs()[turn.taskID]
        if (!job || job.status === "canceled") {
          turn.reject?.(new Error(`Task ${turn.taskID} is unavailable`))
          continue
        }
        if (!dependenciesSatisfied(job, runtimeJobs())) {
          state.queue.push(turn)
          break
        }
        job.queuedTurns = Math.max(0, job.queuedTurns - 1)
        markRunning(job)
        await publishWorkGraphLane(job, "running")
        await recordTaskLedger(job, {
          phase: "dispatched",
          status: "running",
          action: "dispatch",
          priority: turn.priority,
        })
        publishSupervisorInbox(job, "started", {
          eventKind: "dispatched",
          priority: turn.priority,
          effectivePriority: turn.priority,
        })
        void SchedulerControl.submit({
          kind: "task_turn",
          lane: getEffectiveDispatchLane(job.schedulerLane),
          priority: turn.priority,
          sessionID: SessionID.make(job.taskID),
          supervisorSessionID: job.parentSessionID,
          rootSessionID: job.parentSessionID ?? job.taskID,
          description: job.description,
          waitForResult: true,
          run: () =>
            runTurn({
              job,
              promptInput: turn.promptInput,
              background: false,
              heartbeatMS: scheduler.heartbeatMS,
              recoveryStuckMS: scheduler.recoveryStuckMS,
            }),
        })
          .then((scheduled) => turn.resolve?.(scheduled.result as Awaited<ReturnType<typeof runTurn>>))
          .catch((error) => turn.reject?.(error))
      }
      return
    }

    while (true) {
      const jobs = runtimeJobs()
      const queue = runtimeQueue()
      if (queue.length === 0) break

      const runningBySupervisor = new Map<string, number>()
      for (const job of Object.values(jobs)) {
        if (job.pendingTurns <= 0) continue
        const supervisor = job.parentSessionID ?? `self:${job.taskID}`
        runningBySupervisor.set(supervisor, (runningBySupervisor.get(supervisor) ?? 0) + 1)
      }

      const selectedIndex = pickDispatchIndex({
        queue,
        jobs,
        runningBySupervisor,
        maxConcurrency: scheduler.maxConcurrency,
        agingMS: scheduler.agingMS,
      })
      if (selectedIndex < 0) break

      const [turn] = queue.splice(selectedIndex, 1)
      const job = jobs[turn.taskID]
      if (!job || job.status === "canceled") {
        turn.reject?.(new Error(`Task ${turn.taskID} is unavailable`))
        continue
      }
      if (job.paused) {
        // Safety: return to queue and stop churn; wait for explicit resume.
        queue.unshift(turn)
        break
      }

      job.queuedTurns = Math.max(0, job.queuedTurns - 1)
      if (higherPriority(turn.priority, job.priority)) {
        job.priority = turn.priority
      }
      markRunning(job)
      await publishWorkGraphLane(job, "running")
      await recordTaskLedger(job, {
        phase: "dispatched",
        status: "running",
        action: "dispatch",
        priority: turn.priority,
      })
      publishSupervisorInbox(job, "started", {
        eventKind: "dispatched",
        priority: turn.priority,
        effectivePriority: effectivePriority({
          priority: turn.priority,
          createdAt: turn.createdAt,
          agingMS: scheduler.agingMS,
        }),
      })
      void SchedulerControl.submit({
        kind: "task_turn",
        lane: getEffectiveDispatchLane(job.schedulerLane),
        priority: turn.priority,
        sessionID: SessionID.make(job.taskID),
        supervisorSessionID: job.parentSessionID,
        rootSessionID: job.parentSessionID ?? job.taskID,
        description: job.description,
        waitForResult: true,
        run: () =>
          runTurn({
            job,
            promptInput: turn.promptInput,
            background: false,
            heartbeatMS: scheduler.heartbeatMS,
            recoveryStuckMS: scheduler.recoveryStuckMS,
          }),
      })
        .then((scheduled) => turn.resolve?.(scheduled.result as Awaited<ReturnType<typeof runTurn>>))
        .catch((error) => turn.reject?.(error))
        .finally(() => {
          triggerDispatch()
        })
    }
  } finally {
    state.dispatching = false
  }
}

async function enqueueTurn(input: {
  job: RuntimeJob
  promptInput: SessionPrompt.PromptInput
  priority: TaskPriority
  waitForResult: boolean
}) {
  const state = runtime()
  const job = input.job
  let promise: Promise<Awaited<ReturnType<typeof runTurn>>> | undefined
  const turn: QueueTurn = {
    id: ++state.queueSeq,
    taskID: job.taskID,
    promptInput: input.promptInput,
    priority: input.priority,
    createdAt: Date.now(),
    supervisorSessionID: job.parentSessionID,
  }
  if (input.waitForResult) {
    promise = new Promise<Awaited<ReturnType<typeof runTurn>>>((resolve, reject) => {
      turn.resolve = resolve
      turn.reject = reject
    })
  }
  job.queuedTurns += 1
  job.updatedAt = Date.now()
  if (higherPriority(input.priority, job.priority)) {
    job.priority = input.priority
  }
  state.queue.push(turn)
  await publishWorkGraphLane(job, "queued")
  await recordTaskLedger(job, {
    phase: "queued",
    status: "running",
    action: job.lastMessageID || job.lastResult || job.lastError ? "message" : "start",
    priority: input.priority,
  })
  publishSupervisorInbox(job, "queued", {
    eventKind: "queued",
    priority: input.priority,
    effectivePriority: input.priority,
    queuePosition: queuePosition(job),
  })
  if (terminalDependencyBlock(job, runtimeJobs())) {
    await failTerminalDependencyTurns()
  } else {
    triggerDispatch()
  }

  if (!input.waitForResult) {
    return {
      background: true as const,
    }
  }

  return await promise!
}

async function runTurn(input: {
  job: RuntimeJob
  promptInput: SessionPrompt.PromptInput
  background: boolean
  heartbeatMS: number
  recoveryStuckMS?: number
}) {
  const { job, promptInput, background, heartbeatMS, recoveryStuckMS } = input
  const firstPending = job.pendingTurns <= 0
  job.pendingTurns += 1
  markRunning(job)
  await publishWorkGraphLane(job, "running")
  await recordTaskLedger(job, {
    phase: "running",
    status: "running",
    action: "turn",
    messageID: promptInput.messageID,
  })
  if (firstPending) heartbeatStart(job, heartbeatMS)
  let recovered = false
  let stuckTimer: ReturnType<typeof setTimeout> | undefined
  if (recoveryStuckMS) {
    stuckTimer = setTimeout(() => {
      if (job.status === "canceled") return
      recovered = true
      SessionPrompt.cancel(SessionID.make(job.taskID))
    }, recoveryStuckMS)
    stuckTimer.unref?.()
  }

  const execute = async () => {
    try {
      const result = await SessionPrompt.prompt(promptInput)
      return {
        ok: true as const,
        result,
        text: extractText(result),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false as const,
        error: message,
      }
    }
  }

  const settle = async (output: Awaited<ReturnType<typeof execute>>) => {
    if (stuckTimer) clearTimeout(stuckTimer)
    job.pendingTurns = Math.max(0, job.pendingTurns - 1)
    job.queuedTurns = runtimeQueue().filter((turn) => turn.taskID === job.taskID).length
    if (job.pendingTurns <= 0) heartbeatStop(job.taskID)
    job.updatedAt = Date.now()

    if (output.ok) {
      job.lastMessageID = output.result.info.id
      job.lastResult = output.text
      job.lastError = undefined
      updateJobArtifact(job, output.text, output.result.info.id)
    } else if (job.status !== "canceled") {
      job.lastError = recovered
        ? `Recovered from stuck task turn after ${recoveryStuckMS}ms watchdog`
        : output.error
      log.error("task turn failed", { taskID: job.taskID, error: output.error })
    }

    if (recovered && job.status !== "canceled") {
      publishSupervisorInbox(job, "queued", {
        eventKind: "recovered",
        error: job.lastError,
      })
    }

    if (job.pendingTurns <= 0 && job.queuedTurns <= 0) {
      if (job.status !== "canceled") {
        job.status = output.ok ? "completed" : "error"
        if (job.status === "completed") {
          await publishWorkGraphArtifact(job)
          await publishWorkGraphLane(job, "completed")
          await recordTaskLedger(job, {
            phase: "completed",
            status: "completed",
            action: "turn_complete",
            messageID: job.lastMessageID,
          })
          publishSupervisorInbox(job, "completed", { messageID: job.lastMessageID })
        } else {
          await publishWorkGraphLane(job, "error")
          await recordTaskLedger(job, {
            phase: "error",
            status: "error",
            action: "turn_error",
            error: job.lastError ?? "Subagent task failed",
          })
          publishSupervisorInbox(job, "error", { error: job.lastError ?? "Subagent task failed" })
        }
      }
      job.finishedAt = Date.now()
      resolveWaiters(job)
      return
    }

    if (job.pendingTurns <= 0 && job.queuedTurns > 0 && job.status !== "canceled") {
      job.status = "running"
      publishSupervisorInbox(job, "queued", { eventKind: "status" })
      triggerDispatch()
    }
  }

  if (background) {
    void execute().then(settle)
    return {
      background: true as const,
    }
  }

  const output = await execute()
  await settle(output)
  if (job.status === "canceled") {
    throw new Error("Subagent task failed: prompt canceled")
  }
  if (!output.ok) {
    throw new Error(`Subagent task failed: ${output.error}`)
  }
  return {
    background: false as const,
    result: output.result,
    text: output.text,
  }
}

function buildToolRules(config: Awaited<ReturnType<typeof Config.get>>, hasTaskPermission: boolean) {
  return {
    todowrite: false,
    todoread: false,
    ...(hasTaskPermission ? {} : { task: false }),
    ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
  }
}

async function resolveSession(input: {
  params: z.infer<typeof parameters>
  ctx: Tool.Context
  agent: Agent.Info
  hasTaskPermission: boolean
  config: Awaited<ReturnType<typeof Config.get>>
}): Promise<Session.Info> {
  return await iife(async () => {
    if (input.params.task_id?.startsWith("ses_")) {
      const found = await Session.get(SessionID.make(input.params.task_id)).catch(() => {})
      if (found) return found
    }

    return await Session.create({
      parentID: input.ctx.sessionID,
      title: input.params.description + ` (@${input.agent.name} subagent)`,
      permission: [
        {
          permission: "todowrite",
          pattern: "*",
          action: "deny",
        },
        {
          permission: "todoread",
          pattern: "*",
          action: "deny",
        },
        ...(input.hasTaskPermission
          ? []
          : [
              {
                permission: "task" as const,
                pattern: "*" as const,
                action: "deny" as const,
              },
            ]),
        ...(input.config.experimental?.primary_tools?.map((t) => ({
          pattern: "*",
          action: "allow" as const,
          permission: t,
        })) ?? []),
      ],
    })
  })
}

const parameters = z.object({
  action: z
    .enum(["start", "message", "status", "wait", "cancel", "list", "relay", "broadcast", "pause", "resume", "escalate"])
    .optional()
    .describe(
      "Task action. start launches/resumes a subagent task. message sends another prompt to an existing task. status checks one task. wait blocks for completion. cancel aborts a task. list shows known tasks. relay forwards context/message from one subagent task to another via supervisor. broadcast forwards one message to multiple tasks via supervisor. pause/resume control task queue dispatch. escalate raises priority for queued work.",
    ),
  description: z.string().optional().describe("A short (3-5 words) description of the task"),
  prompt: z.string().optional().describe("The task or follow-up message for the subagent"),
  subagent_type: z.string().optional().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "Task session id. For start, set this to resume a previous subagent session. For message/status/wait/cancel, this identifies the target task. For relay, this can be used as legacy alias for to_task_id.",
    )
    .optional(),
  from_task_id: z.string().optional().describe("Source task id for action=relay or action=broadcast."),
  to_task_id: z.string().optional().describe("Destination task id for action=relay."),
  to_task_ids: z.array(z.string()).optional().describe("Destination task ids for action=broadcast."),
  wait_for_result: z
    .boolean()
    .optional()
    .describe("When true, blocks for the task result. Defaults to false so start/message dispatch work in background."),
  steer: z
    .boolean()
    .optional()
    .describe("When true, asks a busy task session to interrupt the current step and process the new message sooner."),
  priority: taskPriority
    .optional()
    .describe("Optional scheduler priority override. Defaults by action/steer/wait mode."),
  depends_on: z
    .array(z.string())
    .optional()
    .describe("Optional task ids that should complete before this task dispatches."),
  lane_hint: z
    .string()
    .optional()
    .describe("Optional scheduler lane/discipline hint for routed task execution."),
  model: taskModelOverride.optional().describe("Optional model override as provider/model string or model object."),
  swarm_template: z
    .enum(["search", "patch", "review", "verify", "synthesize"])
    .optional()
    .describe("Optional artifact workflow template for the task."),
  expected_artifact: z
    .enum(["draft", "fact", "patch", "summary", "warning", "test_result", "critique"])
    .optional()
    .describe("Optional primary artifact type expected from the task."),
  timeout_ms: z
    .number()
    .int()
    .min(1)
    .max(3_600_000)
    .optional()
    .describe("Wait timeout in milliseconds (used by action=wait)."),
  running_only: z.boolean().optional().describe("When listing tasks, include only currently running jobs."),
  include_all: z
    .boolean()
    .optional()
    .describe("When listing tasks, include all runtime tasks instead of only tasks started by the current parent session."),
  command: z.string().describe("The command that triggered this task").optional(),
  required_child_tasks: z.number().int().min(0).optional(),
  include_execution_history: z.boolean().optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx): Promise<{ title: string; metadata: Record<string, any>; output: string }> {
      const action = toAction(params.action)
      const config = await Config.get()
      const scheduler = taskSchedulerSettings(config)

      if (action === "list") {
        const jobs = Object.values(runtimeJobs())
          .filter((job) => (params.include_all ? true : job.parentSessionID === ctx.sessionID))
          .filter((job) => (params.running_only ? job.status === "running" || job.pendingTurns > 0 || job.queuedTurns > 0 : true))
          .sort((a, b) => b.updatedAt - a.updatedAt)
        const executionByTask = new Map<string, Awaited<ReturnType<typeof executionHistoryMetadata>>>()
        if (params.include_execution_history) {
          for (const job of jobs) {
            executionByTask.set(job.taskID, await executionHistoryMetadata(job.taskID))
          }
        }

        const output = [
          `task_count: ${jobs.length}`,
          `scheduler_enabled: ${scheduler.enabled}`,
          `scheduler_max_concurrency: ${scheduler.maxConcurrency}`,
          `scheduler_aging_ms: ${scheduler.agingMS}`,
          "",
          "<task_list>",
          ...jobs.map((job) =>
            [
              `task_id: ${job.taskID}`,
              `status: ${job.status}`,
              `pending_turns: ${job.pendingTurns}`,
              `queued_turns: ${job.queuedTurns}`,
              `paused: ${job.paused}`,
              `priority: ${job.priority}`,
              ...lineageStatusLines(job),
              ...dependencyStatusLines(job),
              ...(params.include_execution_history
                ? [`execution_latest_phase: ${executionByTask.get(job.taskID)?.executionLatestPhase ?? "unknown"}`]
                : []),
              "---",
            ].join("\n"),
          ),
          "</task_list>",
        ].join("\n")

        return {
          title: "Task list",
          metadata: {
            tasks: jobs.map((job) => ({
              taskID: job.taskID,
              status: job.status,
              pendingTurns: job.pendingTurns,
              queuedTurns: job.queuedTurns,
              paused: job.paused,
              priority: job.priority,
              subagentType: job.subagentType,
              updatedAt: job.updatedAt,
              ...(params.include_execution_history
                ? {
                    executionEventCount: executionByTask.get(job.taskID)?.executionEventCount ?? 0,
                    executionLatestAction: executionByTask.get(job.taskID)?.executionLatestAction,
                    executionLatestPhase: executionByTask.get(job.taskID)?.executionLatestPhase,
                  }
                : {}),
            })),
          },
          output,
        }
      }

      if (action === "relay" || action === "broadcast") {
        await assertSupervisorSession(ctx.sessionID)
        const prompt = requireField(params.prompt, "prompt", action)
        const fromTaskID = requireField(params.from_task_id, "from_task_id", action)
        const fromJob = await requireSupervisorOwnedJob(fromTaskID, ctx.sessionID, "from_task_id")

        const rawDestinations =
          action === "relay"
            ? [requireField(params.to_task_id ?? params.task_id, "to_task_id", action)]
            : (params.to_task_ids ?? []).map((x) => x.trim())

        const destinationTaskIDs = [...new Set(rawDestinations.filter((x) => !!x && x !== fromTaskID))]
        if (destinationTaskIDs.length === 0) {
          throw new Error(`The task tool action="${action}" requires at least one destination task different from from_task_id.`)
        }

        const waitForResult = params.wait_for_result ?? false
        const steer = params.steer ?? true
        const relayed: Array<{ taskID: string; subagentType: string; status: "running" | "completed"; text?: string }> = []
        const relayPriority = resolvePriority({
          requested: params.priority,
          action,
          waitForResult,
          steer,
        })

        for (const destinationTaskID of destinationTaskIDs) {
          const targetJob = await requireSupervisorOwnedJob(destinationTaskID, ctx.sessionID, "to_task_id")
          const agent = await Agent.get(targetJob.subagentType)
          if (!agent) throw new Error(`Unknown agent type: ${targetJob.subagentType}`)

          const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")
          const relayPrompt = [
            `Supervisor relay from task ${fromJob.taskID} (@${fromJob.subagentType}) to task ${targetJob.taskID} (@${targetJob.subagentType}).`,
            `Source description: ${fromJob.description}`,
            "",
            prompt,
          ].join("\n")
          const promptParts = await SessionPrompt.resolvePromptParts(relayPrompt)
          const promptInput: SessionPrompt.PromptInput = {
            messageID: MessageID.ascending(),
            sessionID: SessionID.make(targetJob.taskID),
            model: targetJob.model,
            priority: relayPriority,
            agent: agent.name,
            tools: buildToolRules(config, hasTaskPermission),
            parts: promptParts,
            ...(steer ? { steer: true } : {}),
          }

          targetJob.description = `Relay from ${fromJob.taskID} to ${targetJob.taskID}`
          const turn = await enqueueTurn({
            job: targetJob,
            promptInput,
            priority: relayPriority,
            waitForResult,
          })
          relayed.push({
            taskID: targetJob.taskID,
            subagentType: targetJob.subagentType,
            status: turn.background ? "running" : "completed",
            text: turn.background ? undefined : turn.text,
          })
        }

        const output = [
          `from_task_id: ${fromTaskID}`,
          `relay_count: ${relayed.length}`,
          "",
          "<mailbox_relay>",
          ...relayed.flatMap((item) => [
            `task_id: ${item.taskID}`,
            `subagent_type: ${item.subagentType}`,
            `status: ${item.status}`,
            ...(item.text ? [`result: ${item.text}`] : []),
            "---",
          ]),
          "</mailbox_relay>",
        ].join("\n")

        return {
          title: action === "relay" ? "Mailbox relay sent" : "Mailbox broadcast sent",
          metadata: {
            fromTaskID,
            relayed: relayed.map((item) => ({
              taskID: item.taskID,
              subagentType: item.subagentType,
              status: item.status,
            })),
          },
          output,
        }
      }

      if (action === "status" || action === "wait" || action === "cancel" || action === "pause" || action === "resume" || action === "escalate") {
        const taskID = requireField(params.task_id, "task_id", action)
        const job = runtimeJobs()[taskID] ?? (await ensureJobFromSession(taskID, ctx.sessionID))

        if (!job) {
          const live = SessionStatus.get(taskID)
          const status = live.type === "idle" ? "unknown" : "running"
          ctx.metadata({
            title: "Task status",
            metadata: {
              taskID,
              status,
            },
          })
          return {
            title: "Task status",
            metadata: {
              taskID,
              status,
            },
            output: [`task_id: ${taskID}`, `status: ${status}`, "", "<task_status>", "Task is not tracked in runtime.", "</task_status>"].join(
              "\n",
            ),
          }
        }

        ctx.metadata({
          title: taskActionTitle(taskProgressLabel(action), job),
          metadata: taskPresentationMetadata(job),
        })

        if (action === "cancel") {
          heartbeatStop(taskID)
          job.status = "canceled"
          job.pendingTurns = 0
          job.queuedTurns = 0
          job.updatedAt = Date.now()
          job.finishedAt = Date.now()
          clearQueuedTurns(taskID, new Error(`Task canceled: ${taskID}`))
          void recordTaskLedger(job, {
            phase: "canceled",
            status: "canceled",
            action: "cancel",
          })
          publishSupervisorInbox(job, "canceled", { eventKind: "status" })
          resolveWaiters(job)
          SessionPrompt.cancel(SessionID.make(taskID))
          await failTerminalDependencyTurns()
          triggerDispatch()
          return {
            title: taskActionTitle("Task canceled", job),
            metadata: taskPresentationMetadata(job),
            output: taskStatusOutput(job),
          }
        }

        if (action === "pause") {
          if (job.paused) {
            return {
              title: taskActionTitle("Task paused", job),
              metadata: taskPresentationMetadata(job, { paused: true }),
              output: taskStatusOutput(job),
            }
          }
          job.paused = true
          job.updatedAt = Date.now()
          void recordTaskLedger(job, {
            phase: "queued",
            status: "running",
            action: "pause",
          })
          publishSupervisorInbox(job, "queued", { eventKind: "paused" })
          return {
            title: taskActionTitle("Task paused", job),
            metadata: taskPresentationMetadata(job, { paused: true }),
            output: taskStatusOutput(job),
          }
        }

        if (action === "resume") {
          if (!job.paused) {
            return {
              title: taskActionTitle("Task resumed", job),
              metadata: taskPresentationMetadata(job, { paused: false }),
              output: taskStatusOutput(job),
            }
          }
          job.paused = false
          job.updatedAt = Date.now()
          void recordTaskLedger(job, {
            phase: "queued",
            status: "running",
            action: "resume",
          })
          publishSupervisorInbox(job, "queued", { eventKind: "resumed" })
          triggerDispatch()
          return {
            title: taskActionTitle("Task resumed", job),
            metadata: taskPresentationMetadata(job, { paused: false }),
            output: taskStatusOutput(job),
          }
        }

        if (action === "escalate") {
          const nextPriority = params.priority ?? "urgent"
          if (higherPriority(nextPriority, job.priority)) {
            job.priority = nextPriority
          }
          for (const turn of runtimeQueue()) {
            if (turn.taskID !== taskID) continue
            if (higherPriority(nextPriority, turn.priority)) {
              turn.priority = nextPriority
            }
          }
          job.updatedAt = Date.now()
          void recordTaskLedger(job, {
            phase: "queued",
            status: "running",
            action: "escalate",
            priority: nextPriority,
          })
          publishSupervisorInbox(job, "queued", {
            eventKind: "escalated",
            priority: nextPriority,
            effectivePriority: nextPriority,
          })
          triggerDispatch()
          return {
            title: taskActionTitle("Task escalated", job),
            metadata: taskPresentationMetadata(job, { priority: job.priority }),
            output: taskStatusOutput(job),
          }
        }

        if (action === "wait") {
          const timeoutMS = params.timeout_ms ?? 300_000
          const settled = await waitForIdle(job, timeoutMS)
          const title = !settled
            ? "Task still running"
            : job.status === "canceled"
              ? "Task canceled"
              : job.status === "error"
                ? "Task failed"
                : "Task completed"
          return {
            title: taskActionTitle(title, job),
            metadata: taskPresentationMetadata(job, {
              settled,
              waitReason: settled ? "settled" : "timeout",
            }),
            output: taskStatusOutput(job),
          }
        }

        const execution = params.include_execution_history ? await executionHistoryMetadata(job.taskID) : undefined
        const heartbeat = heartbeatHealth(job)
        return {
          title: taskActionTitle("Task status", job),
          metadata: taskPresentationMetadata(job, {
            pendingTurns: job.pendingTurns,
            heartbeatState: heartbeat.state,
            heartbeatExpectedMS: heartbeat.expectedMS,
            heartbeatAgeMS: heartbeat.ageMS,
            ...(execution
              ? {
                  executionEventCount: execution.executionEventCount,
                  executionLatestPhase: execution.executionLatestPhase,
                  executionLatestStatus: execution.executionLatestStatus,
                  executionLatestAction: execution.executionLatestAction,
                }
              : {}),
          }),
          output: [taskStatusOutput(job), ...(execution ? executionHistoryLines(execution.executionEvents) : [])].join("\n"),
        }
      }

      if (action !== "start" && action !== "message") {
        throw new Error(`Unknown task action: ${action}`)
      }

      const prompt = requireField(params.prompt, "prompt", action)
      const defaultWait = false
      const waitForResult = params.wait_for_result ?? defaultWait
      const steer = params.steer ?? action === "message"
      const requestedTaskID = action === "message" ? requireField(params.task_id, "task_id", action) : params.task_id

      if (action === "message" && requestedTaskID) {
        await ensureJobFromSession(requestedTaskID, ctx.sessionID)
      }

      const agentName = iife(() => {
        if (params.subagent_type?.trim()) return normalizeSubagentType(params.subagent_type)
        if (action === "message") return runtimeJobs()[requestedTaskID ?? ""]?.subagentType
        return undefined
      })
      const subagentType = requireField(agentName, "subagent_type", action)
      const taskDescription =
        params.description?.trim() ?? (action === "message" ? `Message for @${subagentType} subagent` : undefined)
      const descriptionText = requireField(taskDescription, "description", action)

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [subagentType],
          always: ["*"],
          metadata: {
            description: descriptionText,
            subagent_type: subagentType,
          },
        })
      }

      const agent = await Agent.get(subagentType)
      if (!agent) throw new Error(`Unknown agent type: ${subagentType} is not a valid agent type`)

      const routing = resolveTaskRouting({
        laneHint: params.lane_hint,
        swarmTemplate: params.swarm_template,
        expectedArtifact: params.expected_artifact,
        description: descriptionText,
        prompt,
      })
      const parentJob = runtimeJobs()[ctx.sessionID]
      const hasTaskPermission =
        agent.permission.some((rule) => rule.permission === "task") ||
        routing.discipline === "orchestrator" ||
        hasOrchestratorLineage(parentJob)
      const session = await resolveSession({
        params: {
          ...params,
          task_id: requestedTaskID,
          description: descriptionText,
          subagent_type: subagentType,
          prompt,
        },
        ctx,
        agent,
        hasTaskPermission,
        config,
      })

      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const parentModel: ModelRef = {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const parsedModel = params.model ? parseModelOverride(params.model) : undefined
      const agentDefaultIsLightweightCodex =
        agent.model?.providerID === "openrouter" && /codex-spark/i.test(String(agent.model.modelID))
      const useAgentDefault = Boolean(agent.model && !agentDefaultIsLightweightCodex)
      const model: ModelRef = parsedModel ?? (useAgentDefault ? agent.model! : parentModel)

      ctx.metadata({
        title: descriptionText,
        metadata: {
          taskID: session.id,
          sessionId: session.id,
          taskDescription: descriptionText,
          subagentType: agent.name,
          model,
          discipline: routing.discipline,
          schedulerLane: routing.schedulerLane,
          swarmTemplate: routing.swarmTemplate,
          expectedArtifact: routing.expectedArtifact,
          reviewStatus: "idle",
        },
      })

      // Foreground task calls are coupled to the parent turn abort signal.
      // Background task calls remain detached so parent steering/interrupts do not
      // kill subprocesses that were explicitly launched to run independently.
      const shouldCancelOnParentAbort = waitForResult
      let abortCleanup: { [Symbol.dispose]: () => void } | undefined
      if (shouldCancelOnParentAbort) {
        function cancel() {
          void shouldCancelFromParentAbort({
            supervisorSessionID: ctx.sessionID,
            signal: ctx.abort,
          }).then((ok) => {
            if (!ok) return
            const job = runtimeJobs()[session.id]
            if (job) {
              job.status = "canceled"
              job.pendingTurns = 0
              job.queuedTurns = 0
              job.updatedAt = Date.now()
              job.finishedAt = job.updatedAt
              void recordTaskLedger(job, {
                phase: "canceled",
                status: "canceled",
                action: "parent_abort",
              })
              publishWorkGraphLane(job, "canceled")
              publishSupervisorInbox(job, "canceled", { eventKind: "status" })
              resolveWaiters(job)
            }
            SessionPrompt.cancel(session.id)
          })
        }
        ctx.abort.addEventListener("abort", cancel)
        if (ctx.abort.aborted) cancel()
        abortCleanup = defer(() => ctx.abort.removeEventListener("abort", cancel))
      }
      const promptParts = await SessionPrompt.resolvePromptParts(
        applyTaskDisciplineEnvelope({
          discipline: routing.discipline,
          description: descriptionText,
          swarmTemplate: routing.swarmTemplate,
          expectedArtifact: routing.expectedArtifact,
          prompt,
        }),
      )
      const requestedPriority = resolvePriority({
        requested: params.priority,
        action,
        waitForResult,
        steer,
      })

      const promptInput: SessionPrompt.PromptInput = {
        messageID: MessageID.ascending(),
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        priority: requestedPriority,
        agent: agent.name,
        tools: buildToolRules(config, hasTaskPermission),
        parts: promptParts,
        ...(steer ? { steer: true } : {}),
      }

      const job = ensureJob({
        taskID: session.id,
        parentSessionID: ctx.sessionID,
        subagentType: agent.name,
        description: descriptionText,
        model,
        discipline: routing.discipline,
        schedulerLane: routing.schedulerLane,
        swarmTemplate: routing.swarmTemplate,
        expectedArtifact: routing.expectedArtifact,
        priority: requestedPriority,
        dependsOnTaskIDs: params.depends_on,
      })
      if (shouldCancelOnParentAbort && ctx.abort.aborted) {
        void shouldCancelFromParentAbort({
          supervisorSessionID: ctx.sessionID,
          signal: ctx.abort,
        }).then((ok) => {
          if (!ok) return
          job.status = "canceled"
          job.pendingTurns = 0
          job.queuedTurns = 0
          job.updatedAt = Date.now()
          job.finishedAt = job.updatedAt
          void recordTaskLedger(job, {
            phase: "canceled",
            status: "canceled",
            action: "parent_abort",
          })
          publishWorkGraphLane(job, "canceled")
          publishSupervisorInbox(job, "canceled", { eventKind: "status" })
          resolveWaiters(job)
          SessionPrompt.cancel(session.id)
        })
      }
      let turn: Awaited<ReturnType<typeof enqueueTurn>>
      try {
        turn = await enqueueTurn({
          job,
          promptInput,
          priority: job.priority,
          waitForResult,
        })
      } finally {
        abortCleanup?.[Symbol.dispose]()
      }

      if (
        waitForResult &&
        routing.discipline === "orchestrator" &&
        params.required_child_tasks !== undefined &&
        job.childTaskIDs.length < params.required_child_tasks
      ) {
        job.status = "error"
        job.lastError = `Task required at least ${params.required_child_tasks} child task(s), but only observed ${job.childTaskIDs.length}.`
        throw new Error(job.lastError)
      }

      const output = turn.background
        ? [
            `task_id: ${session.id}`,
            "status: running",
            "",
            "<task_status>",
            "Task is running in background. Use action=status, action=wait, or action=message with this task_id.",
            "</task_status>",
          ].join("\n")
        : taskResultOutput(session.id, turn.text)

      return {
        title: descriptionText,
        metadata: {
          taskID: session.id,
          sessionId: session.id,
          taskDescription: descriptionText,
          subagentType: agent.name,
          status: job.status,
          model,
          discipline: routing.discipline,
          schedulerLane: routing.schedulerLane,
          swarmTemplate: job.swarmTemplate,
          expectedArtifact: job.expectedArtifact,
          artifactCount: job.artifacts?.length ?? 0,
          artifactType: latestArtifact(job)?.type,
          artifactSummary: latestArtifact(job)?.summary,
          reviewStatus: "idle",
          parentTaskID: job.parentTaskID,
          rootSupervisorSessionID: job.rootSupervisorSessionID,
          lineageDepth: job.lineageDepth,
          lineagePath: [...(job.parentTaskID ? [job.parentTaskID] : []), job.taskID],
          childTaskIDs: job.childTaskIDs,
        },
        output,
      }
    },
  }
})
