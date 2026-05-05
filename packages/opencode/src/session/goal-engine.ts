// Goal Decomposition Engine — automatically breaks vague user requests
// into structured goal trees with measurable success criteria. Maps goals
// to specific agent roles and schedules them into the SessionWorkGraph.

import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { SessionWorkGraph } from "@/session/workgraph"

const log = Log.create({ service: "session.goal-engine" })

export type GoalNode = {
  id: string
  sessionID: string
  parentID?: string
  description: string
  criteria: string[]
  role: string
  estimatedEffort: "low" | "medium" | "high"
  status: "pending" | "active" | "completed" | "failed"
}

export type GoalTree = {
  id: string
  sessionID: string
  rootGoal: string
  nodes: GoalNode[]
  createdAt: number
}

const trees = Instance.state(() => new Map<string, GoalTree>())

// ---------------------------------------------------------------------------
// Decomposition
// ---------------------------------------------------------------------------

async function decompose(input: {
  sessionID: string
  taskContext: string
}): Promise<GoalTree | undefined> {
  const { generateText } = await import("ai")
  const { Provider } = await import("@/provider/provider")

  // Generate goal tree
  const system = `You are the Goal Decomposition Engine of Project Mecha.
Analyze the following user task and break it down into a dependency-ordered tree of sub-goals.

Rules:
1. Extract 2 to 3 sub-goals maximum
2. Provide measurable success criteria (e.g., "Tests pass", "File created")
3. Estimate effort (low/medium/high)

Output JSON matching this EXACT schema:
{
  "nodes": [
    {
      "id": "goal_1",
      "parentID": null,
      "description": "what needs to be done",
      "criteria": ["how to verify it"],
      "estimatedEffort": "low|medium|high"
    }
  ]
}`

  log.debug("goal.decompose_request")

  const modelRef = Provider.parseModel("anthropic:claude-3-7-sonnet-20250219")
  const providerModel = await Provider.getModel(modelRef.providerID, modelRef.modelID)
  const languageModel = await Provider.getLanguage(providerModel)

  const response = await generateText({
    model: languageModel,
    system,
    messages: [{ role: "user", content: input.taskContext }],
  }).catch((err) => {
    log.error("goal.decompose_error", { error: err })
    return undefined
  })

  if (!response?.text) return undefined

  try {
    const match = response.text.match(/\{[\s\S]*\}/)
    if (!match) return undefined

    const parsed = JSON.parse(match[0]) as { nodes: [] }
    if (!parsed.nodes || !Array.isArray(parsed.nodes)) return undefined

    const treeID = Identifier.ascending("part")

    const nodes: GoalNode[] = parsed.nodes.map((n: any) => {
      // Auto-classify role based on descriptions/criteria
      let role = "implementer"
      const txt = (n.description + " " + (n.criteria ?? []).join(" ")).toLowerCase()
      if (txt.includes("test")) role = "tester"
      else if (txt.includes("debug") || txt.includes("fix")) role = "debugger"
      else if (txt.includes("read") || txt.includes("explore")) role = "researcher"
      else if (txt.includes("design") || txt.includes("architecture")) role = "architect"

      return {
        id: `${treeID}-${n.id}`,
        sessionID: input.sessionID,
        parentID: n.parentID ? `${treeID}-${n.parentID}` : undefined,
        description: n.description ?? "Unknown Goal",
        criteria: n.criteria ?? [],
        role,
        estimatedEffort: n.estimatedEffort ?? "medium",
        status: "pending",
      }
    })

    const tree: GoalTree = {
      id: treeID,
      sessionID: input.sessionID,
      rootGoal: input.taskContext.slice(0, 100),
      nodes,
      createdAt: Date.now(),
    }

    trees().set(tree.id, tree)

    log.info("goal.decomposed", {
      treeID: tree.id,
      nodes: nodes.length,
      roles: [...new Set(nodes.map(n => n.role))],
    })

    return tree
  } catch (err) {
    log.error("goal.parse_failed", { error: err })
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

async function schedule(treeID: string): Promise<boolean> {
  const tree = trees().get(treeID)
  if (!tree) throw new Error(`Tree ${treeID} not found`)

  try {
    // Record the root goal once, then project each decomposition node into a
    // workgraph lane so the tree is visible without colliding active objectives.
    await SessionWorkGraph.recordObjective({
      rootSessionID: tree.sessionID,
      sessionID: tree.sessionID,
      title: tree.rootGoal,
      constraintsSummary: `goal tree ${tree.id}`,
      status: "active",
    })

    for (const node of tree.nodes) {
      await SessionWorkGraph.recordLane({
        rootSessionID: tree.sessionID,
        sessionID: node.sessionID,
        laneID: node.id,
        title: node.description,
        status:
          node.status === "completed"
            ? "completed"
            : node.status === "failed"
              ? "error"
              : node.status === "active"
                ? "running"
                : "queued",
        discipline: node.role,
        priority: node.estimatedEffort,
        subagentType: node.role,
      })
    }

    log.info("goal.scheduled", { treeID, nodes: tree.nodes.length })
    return true
  } catch (err) {
    log.error("goal.schedule_failed", { error: err })
    return false
  }
}

export const GoalEngine = {
  decompose,
  schedule,
} as const
