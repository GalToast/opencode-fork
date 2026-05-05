import { Tool } from "./tool"
import z from "zod"
import { HarnessBlackboard } from "../harness/blackboard"

type BlackBoardKey = string
type BlackboardValue = unknown

const blackboardSetParameters = z.object({
  key: z.string().describe("The key to set (e.g. 'found_vulnerability', 'main_entry_point')"),
  value: z.any().describe("The value to store (can be a string, number, or JSON object)"),
})
const blackboardGetParameters = z.object({
  key: z.string().optional().describe("The specific key to retrieve. If omitted, returns the entire blackboard state for this session."),
})
const blackboardAppendParameters = z.object({
  key: z.string().describe("The array key to append to."),
  value: z.any().describe("The value to append."),
})
const blackboardIncrementParameters = z.object({
  key: z.string().describe("The numeric key to increment."),
  delta: z.number().default(1).describe("How much to increment the value by."),
})
const blackboardCompareAndSwapParameters = z.object({
  key: z.string().describe("The key to update atomically."),
  expectedValue: z.any().describe("The value you expect the key to currently hold."),
  value: z.any().describe("The new value to store if the expectation matches."),
})
const blackboardDeleteParameters = z.object({
  key: z.string().describe("The key to delete from the blackboard."),
})
const blackboardClearParameters = z.object({})

type BlackboardSetParameters = z.infer<typeof blackboardSetParameters>
type BlackboardGetParameters = z.infer<typeof blackboardGetParameters>
type BlackboardAppendParameters = z.infer<typeof blackboardAppendParameters>
type BlackboardIncrementParameters = z.infer<typeof blackboardIncrementParameters>
type BlackboardCompareAndSwapParameters = z.infer<typeof blackboardCompareAndSwapParameters>
type BlackboardDeleteParameters = z.infer<typeof blackboardDeleteParameters>
type BlackboardClearParameters = z.infer<typeof blackboardClearParameters>

type BlackboardSetMetadata = {
  key: BlackBoardKey
}
type BlackboardGetMetadata = {
  key?: BlackBoardKey
  value?: BlackboardValue
  state?: Record<BlackBoardKey, BlackboardValue>
}
type BlackboardAppendMetadata = {
  key: BlackBoardKey
  value: BlackboardValue
}
type BlackboardIncrementMetadata = {
  key: BlackBoardKey
  value: number
}
type BlackboardCompareAndSwapMetadata = {
  key: BlackBoardKey
  success: boolean
  currentValue?: BlackboardValue
}
type BlackboardDeleteMetadata = {
  key: BlackBoardKey
  existed: boolean
  previousValue?: BlackboardValue
}
type BlackboardClearMetadata = {
  cleared: boolean
}

const blackboardHighLevelParameters = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("claim_ownership"),
    resource: z.string().describe("The shared resource, seam, or responsibility to claim."),
    owner: z.string().optional().describe("Optional human-readable owner label. Defaults to the current agent."),
    note: z.string().optional().describe("Optional note describing the claim or current focus."),
  }),
  z.object({
    action: z.literal("publish_finding"),
    topic: z.string().describe("A short topic or family name for the finding."),
    summary: z.string().describe("Compact finding summary for other lanes."),
    severity: z.enum(["low", "medium", "high"]).default("medium").describe("How important or urgent the finding is."),
    evidence: z.array(z.string()).optional().describe("Optional evidence bullets, file paths, URLs, or artifacts."),
    details: z.any().optional().describe("Optional structured payload with extra context."),
  }),
  z.object({
    action: z.literal("share_blocker"),
    resource: z.string().describe("The blocked seam, resource, or work item."),
    summary: z.string().describe("What is blocked and why."),
    nextStep: z.string().optional().describe("Best next move to unblock the work."),
    owner: z.string().optional().describe("Optional owner label. Defaults to the current agent."),
    severity: z.enum(["low", "medium", "high"]).default("high").describe("How urgent the blocker is."),
  }),
  z.object({
    action: z.literal("read"),
    key: z.string().optional().describe("Optional exact blackboard key. Omit to read the whole board."),
  }),
])

type BlackboardHighLevelParameters = z.infer<typeof blackboardHighLevelParameters>

type BlackboardHighLevelMetadata = {
  action: string
  key?: BlackBoardKey
  success?: boolean
  state?: Record<BlackBoardKey, BlackboardValue>
  value?: BlackboardValue
}

function resolveRootSessionID(sessionID: string) {
  return HarnessBlackboard.getRootID(sessionID)
}

function boardTimestamp() {
  return new Date().toISOString()
}

function ownerLabel(ctx: Tool.Context, explicit?: string) {
  return explicit ?? ctx.agent
}

function ownershipKey(resource: string) {
  return `ownership:${resource}`
}

