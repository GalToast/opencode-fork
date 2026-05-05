import path from "path"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import { SessionForeground } from "@/session/foreground"
import { ExecutionLedger } from "@/execution/ledger"

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace SchedulerControl {
  const log = Log.create({ service: "scheduler.control" })

  export const Priority = z.enum(["urgent", "steer", "normal", "background"])
  export type Priority = z.infer<typeof Priority>

  export const Lane = z.enum([
    "user_ingress",
    "main_turns",
    "steer_fastlane",
    "orchestrator_swarm",
    "adversarial_review",
    "subagent_tasks",
    "tool_io",
    "longrun_jobs",
  ])
  export type Lane = z.infer<typeof Lane>

  export const Mode = z.enum(["hybrid", "vanilla"])
  export type Mode = z.infer<typeof Mode>

  export const Kind = z.enum(["prompt", "command", "shell", "task_turn", "tool_admission"])
  export type Kind = z.infer<typeof Kind>

  export const SchedulerProfile = z.enum(["balanced_pro", "max_throughput", "conservative"])
  export type SchedulerProfile = z.infer<typeof SchedulerProfile>

  export const LaneRole = z.enum([
    "ingress",
    "foreground",
    "steering",
    "orchestrator",
    "adversarial",
    "worker",
    "tool_io",
    "longrun",
  ])
  export type LaneRole = z.infer<typeof LaneRole>
  const LaneSaturation = z.enum(["idle", "open", "queued", "saturated"])

  const JobStatus = z.enum(["queued", "running", "completed", "error", "canceled", "recovery_failed"])

  const LaneLatest = z.object({
    description: z.string(),
    status: JobStatus,
    priority: Priority,
    sessionID: Identifier.schema("session"),
    time: z.number(),
  })

  const LaneStatus = z.object({
    lane: Lane,
    role: LaneRole,
    queued: z.number().int().min(0),
    running: z.number().int().min(0),
    paused: z.boolean(),
    concurrency: z.number().int().min(1),
    health: z.object({
      oldestQueuedAgeMS: z.number().int().min(0),
      starvationThresholdMS: z.number().int().min(0).optional(),
      starved: z.boolean(),
      saturation: LaneSaturation,
    }),
    latest: LaneLatest.optional(),
  })

  export const Status = z.object({
    mode: Mode,
    profile: SchedulerProfile,
    time: z.number(),
    queuedTotal: z.number().int().min(0),
    runningTotal: z.number().int().min(0),
    lanes: z.array(LaneStatus),
  })

  export const Event = {
    Update: BusEvent.define(
      "scheduler.control.update",
      Status.extend({
        latest: z
          .object({
            jobID: Identifier.schema("part"),
            kind: Kind,
            lane: Lane,
            priority: Priority,
            status: JobStatus,
            sessionID: Identifier.schema("session"),
            supervisorSessionID: Identifier.schema("session").optional(),
            description: z.string(),
          })
          .optional(),
        recoveryDropped: z.number().int().min(0).optional(),
        recoveryRequeued: z.number().int().min(0).optional(),
      }),
    ),
  }

  type ResumeSpec = {
    key: string
    payload: unknown
  }

  type ResumeHandler = (payload: unknown) => Promise<unknown>
  const resumeHandlers = new Map<string, ResumeHandler>()

  const priorityRank: Record<Priority, number> = {
    background: 0,
    normal: 1,
    steer: 2,
    urgent: 3,
  }
  const perRootLaneCaps: Partial<Record<Lane, number>> = {
    main_turns: 1,
    steer_fastlane: 1,
    subagent_tasks: 4,
    tool_io: 2,
  }

  type JobMeta = {
    jobID: string
    kind: Kind
    lane: Lane
    priority: Priority
    status: z.infer<typeof JobStatus>
    sessionID: string
    supervisorSessionID?: string
    rootSessionID: string
    description: string
    createdAt: number
    startedAt?: number
    finishedAt?: number
    error?: string
    durable: boolean
    dedupeKey?: string
    resume?: ResumeSpec
  }

  type PendingJob = Omit<JobMeta, "status">

  type QueueJob = JobMeta & {
    run: () => Promise<unknown>
    resolve?: (value: unknown) => void
    reject?: (reason?: unknown) => void
  }

  type PersistedState = {
    mode: Mode
    profile: SchedulerProfile
    pending: PendingJob[]
    queued: PendingJob[]
    running: PendingJob[]
    runningPrompts?: number // NEW: persist global counter
    time: number
  }

  type State = {
    initialized: boolean
    mode: Mode
    profile: SchedulerProfile
    seq: number
    dispatching: boolean
    dispatchPending: boolean
    mainTurnsDynamic: number
    mainTurnsScaledAt: number
    steerFastlaneDynamic: number
    steerFastlaneScaledAt: number
    queues: Record<Lane, QueueJob[]>
    running: Record<Lane, number>
    runningPrompts: number // Track global prompt concurrency
    lanePaused: Record<Lane, boolean>
    laneLatest: Partial<Record<Lane, z.infer<typeof LaneLatest>>>
    jobs: Record<string, JobMeta>
    pending: PendingJob[]
    rootDebt: Record<string, number>
    runningByRoot: Record<Lane, Record<string, number>>
    rootDebtLastUpdatedAt: Record<string, number>
  }

  function normalizeRootSessionID(input: {
    rootSessionID?: string
    supervisorSessionID?: string
    sessionID?: string
  }) {
    return input.rootSessionID || input.supervisorSessionID || input.sessionID || "unknown"
  }

  function withNormalizedRootSessionID<
    T extends {
      rootSessionID?: string
      supervisorSessionID?: string
      sessionID?: string
    },
  >(job: T): T & { rootSessionID: string } {
    return {
      ...job,
      rootSessionID: normalizeRootSessionID(job),
    }
  }

  function laneList(): Lane[] {
    return Lane.options
  }

  function createEmptyQueues(): Record<Lane, QueueJob[]> {
    return {
      user_ingress: [],
      main_turns: [],
      steer_fastlane: [],
      orchestrator_swarm: [],
      adversarial_review: [],
      subagent_tasks: [],
      tool_io: [],
      longrun_jobs: [],
    }
  }

  function createEmptyCounters(): Record<Lane, number> {
    return {
      user_ingress: 0,
      main_turns: 0,
      steer_fastlane: 0,
      orchestrator_swarm: 0,
      adversarial_review: 0,
      subagent_tasks: 0,
      tool_io: 0,
      longrun_jobs: 0,
    }
  }

  function createEmptyRootRunning(): Record<Lane, Record<string, number>> {
    return {
      user_ingress: {},
      main_turns: {},
      steer_fastlane: {},
      orchestrator_swarm: {},
      adversarial_review: {},
      subagent_tasks: {},
      tool_io: {},
      longrun_jobs: {},
    }
  }

  function createState(): State {
    return {
      initialized: false,
      mode: "hybrid",
      profile: "balanced_pro",
      seq: 0,
      dispatching: false,
      dispatchPending: false,
      mainTurnsDynamic: 2,
      mainTurnsScaledAt: 0,
      steerFastlaneDynamic: 4,
      steerFastlaneScaledAt: 0,
      queues: createEmptyQueues(),
      running: createEmptyCounters(),
      runningPrompts: 0,
      lanePaused: {
        user_ingress: false,
        main_turns: false,
        steer_fastlane: false,
        orchestrator_swarm: false,
        adversarial_review: false,
        subagent_tasks: false,
        tool_io: false,
        longrun_jobs: false,
      },
      laneLatest: {},
      jobs: {},
      pending: [],
      rootDebt: {},
      rootDebtLastUpdatedAt: {},
      runningByRoot: createEmptyRootRunning(),
    }
  }

const state = Instance.state(
    () => createState(),
    (current) => {
      for (const lane of laneList()) {
        for (const job of current.queues[lane]) {
          job.reject?.(new Error("Scheduler disposed"))
        }
      }
      current.queues = createEmptyQueues()
      current.running = createEmptyCounters()
      current.runningPrompts = 0
      current.laneLatest = {}
      current.jobs = {}
      current.pending = []
      current.rootDebt = {}
      current.rootDebtLastUpdatedAt = {}
      current.runningByRoot = createEmptyRootRunning()
      current.initialized = false
      current.dispatching = false
      current.dispatchPending = false
      current.lanePaused = {
        user_ingress: false,
        main_turns: false,
        steer_fastlane: false,
        orchestrator_swarm: false,
        adversarial_review: false,
        subagent_tasks: false,
        tool_io: false,
        longrun_jobs: false,
      }
    },
  )

  function statePath() {
    return path.join(Global.Path.state, "scheduler-state.json")
  }

  function profileConcurrency(profile: SchedulerProfile): Record<Lane, number> {
    if (profile === "max_throughput") {
      return {
        user_ingress: 32,
        main_turns: 2,
        steer_fastlane: 16,
        orchestrator_swarm: 20,
        adversarial_review: 12,
        subagent_tasks: 64,
        tool_io: 24,
        longrun_jobs: 24,
      }
    }
    if (profile === "conservative") {
      return {
        user_ingress: 12,
        main_turns: 1,
        steer_fastlane: 4,
        orchestrator_swarm: 6,
        adversarial_review: 4,
        subagent_tasks: 12,
        tool_io: 6,
        longrun_jobs: 6,
      }
    }
    return {
      user_ingress: 24,
      main_turns: 1,
      steer_fastlane: 8,
      orchestrator_swarm: 12,
      adversarial_review: 8,
      subagent_tasks: 32,
      tool_io: 24,
      longrun_jobs: 12,
    }
  }

  function laneRole(lane: Lane): LaneRole {
    if (lane === "user_ingress") return "ingress"
    if (lane === "main_turns") return "foreground"
    if (lane === "steer_fastlane") return "steering"
    if (lane === "orchestrator_swarm") return "orchestrator"
    if (lane === "adversarial_review") return "adversarial"
    if (lane === "subagent_tasks") return "worker"
    if (lane === "tool_io") return "tool_io"
    return "longrun"
  }

  function recordLaneLatest(job: Pick<JobMeta, "lane" | "description" | "status" | "priority" | "sessionID">) {
    state().laneLatest[job.lane] = {
      description: job.description,
      status: job.status,
      priority: job.priority,
      sessionID: job.sessionID,
      time: Date.now(),
    }
  }

  async function appendExecutionEvent(
    job: Pick<
      JobMeta,
      "jobID" | "sessionID" | "supervisorSessionID" | "kind" | "lane" | "priority" | "status" | "description" | "error"
    >,
    phase: z.infer<typeof ExecutionLedger.Phase>,
  ) {
    await ExecutionLedger.append({
      jobID: job.jobID,
      sessionID: job.sessionID,
      supervisorSessionID: job.supervisorSessionID,
      kind: job.kind,
      lane: job.lane,
      priority: job.priority,
      phase,
      status: job.status,
      description: job.description,
      error: job.error,
      time: Date.now(),
    })
  }

  async function loadSettings() {
    const cfg = await Config.get()
    const schedulerCfg = (cfg.experimental as any)?.orchestration?.global_scheduler
    const enabled = schedulerCfg?.enabled ?? true
    const profile = schedulerCfg?.profile ?? "balanced_pro"
    const autoscaleCfg = schedulerCfg?.autoscale
    const autoscaleMin = Math.max(1, autoscaleCfg?.main_turns_min ?? 2)
    const autoscaleMax = Math.max(autoscaleMin, autoscaleCfg?.main_turns_max ?? 10)
    const steerMin = Math.max(1, autoscaleCfg?.steer_fastlane_min ?? 4)
    const steerMax = Math.max(steerMin, autoscaleCfg?.steer_fastlane_max ?? 16)
    const guardrailsCfg = schedulerCfg?.guardrails
    return {
      mode: enabled ? ("hybrid" as const) : ("vanilla" as const),
      profile,
      agingMS: Math.max(1_000, schedulerCfg?.aging_ms ?? 30_000),
      fairnessPenalty: schedulerCfg?.fairness_penalty ?? 0.1,
      laneOverrides: schedulerCfg?.lane_concurrency,
      autoscale: {
        enabled: autoscaleCfg?.enabled ?? true,
        min: autoscaleMin,
        max: autoscaleMax,
        scaleUpQueueThreshold: Math.max(1, autoscaleCfg?.scale_up_queue_threshold ?? 1),
        scaleDownRunningThreshold: Math.max(0, autoscaleCfg?.scale_down_running_threshold ?? 0),
        cooldownMS: Math.max(1_000, autoscaleCfg?.cooldown_ms ?? 5_000),
        steerEnabled: autoscaleCfg?.steer_fastlane_enabled ?? true,
        steerMin,
        steerMax,
        steerScaleUpQueueThreshold: Math.max(1, autoscaleCfg?.steer_scale_up_queue_threshold ?? 1),
        steerScaleDownRunningThreshold: Math.max(0, autoscaleCfg?.steer_scale_down_running_threshold ?? 0),
        steerCooldownMS: Math.max(1_000, autoscaleCfg?.steer_cooldown_ms ?? 3_000),
      },
      guardrails: {
        enabled: guardrailsCfg?.enabled ?? true,
        toolIOStarvationMS: Math.max(250, guardrailsCfg?.tool_io_starvation_ms ?? 2_000),
        longrunStarvationMS: Math.max(250, guardrailsCfg?.longrun_jobs_starvation_ms ?? 3_000),
        toolIOBias: guardrailsCfg?.tool_io_bias ?? 0.25,
        longrunBias: guardrailsCfg?.longrun_jobs_bias ?? 0.2,
      },
      rateLimits: {
        globalPromptConcurrency: schedulerCfg?.rate_limits?.global_prompt_concurrency ?? 15,
      },
    }
  }

  async function ensureInitialized() {
    const current = state()
    if (current.initialized) return
    current.initialized = true

    const settings = await loadSettings()
    current.mode = settings.mode
    current.profile = settings.profile
    current.mainTurnsDynamic = settings.autoscale.min
    current.steerFastlaneDynamic = settings.autoscale.steerMin

    if (process.env.OPENCODE_DISABLE_SCHEDULER_RECOVERY === "1") {
      await publishUpdate()
      return
    }

    const persisted = await Filesystem.readJson<PersistedState>(statePath()).catch(() => undefined)
    if (!persisted) {
      await publishUpdate()
      return
    }

    const recovered = await recoverPersistedJobs(current, persisted)
    if (recovered.dropped > 0 || recovered.pending > 0 || recovered.requeued > 0) {
      log.info("scheduler recovery applied", recovered)
    }
    await persistSnapshot()
    await publishUpdate(undefined, recovered.dropped, recovered.requeued)
    if (recovered.requeued > 0) triggerDispatch()
  }

  async function recoverPersistedJobs(current: State, persisted: PersistedState) {
    let dropped = 0
    let pending = 0
    let requeued = 0
    const merged = [...(persisted.pending ?? []), ...persisted.queued, ...persisted.running]
    for (const persistedJob of merged) {
      const raw = withNormalizedRootSessionID(persistedJob)
      if (!raw.durable || !raw.resume?.key) {
        dropped += 1
        continue
      }
      const handler = resumeHandlers.get(raw.resume.key)
      if (!handler) {
        current.pending.push(raw)
        pending += 1
        continue
      }
      await enqueueRecovered(current, raw, handler)
      requeued += 1
    }
    return { dropped, pending, requeued }
  }

  async function recoverPending(key: string) {
    const current = state()
    if (!current.initialized) return
    const handler = resumeHandlers.get(key)
    if (!handler) return
    const keep: PendingJob[] = []
    let requeued = 0
    for (const job of current.pending) {
      if (job.resume?.key !== key) {
        keep.push(job)
        continue
      }
      await enqueueRecovered(current, job, handler)
      requeued += 1
    }
    if (requeued === 0) return
    current.pending = keep
    await persistSnapshot()
    await publishUpdate(undefined, undefined, requeued)
    triggerDispatch()
  }

  function resolveMainTurnConcurrency(
    current: State,
    input: {
      profile: SchedulerProfile
      laneOverrides?: Partial<Record<Lane, number>>
      autoscale: {
        enabled: boolean
        min: number
        max: number
        scaleUpQueueThreshold: number
        scaleDownRunningThreshold: number
        cooldownMS: number
        steerEnabled: boolean
        steerMin: number
        steerMax: number
        steerScaleUpQueueThreshold: number
        steerScaleDownRunningThreshold: number
        steerCooldownMS: number
      }
    },
    base: number,
  ) {
    if (!input.autoscale.enabled) return base
    const now = Date.now()
    const queued = current.queues.main_turns.length + current.queues.steer_fastlane.length
    const running = current.running.main_turns
    const standbyDemand = Object.values(SessionForeground.list()).filter(
      (info) => info.awaitingPromotion && !!info.activeTurnID,
    ).length
    let next = Math.max(input.autoscale.min, Math.min(input.autoscale.max, current.mainTurnsDynamic || input.autoscale.min))
    if (now - current.mainTurnsScaledAt >= input.autoscale.cooldownMS) {
      if (queued >= input.autoscale.scaleUpQueueThreshold && next < input.autoscale.max) {
        next = Math.min(input.autoscale.max, Math.max(next + 1, running + 1))
      } else if (queued === 0 && running <= input.autoscale.scaleDownRunningThreshold && next > input.autoscale.min) {
        next = Math.max(input.autoscale.min, next - 1)
      }
      if (next !== current.mainTurnsDynamic) {
        current.mainTurnsDynamic = next
        current.mainTurnsScaledAt = now
      }
    }
    const standbyFloor = Math.min(input.autoscale.max, Math.max(input.autoscale.min, running + standbyDemand))
    if (standbyFloor > current.mainTurnsDynamic) {
      current.mainTurnsDynamic = standbyFloor
      current.mainTurnsScaledAt = now
    }
    return Math.max(input.autoscale.min, Math.min(input.autoscale.max, current.mainTurnsDynamic))
  }

  function resolveSteerFastlaneConcurrency(
    current: State,
    input: {
      profile: SchedulerProfile
      laneOverrides?: Partial<Record<Lane, number>>
      autoscale: {
        enabled: boolean
        min: number
        max: number
        scaleUpQueueThreshold: number
        scaleDownRunningThreshold: number
        cooldownMS: number
        steerEnabled: boolean
        steerMin: number
        steerMax: number
        steerScaleUpQueueThreshold: number
        steerScaleDownRunningThreshold: number
        steerCooldownMS: number
      }
    },
    base: number,
  ) {
    if (!input.autoscale.enabled || !input.autoscale.steerEnabled) return base
    const now = Date.now()
    const queued = current.queues.steer_fastlane.length
    const running = current.running.steer_fastlane
    let next = Math.max(
      input.autoscale.steerMin,
      Math.min(input.autoscale.steerMax, current.steerFastlaneDynamic || input.autoscale.steerMin),
    )
    if (now - current.steerFastlaneScaledAt >= input.autoscale.steerCooldownMS) {
      if (queued >= input.autoscale.steerScaleUpQueueThreshold && next < input.autoscale.steerMax) {
        next = Math.min(input.autoscale.steerMax, Math.max(next + 1, running + 1))
      } else if (
        queued === 0 &&
        running <= input.autoscale.steerScaleDownRunningThreshold &&
        next > input.autoscale.steerMin
      ) {
        next = Math.max(input.autoscale.steerMin, next - 1)
      }
      if (next !== current.steerFastlaneDynamic) {
        current.steerFastlaneDynamic = next
        current.steerFastlaneScaledAt = now
      }
    }
    return Math.max(input.autoscale.steerMin, Math.min(input.autoscale.steerMax, current.steerFastlaneDynamic))
  }

  function concurrencyForLane(
    lane: Lane,
    input: {
      profile: SchedulerProfile
      laneOverrides?: Partial<Record<Lane, number>>
      autoscale: {
        enabled: boolean
        min: number
        max: number
        scaleUpQueueThreshold: number
        scaleDownRunningThreshold: number
        cooldownMS: number
        steerEnabled: boolean
        steerMin: number
        steerMax: number
        steerScaleUpQueueThreshold: number
        steerScaleDownRunningThreshold: number
        steerCooldownMS: number
      }
      guardrails: {
        enabled: boolean
        toolIOStarvationMS: number
        longrunStarvationMS: number
        toolIOBias: number
        longrunBias: number
      }
    },
    current: State,
  ) {
    const base = profileConcurrency(input.profile)[lane]
    const override = input.laneOverrides?.[lane]
    const laneBase = Math.max(1, override ?? base)
    if (lane === "main_turns") return resolveMainTurnConcurrency(current, input, laneBase)
    if (lane === "steer_fastlane") return resolveSteerFastlaneConcurrency(current, input, laneBase)
    return laneBase
  }

  function laneBias(lane: Lane, input: { toolIOBias: number; longrunBias: number }) {
    if (lane === "tool_io") return input.toolIOBias
    if (lane === "longrun_jobs") return input.longrunBias
    return 0
  }

  function scoreJob(job: QueueJob, input: { agingMS: number; fairnessPenalty: number; debt: number; laneBias: number }) {
    const age = Math.floor((Date.now() - job.createdAt) / input.agingMS) * 0.2
    return priorityRank[job.priority] + age + input.laneBias - input.debt * input.fairnessPenalty
  }

  function debtDecayWindowMS(input: { agingMS: number }) {
    return Math.max(1_000, Math.floor(input.agingMS / 4))
  }

  function currentRootDebt(input: { current: State; rootSessionID: string; now: number; agingMS: number }) {
    const debt = input.current.rootDebt[input.rootSessionID] ?? 0
    if (debt <= 0) return 0
    const decayWindow = debtDecayWindowMS(input)
    const lastUpdatedAt = input.current.rootDebtLastUpdatedAt[input.rootSessionID] ?? input.now
    if (lastUpdatedAt >= input.now) return debt

    const elapsed = input.now - lastUpdatedAt
    const decayedDebt = Math.max(0, debt - Math.floor(elapsed / decayWindow))
    input.current.rootDebt[input.rootSessionID] = decayedDebt
    if (decayedDebt <= 0) {
      delete input.current.rootDebt[input.rootSessionID]
      delete input.current.rootDebtLastUpdatedAt[input.rootSessionID]
      return 0
    }

    input.current.rootDebtLastUpdatedAt[input.rootSessionID] = input.now
    return decayedDebt
  }

  function oldestQueuedAge(queued: QueueJob[]) {
    if (queued.length === 0) return 0
    const oldest = queued.reduce((min, job) => Math.min(min, job.createdAt), queued[0].createdAt)
    return Date.now() - oldest
  }

  function laneStarvationThreshold(
    lane: Lane,
    input: Awaited<ReturnType<typeof loadSettings>>,
  ) {
    if (lane === "tool_io") return input.guardrails.toolIOStarvationMS
    if (lane === "longrun_jobs") return input.guardrails.longrunStarvationMS
    return undefined
  }

  function laneSaturation(input: { queued: number; running: number; concurrency: number }) {
    if (input.queued === 0 && input.running === 0) return "idle" as const
    if (input.queued > 0 && input.running >= input.concurrency) return "saturated" as const
    if (input.queued > 0) return "queued" as const
    if (input.running >= input.concurrency) return "saturated" as const
    return "open" as const
  }

  function rootKeyForJob(job: Pick<JobMeta, "rootSessionID">) {
    return normalizeRootSessionID(job)
  }

  function runningCountForRootLane(current: State, rootKey: string, lane: Lane) {
    return current.runningByRoot[lane][rootKey] ?? 0
  }

  function canDispatchRootLaneJob(current: State, job: Pick<JobMeta, "lane" | "rootSessionID">) {
    const cap = perRootLaneCaps[job.lane]
    if (!cap) return true
    return runningCountForRootLane(current, rootKeyForJob(job), job.lane) < cap
  }

  function bestInLane(input: {
    lane: Lane
    current: State
    settings: Awaited<ReturnType<typeof loadSettings>>
  }) {
    const now = Date.now()
    if (input.current.lanePaused[input.lane]) return
    const laneConcurrency = concurrencyForLane(input.lane, input.settings, input.current)
    if (input.current.running[input.lane] >= laneConcurrency) return
    let best: QueueJob | undefined
    let bestScore = -Infinity
    for (const job of input.current.queues[input.lane]) {
      if (!canDispatchRootLaneJob(input.current, job)) continue
      const rootSessionID = rootKeyForJob(job)
      const debt = currentRootDebt({
        current: input.current,
        rootSessionID,
        now,
        agingMS: input.settings.agingMS,
      })
      const score = scoreJob(job, {
        agingMS: input.settings.agingMS,
        fairnessPenalty: input.settings.fairnessPenalty,
        debt,
        laneBias: laneBias(job.lane, input.settings.guardrails),
      })
      if (score > bestScore) {
        best = job
        bestScore = score
      }
    }
    return best
  }

  function guardrailCandidate(input: {
    current: State
    settings: Awaited<ReturnType<typeof loadSettings>>
  }) {
    if (!input.settings.guardrails.enabled) return
    const candidates: Array<{ job: QueueJob; age: number }> = []
    const checks = [
      { lane: "tool_io" as const, starvationMS: input.settings.guardrails.toolIOStarvationMS },
      { lane: "longrun_jobs" as const, starvationMS: input.settings.guardrails.longrunStarvationMS },
    ]
    for (const check of checks) {
      const age = oldestQueuedAge(input.current.queues[check.lane])
      if (age < check.starvationMS) continue
      const best = bestInLane({
        lane: check.lane,
        current: input.current,
        settings: input.settings,
      })
      if (!best) continue
      candidates.push({ job: best, age })
    }
    if (candidates.length === 0) return
    candidates.sort((a, b) => b.age - a.age)
    return candidates[0].job
  }

  function findBestCandidate(input: {
    current: State
    settings: Awaited<ReturnType<typeof loadSettings>>
  }): QueueJob | undefined {
    const now = Date.now()
    const guardrail = guardrailCandidate(input)
    const limit = input.settings.rateLimits.globalPromptConcurrency
    const rejectReasons: Array<{ lane: Lane; reason: string }> = []
    if (guardrail) {
      if (guardrail.kind === "prompt" && limit > 0 && input.current.runningPrompts >= limit) {
        rejectReasons.push({ lane: guardrail.lane, reason: "rate_limited" })
      } else {
        return guardrail
      }
    }
    let best: QueueJob | undefined
    let bestScore = -Infinity
    for (const lane of laneList()) {
      if (input.current.lanePaused[lane]) {
        rejectReasons.push({ lane, reason: "lane_paused" })
        continue
      }
      const laneConcurrency = concurrencyForLane(lane, input.settings, input.current)
      if (input.current.running[lane] >= laneConcurrency) {
        rejectReasons.push({ lane, reason: `concurrency_full_${input.current.running[lane]}_${laneConcurrency}` })
        continue
      }
      for (const job of input.current.queues[lane]) {
        if (job.kind === "prompt" && limit > 0 && input.current.runningPrompts >= limit) {
          rejectReasons.push({ lane, reason: "prompt_rate_limited" })
          continue
        }
        if (!canDispatchRootLaneJob(input.current, job)) {
          rejectReasons.push({ lane, reason: `root_cap_${rootKeyForJob(job)}` })
          continue
        }

        const rootSessionID = rootKeyForJob(job)
        const debt = currentRootDebt({
          current: input.current,
          rootSessionID,
          now,
          agingMS: input.settings.agingMS,
        })
        const score = scoreJob(job, {
          agingMS: input.settings.agingMS,
          fairnessPenalty: input.settings.fairnessPenalty,
          debt,
          laneBias: laneBias(job.lane, input.settings.guardrails),
        })
        if (score > bestScore) {
          bestScore = score
          best = job
        }
      }
    }
    if (!best) {
      log.info("[findBestCandidate] no candidate found", {
        totalQueued: Object.values(input.current.queues).reduce((sum, q) => sum + q.length, 0),
        rejectReasons: rejectReasons.slice(0, 5),
        totalRejectReasons: rejectReasons.length,
      })
    }
    return best
  }

  function removeFromQueue(jobID: string) {
    const current = state()
    for (const lane of laneList()) {
      const idx = current.queues[lane].findIndex((job) => job.jobID === jobID)
      if (idx >= 0) {
        current.queues[lane].splice(idx, 1)
        return
      }
    }
  }

  function findByDedupe(current: State, key: string) {
    for (const job of current.pending) {
      if (job.dedupeKey === key) return job
    }
    for (const lane of laneList()) {
      for (const job of current.queues[lane]) {
        if (job.dedupeKey === key) return job
      }
    }
    return Object.values(current.jobs).find((job) => job.dedupeKey === key && (job.status === "queued" || job.status === "running"))
  }

  async function enqueueRecovered(current: State, raw: PendingJob, handler: ResumeHandler) {
    const job: QueueJob = {
      ...withNormalizedRootSessionID(raw),
      status: "queued",
      startedAt: undefined,
      finishedAt: undefined,
      error: undefined,
      run: () => handler(raw.resume!.payload),
    }
    current.queues[job.lane].push(job)
    current.jobs[job.jobID] = job
    await appendExecutionEvent(job, "recovered")
    return job
  }

  async function persistSnapshot() {
    const current = state()
    const pending = [...current.pending]
    const queued: PendingJob[] = []
    const running: PendingJob[] = []
    for (const lane of laneList()) {
      for (const job of current.queues[lane]) {
        if (!job.durable) continue
        queued.push({
          jobID: job.jobID,
          kind: job.kind,
          lane: job.lane,
          priority: job.priority,
          sessionID: job.sessionID,
          supervisorSessionID: job.supervisorSessionID,
          rootSessionID: normalizeRootSessionID(job),
          description: job.description,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          error: job.error,
          durable: job.durable,
          resume: job.resume,
        })
      }
    }
    for (const job of Object.values(current.jobs)) {
      if (job.status !== "running") continue
      if (!job.durable) continue
      running.push({
        jobID: job.jobID,
        kind: job.kind,
        lane: job.lane,
        priority: job.priority,
        sessionID: job.sessionID,
        supervisorSessionID: job.supervisorSessionID,
        rootSessionID: normalizeRootSessionID(job),
        description: job.description,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        error: job.error,
        durable: job.durable,
        resume: job.resume,
      })
    }
    await Filesystem.writeJson(statePath(), {
      mode: current.mode,
      profile: current.profile,
      pending,
      queued,
      running,
      runningPrompts: current.runningPrompts, // PERSIST
      time: Date.now(),
    } satisfies PersistedState)
  }

  async function publishUpdate(latest?: JobMeta, recoveryDropped?: number, recoveryRequeued?: number) {
    const snapshot = await getStatus()
    await Bus.publish(Event.Update, {
      ...snapshot,
      latest: latest
        ? {
            jobID: latest.jobID,
            kind: latest.kind,
            lane: latest.lane,
            priority: latest.priority,
            status: latest.status,
            sessionID: latest.sessionID,
            supervisorSessionID: latest.supervisorSessionID,
            description: latest.description,
          }
        : undefined,
      recoveryDropped,
      recoveryRequeued,
    })
  }

function triggerDispatch() {
    const current = state()
    if (!current.initialized) {
      log.debug("[triggerDispatch] not initialized, skipping")
      return
    }
    if (current.dispatching) {
      current.dispatchPending = true
      log.debug("[triggerDispatch] already dispatching, setting pending")
      return
    }
    current.dispatching = true
    log.info("[triggerDispatch] starting dispatch loop")
    void dispatchLoop().catch((error) => {
      log.error("scheduler dispatch failed", { error })
    })
  }

  async function dispatchLoop() {
    const current = state()
    log.info("[dispatchLoop] entered", {
      mode: current.mode,
      dispatching: current.dispatching,
      initialized: current.initialized,
    })
    if (current.mode === "vanilla") {
      log.info("[dispatchLoop] mode is vanilla, exiting")
      current.dispatching = false
      return
    }
    log.info("[dispatch] starting dispatch loop", {
      totalQueued: Object.values(current.queues).reduce((sum, q) => sum + q.length, 0),
      totalRunning: Object.values(current.running).reduce((sum, r) => sum + r, 0),
      laneDetails: Object.fromEntries(laneList().map(l => [l, { queued: current.queues[l].length, running: current.running[l] }])),
    })
    try {
      const settings = await loadSettings()
      current.profile = settings.profile

      let dispatchCount = 0
      while (true) {
      const candidate = findBestCandidate({ current, settings })
      if (!candidate) {
        if (dispatchCount === 0) {
          log.debug("[dispatch] no candidate found", {
            queues: Object.fromEntries(laneList().map(l => [l, current.queues[l].length])),
            running: current.running,
            runningPrompts: current.runningPrompts,
          })
        }
        break
      }

      log.info("[dispatch] dispatching job", {
        jobID: candidate.jobID,
        kind: candidate.kind,
        lane: candidate.lane,
        sessionID: candidate.sessionID,
        description: candidate.description?.slice(0, 50),
      })
      dispatchCount++

      removeFromQueue(candidate.jobID)
      await appendExecutionEvent(candidate, "dispatched")
      current.running[candidate.lane] += 1
      current.runningByRoot[candidate.lane][candidate.rootSessionID] =
        (current.runningByRoot[candidate.lane][candidate.rootSessionID] ?? 0) + 1
      if (candidate.kind === "prompt") current.runningPrompts += 1;
      candidate.status = "running"
      candidate.startedAt = Date.now()
      current.jobs[candidate.jobID] = candidate
      recordLaneLatest(candidate)
      await appendExecutionEvent(candidate, "running")
      await persistSnapshot()
      await publishUpdate(candidate)

      void candidate
        .run()
        .then((result) => {
          candidate.status = "completed"
          candidate.finishedAt = Date.now()
          current.running[candidate.lane] = Math.max(0, current.running[candidate.lane] - 1)
          current.runningByRoot[candidate.lane][candidate.rootSessionID] = Math.max(
            0,
            (current.runningByRoot[candidate.lane][candidate.rootSessionID] ?? 1) - 1,
          )
          if (current.runningByRoot[candidate.lane][candidate.rootSessionID] === 0) {
            delete current.runningByRoot[candidate.lane][candidate.rootSessionID]
          }
          if (candidate.kind === "prompt") current.runningPrompts = Math.max(0, current.runningPrompts - 1);
          const rootKey = rootKeyForJob(candidate)
          current.rootDebt[rootKey] = (current.rootDebt[rootKey] ?? 0) + 1
          current.rootDebtLastUpdatedAt[rootKey] = Date.now()
          recordLaneLatest(candidate)
          candidate.resolve?.(result)
          return appendExecutionEvent(candidate, "completed")
        })
        .catch((error) => {
          candidate.status = "error"
          candidate.error = error instanceof Error ? error.message : String(error)
          candidate.finishedAt = Date.now()
          current.running[candidate.lane] = Math.max(0, current.running[candidate.lane] - 1)
          current.runningByRoot[candidate.lane][candidate.rootSessionID] = Math.max(
            0,
            (current.runningByRoot[candidate.lane][candidate.rootSessionID] ?? 1) - 1,
          )
          if (current.runningByRoot[candidate.lane][candidate.rootSessionID] === 0) {
            delete current.runningByRoot[candidate.lane][candidate.rootSessionID]
          }
          if (candidate.kind === "prompt") current.runningPrompts = Math.max(0, current.runningPrompts - 1);
          const rootKey = rootKeyForJob(candidate)
          current.rootDebt[rootKey] = (current.rootDebt[rootKey] ?? 0) + 1
          current.rootDebtLastUpdatedAt[rootKey] = Date.now()
          recordLaneLatest(candidate)
          candidate.reject?.(error)
          return appendExecutionEvent(candidate, "error")
        })
        .finally(async () => {
            await persistSnapshot().catch((err) => log.error("[E_SCHED_PERSIST] failed to persist scheduler state", { error: String(err) }))
            await publishUpdate(candidate).catch((err) => log.error("[E_SCHED_PUBLISH] failed to publish scheduler update", { error: String(err) }))
            triggerDispatch()
})
      }
    } finally {
      current.dispatching = false
      if (current.dispatchPending) {
        current.dispatchPending = false
        current.dispatching = true
        void dispatchLoop().catch((error) => {
          log.error("scheduler dispatch failed", { error })
        })
      }
    }
  }

  export async function setMode(mode: Mode) {
    await ensureInitialized()
    const current = state()
    current.mode = mode
    await persistSnapshot()
    await publishUpdate()
    if (mode === "hybrid") triggerDispatch()
  }

  export async function setLanePaused(lane: Lane, paused: boolean) {
    await ensureInitialized()
    const current = state()
    current.lanePaused[lane] = paused
    await persistSnapshot()
    await publishUpdate()
    if (!paused) triggerDispatch()
  }

  export async function getStatus() {
    await ensureInitialized()
    const current = state()
    const settings = await loadSettings()
    const lanes = laneList().map((lane) => {
      const queued = current.queues[lane].length
      const running = current.running[lane]
      const concurrency = concurrencyForLane(lane, settings, current)
      const oldestQueuedAgeMS = oldestQueuedAge(current.queues[lane])
      const starvationThresholdMS = laneStarvationThreshold(lane, settings)
      return {
        lane,
        role: laneRole(lane),
        queued,
        running,
        paused: current.lanePaused[lane],
        concurrency,
        health: {
          oldestQueuedAgeMS,
          starvationThresholdMS,
          starved: starvationThresholdMS !== undefined && queued > 0 && oldestQueuedAgeMS >= starvationThresholdMS,
          saturation: laneSaturation({ queued, running, concurrency }),
        },
        latest: current.laneLatest[lane],
      }
    })
    return {
      mode: current.mode,
      profile: current.profile,
      time: Date.now(),
      queuedTotal: lanes.reduce((acc, lane) => acc + lane.queued, 0),
      runningTotal: lanes.reduce((acc, lane) => acc + lane.running, 0),
      lanes,
    }
  }

  export async function cancelSession(input: { sessionID: string; kinds?: Kind[] }) {
    await ensureInitialized()
    const current = state()
    const kinds = input.kinds ? new Set(input.kinds) : undefined
    let changed = false
    const now = Date.now()
    for (const lane of laneList()) {
      const queue = current.queues[lane]
      const keep: QueueJob[] = []
      for (const job of queue) {
        const kindMismatch = kinds && !kinds.has(job.kind)
        const sessionMismatch = job.sessionID !== input.sessionID
        if (sessionMismatch || kindMismatch) {
          keep.push(job)
          continue
        }
        changed = true
        job.status = "canceled"
        job.finishedAt = now
        job.error = `Canceled for session: ${input.sessionID}`
        recordLaneLatest(job)
        delete current.jobs[job.jobID]
        job.reject?.(new Error(job.error))
        await appendExecutionEvent(job, "canceled")
      }
      current.queues[lane] = keep
    }
    const pending: PendingJob[] = []
    for (const job of current.pending) {
      const kindMismatch = kinds && !kinds.has(job.kind)
      const sessionMismatch = job.sessionID !== input.sessionID
      if (sessionMismatch || kindMismatch) {
        pending.push(job)
        continue
      }
      changed = true
      recordLaneLatest({
        ...job,
        status: "canceled",
      })
      delete current.jobs[job.jobID]
      await appendExecutionEvent(
        {
          ...job,
          status: "canceled",
          error: `Canceled for session: ${input.sessionID}`,
        },
        "canceled",
      )
    }
    current.pending = pending
    if (!changed) return
    await persistSnapshot()
    await publishUpdate()
  }

  export async function submit<T>(input: {
    kind: Kind
    lane: Lane
    priority: Priority
    sessionID: string
    supervisorSessionID?: string
    rootSessionID?: string
    description: string
    waitForResult: boolean
    durable?: boolean
    dedupeKey?: string
    resume?: ResumeSpec
    run: () => Promise<T>
  }) {
    await ensureInitialized()
    const current = state()
    log.info("[SchedulerControl.submit] job submitted", {
      kind: input.kind,
      lane: input.lane,
      priority: input.priority,
      sessionID: input.sessionID,
      supervisorSessionID: input.supervisorSessionID,
      rootSessionID: normalizeRootSessionID(input),
      waitForResult: input.waitForResult,
      description: input.description?.slice(0, 50),
      mode: current.mode,
      currentDispatching: current.dispatching,
      laneRunning: current.running[input.lane],
      laneQueued: current.queues[input.lane].length,
    })
    if (!input.waitForResult && input.dedupeKey) {
      const existing = findByDedupe(current, input.dedupeKey)
      if (existing) {
        log.info("[SchedulerControl.submit] dedupe match found, returning existing", { jobID: existing.jobID })
        return {
          jobID: existing.jobID,
          background: true as const,
        }
      }
    }
    const jobID = Identifier.ascending("part")
    const now = Date.now()
    const job: QueueJob = {
      jobID,
      kind: input.kind,
      lane: input.lane,
      priority: input.priority,
      status: "queued",
      sessionID: input.sessionID,
      supervisorSessionID: input.supervisorSessionID,
      rootSessionID: normalizeRootSessionID(input),
      description: input.description,
      createdAt: now,
      durable: input.durable ?? !input.waitForResult,
      dedupeKey: input.dedupeKey,
      resume: input.resume,
      run: () => input.run(),
    }
    current.jobs[jobID] = job
    recordLaneLatest(job)

    if (current.mode === "vanilla") {
      await appendExecutionEvent(job, "dispatched")
      job.status = "running"
      job.startedAt = Date.now()
      recordLaneLatest(job)
      await appendExecutionEvent(job, "running")
      await publishUpdate(job)
      if (!input.waitForResult) {
        void job
          .run()
          .then(async () => {
            job.status = "completed"
            job.finishedAt = Date.now()
            recordLaneLatest(job)
            await appendExecutionEvent(job, "completed")
            await publishUpdate(job)
          })
          .catch(async (error) => {
            job.status = "error"
            job.error = error instanceof Error ? error.message : String(error)
            job.finishedAt = Date.now()
            recordLaneLatest(job)
            await appendExecutionEvent(job, "error")
            await publishUpdate(job)
          })
        return { jobID, background: true as const }
      }
      const result = await job.run()
      job.status = "completed"
      job.finishedAt = Date.now()
      recordLaneLatest(job)
      await appendExecutionEvent(job, "completed")
      await publishUpdate(job)
      return {
        jobID,
        background: false as const,
        result,
      }
    }

    if (input.waitForResult) {
      const promise = new Promise<T>((resolve, reject) => {
        job.resolve = resolve as (value: unknown) => void
        job.reject = reject
      })
      // Teardown can reject queued jobs after callers have already detached.
      // Keep a sink attached so disposal does not surface as an unhandled rejection.
      void promise.catch(() => {})
      current.queues[input.lane].push(job)
      await appendExecutionEvent(job, "queued")
      await persistSnapshot()
      await publishUpdate(job)
      triggerDispatch()
      const result = await promise
      return {
        jobID,
        background: false as const,
        result,
      }
    }

    current.queues[input.lane].push(job)
    await appendExecutionEvent(job, "queued")
    await persistSnapshot()
    await publishUpdate(job)
    triggerDispatch()
    return { jobID, background: true as const }
  }

  export function registerResumeHandler(key: string, handler: ResumeHandler) {
    resumeHandlers.set(key, handler)
    void recoverPending(key).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("No context found for instance")) {
        return
      }
      log.error("scheduler pending recovery failed", {
        key,
        error,
      })
    })
  }

  export async function yieldConcurrency<T>(sessionID: string, run: () => Promise<T>): Promise<T> {
    await ensureInitialized()
    const current = state()
    // Find the running job for this session. 
    // Usually there is only one 'loop' running per session.
    const job = Object.values(current.jobs).find((j) => j.sessionID === sessionID && j.status === "running")
    if (!job) return run()

    const lane = job.lane
    const isPrompt = job.kind === "prompt"

    // Decrement counters to allow other jobs to dispatch
    current.running[lane] = Math.max(0, current.running[lane] - 1)
    if (isPrompt) current.runningPrompts = Math.max(0, current.runningPrompts - 1)
    triggerDispatch()

    try {
      // To properly yield, we must wait for a slot to become available again
      // before we continue execution. We do this by submitting a dummy task
      // to the same lane and waiting for its turn.
      const yieldJob = await submit({
        kind: "tool_admission",
        lane: job.lane,
        priority: "urgent", // Give it high priority so it resumes as soon as a slot is free
        sessionID: job.sessionID,
        description: `yield:${job.jobID}`,
        waitForResult: true,
        run: async () => {
          // Once this runs, it means we have a slot!
          return await run()
        },
      })
      return yieldJob.result as T
    } finally {
      // We don't manually increment here because 'submit' handled the counters 
      // when it dispatched and finished our run() function.
    }
  }

  export async function hasQueuedOrRunningJobForSession(
    sessionID: string,
    options?: { kind?: z.infer<typeof Kind>; durableOnly?: boolean },
  ) {
    await ensureInitialized()
    const current = state()
    return Object.values(current.jobs).some(
      (job) =>
        job.sessionID === sessionID &&
        job.status !== "completed" &&
        job.status !== "error" &&
        job.status !== "canceled" &&
        (!options?.kind || job.kind === options.kind) &&
        (!options?.durableOnly || job.durable),
    )
  }
}
