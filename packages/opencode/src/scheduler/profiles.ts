// Adaptive Scheduler Profiles — dynamically adjusts scheduling parameters
// (concurrency, priority weights, timeout, retry) based on the type of
// work being performed. The scheduler observes task outcomes and tunes
// profiles over time.

import { Log } from "@/util/log"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "scheduler.profiles" })

export type ProfileName =
  | "exploration"   // reading/searching — high parallelism, short timeouts
  | "mutation"      // editing files — low parallelism, long timeouts
  | "verification"  // running tests/diagnostics — medium parallelism
  | "generation"    // LLM generation — single thread, max timeout
  | "compound"      // multi-step compound actions
  | "default"

export type Profile = {
  name: ProfileName
  concurrency: number
  timeout: number
  retries: number
  priority: number
  backoff: "linear" | "exponential" | "none"
  description: string
}

const PROFILES: Record<ProfileName, Profile> = {
  exploration: {
    name: "exploration",
    concurrency: 8,
    timeout: 10_000,
    retries: 1,
    priority: 2,
    backoff: "none",
    description: "High parallelism for reading, searching, and browsing",
  },
  mutation: {
    name: "mutation",
    concurrency: 1,
    timeout: 30_000,
    retries: 2,
    priority: 5,
    backoff: "exponential",
    description: "Sequential execution for file edits with careful retry",
  },
  verification: {
    name: "verification",
    concurrency: 4,
    timeout: 60_000,
    retries: 1,
    priority: 4,
    backoff: "linear",
    description: "Medium parallelism for test execution and diagnostics",
  },
  generation: {
    name: "generation",
    concurrency: 1,
    timeout: 120_000,
    retries: 3,
    priority: 3,
    backoff: "exponential",
    description: "Single-threaded LLM generation with aggressive retry",
  },
  compound: {
    name: "compound",
    concurrency: 1,
    timeout: 60_000,
    retries: 0,
    priority: 6,
    backoff: "none",
    description: "Sequential compound action execution with rollback",
  },
  default: {
    name: "default",
    concurrency: 4,
    timeout: 30_000,
    retries: 1,
    priority: 3,
    backoff: "linear",
    description: "Balanced defaults",
  },
}

// Telemetry — track profile performance over time
const telemetry = Instance.state(() => new Map<ProfileName, ProfileStats>())

type ProfileStats = {
  executions: number
  successes: number
  failures: number
  avg: number
  p95: number
  durations: number[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function get(name: ProfileName): Profile {
  return { ...(PROFILES[name] ?? PROFILES.default) }
}

/** Classify a tool call into a profile based on its name. */
function classify(tool: string): ProfileName {
  const mutations = ["edit", "write", "apply_patch", "multi_edit", "create"]
  const exploration = ["read", "search", "glob", "grep", "list", "find", "dependency_explorer"]
  const verification = ["shell", "test", "diagnostics", "lint"]
  const generation = ["task", "subagent"]
  const compound = ["compound"]

  if (mutations.some((m) => tool.includes(m))) return "mutation"
  if (exploration.some((e) => tool.includes(e))) return "exploration"
  if (verification.some((v) => tool.includes(v))) return "verification"
  if (generation.some((g) => tool.includes(g))) return "generation"
  if (compound.some((c) => tool.includes(c))) return "compound"
  return "default"
}

/** Record the outcome of a tool execution for profile tuning. */
function record(input: {
  profile: ProfileName
  duration: number
  success: boolean
}) {
  const map = telemetry()
  const existing = map.get(input.profile) ?? {
    executions: 0,
    successes: 0,
    failures: 0,
    avg: 0,
    p95: 0,
    durations: [],
  }

  existing.executions += 1
  if (input.success) existing.successes += 1
  if (!input.success) existing.failures += 1
  existing.durations.push(input.duration)

  // Keep only last 100 durations
  if (existing.durations.length > 100) {
    existing.durations = existing.durations.slice(-100)
  }

  // Recalculate stats
  const sorted = [...existing.durations].sort((a, b) => a - b)
  existing.avg = sorted.reduce((a, b) => a + b, 0) / sorted.length
  existing.p95 = sorted[Math.floor(sorted.length * 0.95)] ?? existing.avg

  map.set(input.profile, existing)

  // Auto-tune: if failure rate is high, increase retries
  const rate = existing.failures / Math.max(existing.executions, 1)
  if (rate > 0.3 && existing.executions > 10) {
    const profile = PROFILES[input.profile]
    if (profile && profile.retries < 5) {
      profile.retries += 1
      log.debug("profile.auto-tuned", {
        profile: input.profile,
        retries: profile.retries,
        rate,
      })
    }
  }

  // Auto-tune: if p95 > timeout * 0.8, increase timeout
  const profile = PROFILES[input.profile]
  if (profile && existing.p95 > profile.timeout * 0.8 && existing.executions > 20) {
    profile.timeout = Math.round(profile.timeout * 1.25)
    log.debug("profile.timeout-tuned", {
      profile: input.profile,
      timeout: profile.timeout,
      p95: existing.p95,
    })
  }
}

function stats(): Map<ProfileName, ProfileStats> {
  return new Map(telemetry())
}

export const SchedulerProfiles = {
  get,
  classify,
  record,
  stats,
  PROFILES,
} as const