function blockerKey(resource: string) {
  return `blocker:${resource}`
}

export const BlackboardTool = Tool.define<typeof blackboardHighLevelParameters, BlackboardHighLevelMetadata>("blackboard", {
  description: [
    "High-level shared swarm blackboard for common coordination moves.",
    "",
    "Prefer this tool for normal cross-lane coordination patterns:",
    "- claim ownership of a seam or resource",
    "- publish a compact finding for other agents",
    "- share a blocker with the best next step",
    "- read the current blackboard state",
    "",
    "Use the lower-level `blackboard_*` tools only when you specifically need atomic updates, counters, appends, or other raw state primitives.",
  ].join("\n"),
  parameters: blackboardHighLevelParameters,
  async execute(params: BlackboardHighLevelParameters, ctx: Tool.Context<BlackboardHighLevelMetadata>) {
    const root = resolveRootSessionID(ctx.sessionID)

    if (params.action === "read") {
      if (params.key) {
        const value = HarnessBlackboard.get(root, params.key)
        return {
          title: `Blackboard Read: ${params.key}`,
          output: value !== undefined ? JSON.stringify(value, null, 2) : `Key '${params.key}' not found on blackboard.`,
          metadata: { action: params.action, key: params.key, value },
        }
      }
      const state = HarnessBlackboard.getAll(root)
      return {
        title: "Blackboard State",
        output: JSON.stringify(state, null, 2),
        metadata: { action: params.action, state },
      }
    }

    if (params.action === "claim_ownership") {
      const key = ownershipKey(params.resource)
      const current = HarnessBlackboard.get<Record<string, unknown> | undefined>(root, key)
      const next = {
        resource: params.resource,
        owner: ownerLabel(ctx, params.owner),
        ownerAgent: ctx.agent,
        ownerSessionID: ctx.sessionID,
        note: params.note,
        updatedAt: boardTimestamp(),
      }
      if (current && current.ownerSessionID !== ctx.sessionID) {
        return {
          title: `Blackboard Claim: ${params.resource}`,
          output: `Resource '${params.resource}' is already claimed by ${String(current.owner ?? current.ownerSessionID ?? "another lane")}.`,
          metadata: { action: params.action, key, success: false, value: current },
        }
      }
      const action = params.action
      await HarnessBlackboard.set(root, key, next, ctx.sessionID)
      return {
        title: `Blackboard Claim: ${params.resource}`,
        output: `Claimed '${params.resource}' for ${next.owner}.`,
        metadata: { action, key, success: true, value: next },
      }
    }

    if (params.action === "publish_finding") {
      const entry = {
        topic: params.topic,
        summary: params.summary,
        severity: params.severity,
        evidence: params.evidence ?? [],
        details: params.details,
        agent: ctx.agent,
        sessionID: ctx.sessionID,
        createdAt: boardTimestamp(),
      }
      const action = params.action
      const findings = await HarnessBlackboard.append(root, "findings", entry, ctx.sessionID)
      return {
        title: `Blackboard Finding: ${params.topic}`,
        output: `Published ${params.severity} finding for '${params.topic}'. Total findings: ${Array.isArray(findings) ? findings.length : 1}.`,
        metadata: { action, key: "findings", value: entry },
      }
    }

    if (params.action === "share_blocker") {
      const key = blockerKey(params.resource)
      const entry = {
        resource: params.resource,
        summary: params.summary,
        nextStep: params.nextStep,
        severity: params.severity,
        owner: ownerLabel(ctx, params.owner),
        agent: ctx.agent,
        sessionID: ctx.sessionID,
        updatedAt: boardTimestamp(),
      }
      const action = params.action
      await HarnessBlackboard.set(root, key, entry, ctx.sessionID)
      return {
        title: `Blackboard Blocker: ${params.resource}`,
        output: `Shared ${params.severity} blocker for '${params.resource}'.`,
        metadata: { action, key, success: true, value: entry },
      }
    }

    throw new Error(`Unsupported blackboard action: ${String((params as { action?: unknown }).action)}`)
  },
})

export const BlackboardSetTool = Tool.define("blackboard_set", {
  description:
    "Set a value on the shared swarm blackboard. This value will be instantly available to all other sub-agents in the same session, reducing the need to pass large context logs back and forth. Use this for high-signal discoveries or shared state.",
  parameters: blackboardSetParameters,
  async execute(params: BlackboardSetParameters, ctx: Tool.Context<BlackboardSetMetadata>) {
    const root = resolveRootSessionID(ctx.sessionID)
    await HarnessBlackboard.set(root, params.key, params.value, ctx.sessionID)

    return {
      title: `Blackboard Set: ${params.key}`,
      output: `Successfully set blackboard key '${params.key}'.`,
      metadata: { key: params.key },
    }
  },
})

