// Tool Gap Detection — observes patterns where the agent repeatedly fails
// or uses awkward multi-step workarounds, and flags them as "tool gaps"
// that could be addressed by creating new compound actions or tools.

import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool.gap" })

export type GapType =
  | "repeated_failure"    // Same tool fails > N times on similar inputs
  | "multi_step_workaround" // Agent uses 3+ tools for what should be 1
  | "missing_capability"  // Agent explicitly says "I can't do X"
  | "slow_path"           // Agent takes > N steps for a common pattern

export type Gap = {
  id: string
  type: GapType
  description: string
  tools: string[]
  frequency: number
  examples: GapExample[]
  suggestion?: string
  at: number
}

export type GapExample = {
  sessionID: string
  tools: string[]
  error?: string
  at: number
}

// Per-project gap tracking
const gaps = Instance.state(() => new Map<string, Gap>())

// Sliding window of recent tool calls for pattern detection
const history = Instance.state(() => new Map<string, ToolCall[]>())

type ToolCall = {
  sessionID: string
  tool: string
  args: Record<string, unknown>
  success: boolean
  error?: string
  duration: number
  at: number
}

// ---------------------------------------------------------------------------
// Observation: record tool calls
// ---------------------------------------------------------------------------

function observe(input: {
  sessionID: string
  tool: string
  args: Record<string, unknown>
  success: boolean
  error?: string
  duration: number
}) {
  const calls = history()
  const session = calls.get(input.sessionID) ?? []
  session.push({ ...input, at: Date.now() })

  // Keep last 50 calls per session
  if (session.length > 50) session.splice(0, session.length - 50)
  calls.set(input.sessionID, session)

  // Run detection after each call
  detect(input.sessionID)
}

// ---------------------------------------------------------------------------
// Detection heuristics
// ---------------------------------------------------------------------------

function detect(sessionID: string) {
  const calls = history().get(sessionID)
  if (!calls || calls.length < 3) return

  detectRepeatedFailures(sessionID, calls)
  detectWorkarounds(sessionID, calls)
  detectSlowPaths(sessionID, calls)
}

function detectRepeatedFailures(sessionID: string, calls: ToolCall[]) {
  // Group failures by tool name
  const failures = new Map<string, ToolCall[]>()
  for (const call of calls) {
    if (!call.success) {
      const arr = failures.get(call.tool) ?? []
      arr.push(call)
      failures.set(call.tool, arr)
    }
  }

  for (const [tool, fails] of failures) {
    if (fails.length < 3) continue

    const key = `repeated_failure:${tool}`
    const existing = gaps().get(key)
    if (existing) {
      existing.frequency = fails.length
      existing.examples = fails.slice(-3).map((f) => ({
        sessionID,
        tools: [f.tool],
        error: f.error,
        at: f.at,
      }))
      continue
    }

    gaps().set(key, {
      id: Identifier.ascending("part"),
      type: "repeated_failure",
      description: `Tool "${tool}" has failed ${fails.length} times in this session`,
      tools: [tool],
      frequency: fails.length,
      examples: fails.slice(-3).map((f) => ({
        sessionID,
        tools: [f.tool],
        error: f.error,
        at: f.at,
      })),
      suggestion: `Consider creating a more robust version of "${tool}" or adding pre-validation`,
      at: Date.now(),
    })

    log.debug("gap.detected", { type: "repeated_failure", tool, count: fails.length })
  }
}

function detectWorkarounds(sessionID: string, calls: ToolCall[]) {
  // Look for sequences where 3+ different tools are used in quick succession
  // on the same file — suggests a compound action is needed
  const window = 5
  for (let i = 0; i <= calls.length - window; i++) {
    const slice = calls.slice(i, i + window)
    const files = new Set<string>()
    const tools = new Set<string>()

    for (const call of slice) {
      tools.add(call.tool)
      const file = (call.args.file ?? call.args.path ?? "") as string
      if (file) files.add(file)
    }

    if (tools.size >= 3 && files.size === 1) {
      const file = [...files][0]
      const key = `workaround:${[...tools].sort().join(",")}`

      if (gaps().has(key)) {
        gaps().get(key)!.frequency += 1
        continue
      }

      gaps().set(key, {
        id: Identifier.ascending("part"),
        type: "multi_step_workaround",
        description: `${tools.size} different tools used on "${file}" — potential compound action`,
        tools: [...tools],
        frequency: 1,
        examples: [{
          sessionID,
          tools: slice.map((c) => c.tool),
          at: slice[0].at,
        }],
        suggestion: `Consider creating a compound action recipe for: ${[...tools].join(" → ")}`,
        at: Date.now(),
      })

      log.debug("gap.detected", { type: "multi_step_workaround", tools: [...tools], file })
    }
  }
}

function detectSlowPaths(sessionID: string, calls: ToolCall[]) {
  // If the same tool sequence appears across multiple sessions, it's a pattern
  const recent = calls.slice(-10)
  const toolSeq = recent.map((c) => c.tool).join(",")

  // Simple: if > 8 tool calls in the last 10 are read operations, flag as slow
  const reads = recent.filter((c) =>
    c.tool.includes("read") || c.tool.includes("search") || c.tool.includes("grep"),
  )

  if (reads.length >= 8) {
    const key = "slow_path:excessive_reads"
    if (!gaps().has(key)) {
      gaps().set(key, {
        id: Identifier.ascending("part"),
        type: "slow_path",
        description: "Agent is spending most of its turns on read/search operations",
        tools: reads.map((r) => r.tool),
        frequency: 1,
        examples: [{
          sessionID,
          tools: reads.map((r) => r.tool),
          at: reads[0].at,
        }],
        suggestion: "Consider using structural-read outline mode or code-graph queries instead",
        at: Date.now(),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

function list(): Gap[] {
  return [...gaps().values()].sort((a, b) => b.frequency - a.frequency)
}

function get(id: string): Gap | undefined {
  for (const gap of gaps().values()) {
    if (gap.id === id) return gap
  }
  return undefined
}

function clear() {
  gaps().clear()
  history().clear()
}

export const GapDetector = {
  observe,
  list,
  get,
  clear,
} as const