export const BlackboardGetTool = Tool.define<typeof blackboardGetParameters, BlackboardGetMetadata>("blackboard_get", {
  description:
    "Retrieve a value from the shared swarm blackboard. This allows you to access insights found by other agents in your swarm without them being in your primary conversation history.",
  parameters: blackboardGetParameters,
  async execute(params: BlackboardGetParameters, ctx: Tool.Context<BlackboardGetMetadata>) {
    const root = resolveRootSessionID(ctx.sessionID)
    if (params.key) {
      const value = HarnessBlackboard.get(root, params.key)
      return {
        title: `Blackboard Get: ${params.key}`,
        output: value !== undefined ? JSON.stringify(value, null, 2) : `Key '${params.key}' not found on blackboard.`,
        metadata: { key: params.key, value },
      }
    }

    const state = HarnessBlackboard.getAll(root)
    return {
      title: "Blackboard State",
      output: JSON.stringify(state, null, 2),
      metadata: { state },
    }
  },
})

export const BlackboardAppendTool = Tool.define("blackboard_append", {
  description:
    "Append an item to an array stored on the shared swarm blackboard. Use this to accumulate findings, evidence, URLs, or blockers without rewriting the whole list.",
  parameters: blackboardAppendParameters,
  async execute(params: BlackboardAppendParameters, ctx: Tool.Context<BlackboardAppendMetadata>) {
    const root = resolveRootSessionID(ctx.sessionID)
    const value = await HarnessBlackboard.append(root, params.key, params.value, ctx.sessionID)
    return {
      title: `Blackboard Append: ${params.key}`,
      output: JSON.stringify(value, null, 2),
      metadata: { key: params.key, value },
    }
  },
})

export const BlackboardIncrementTool = Tool.define("blackboard_increment", {
  description:
    "Increment a numeric value on the shared swarm blackboard. Use this for counters like completed subtasks, retries, votes, or discovered issues.",
  parameters: blackboardIncrementParameters,
  async execute(params: BlackboardIncrementParameters, ctx: Tool.Context<BlackboardIncrementMetadata>) {
    const root = resolveRootSessionID(ctx.sessionID)
    const value = await HarnessBlackboard.increment(root, params.key, params.delta, ctx.sessionID)
    return {
      title: `Blackboard Increment: ${params.key}`,
      output: JSON.stringify(value, null, 2),
      metadata: { key: params.key, value },
    }
  },
})

export const BlackboardCompareAndSwapTool = Tool.define("blackboard_compare_and_swap", {
  description:
    "Atomically replace a shared blackboard value only if it still matches the expected value. Use this to coordinate ownership, status transitions, and race-sensitive shared state.",
  parameters: blackboardCompareAndSwapParameters,
  async execute(params: BlackboardCompareAndSwapParameters, ctx: Tool.Context<BlackboardCompareAndSwapMetadata>) {
    const root = resolveRootSessionID(ctx.sessionID)
    const result = await HarnessBlackboard.compareAndSwap(
      root,
      params.key,
      params.expectedValue,
      params.value,
      ctx.sessionID,
    )
    return {
      title: `Blackboard Compare-and-Swap: ${params.key}`,
      output: JSON.stringify(result, null, 2),
      metadata: { key: params.key, ...result },
    }
  },
})

export const BlackboardDeleteTool = Tool.define("blackboard_delete", {
  description:
    "Delete a single key from the shared swarm blackboard when it is stale, superseded, or no longer safe to keep around.",
  parameters: blackboardDeleteParameters,
  async execute(params: BlackboardDeleteParameters, ctx: Tool.Context<BlackboardDeleteMetadata>) {
    const root = resolveRootSessionID(ctx.sessionID)
    const result = await HarnessBlackboard.deleteKey(root, params.key, ctx.sessionID)
    return {
      title: `Blackboard Delete: ${params.key}`,
      output: result.existed
        ? `Deleted blackboard key '${params.key}'.`
        : `Blackboard key '${params.key}' was already absent.`,
      metadata: { key: params.key, ...result },
    }
  },
})

export const BlackboardClearTool = Tool.define("blackboard_clear", {
  description:
    "Clear the shared swarm blackboard for the current root session. Use this when shared state is stale, contaminated, or no longer relevant.",
  parameters: blackboardClearParameters,
  async execute(_params: BlackboardClearParameters, ctx: Tool.Context<BlackboardClearMetadata>) {
    const root = resolveRootSessionID(ctx.sessionID)
    HarnessBlackboard.clear(root)
    return {
      title: "Blackboard Clear",
      output: "Cleared the shared blackboard for this session family.",
      metadata: { cleared: true },
    }
  },
})
