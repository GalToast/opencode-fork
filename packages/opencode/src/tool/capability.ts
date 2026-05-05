import z from "zod"
import { Tool } from "./tool"
import { CapabilityRuntime } from "@/capability/runtime"
import { MCP } from "@/mcp"

async function inspectMcpSurface(sessionID: string, turnID?: string) {
  const state = CapabilityRuntime.snapshot(sessionID, turnID)
  let status = await MCP.status().catch(() => ({} as Record<string, { status?: string }>))
  const connectedClients = Object.entries(status)
    .filter(([, value]) => value?.status === "connected")
    .map(([clientName]) => clientName)
    .sort()
  const knownMcpClientIDs = state.knownMcpClientIDs
  const requestedVisibleClients = CapabilityRuntime.visibleMcpClientIDs(sessionID)
  const requestedBrowserClients =
    requestedVisibleClients === undefined
      ? []
      : requestedVisibleClients.filter((clientName) => knownMcpClientIDs.includes(clientName))
  const disconnectedBrowserClients = requestedBrowserClients.filter((clientName) => status[clientName]?.status !== "connected")
  if (disconnectedBrowserClients.length > 0) {
    await Promise.all(disconnectedBrowserClients.map((clientName) => MCP.connect(clientName).catch(() => undefined)))
    status = await MCP.status().catch(() => status)
  }
  const refreshedConnectedClients = Object.entries(status)
    .filter(([, value]) => value?.status === "connected")
    .map(([clientName]) => clientName)
    .sort()
  const browserClients = refreshedConnectedClients.filter((clientName) => knownMcpClientIDs.includes(clientName))
  const inspectClients =
    requestedVisibleClients === undefined
      ? refreshedConnectedClients
      : [...new Set([...browserClients, ...requestedVisibleClients])].sort()

  const sampleMcpTools: Record<string, string[]> = {}
  const allTools = await MCP.tools().catch(() => ({} as Record<string, { client?: string; name: string }>))
  for (const clientName of inspectClients) {
    const clientTools = Object.values(allTools)
      .filter((t) => t.client === clientName)
      .map((t) => t.name)
      .sort()
    if (clientTools.length > 0) sampleMcpTools[clientName] = clientTools.slice(0, 6)
  }

  return {
    connectedClients: refreshedConnectedClients,
    browserClients,
    requestedVisibleClients: requestedVisibleClients ?? connectedClients,
    sampleMcpTools,
  }
}

async function connectRequestedMcpTargets(
  action: "enable" | "disable" | "list" | "reset",
  targets: string[] | undefined,
  turnID: string | undefined,
  sessionID: string,
) {
  if (action !== "enable") return undefined
  const state = CapabilityRuntime.snapshot(sessionID, turnID)
  const targetSet = new Set(targets ?? [])
  const status = await MCP.status().catch(() => ({} as Record<string, { status?: string; error?: string }>))
  const configuredClients = Object.keys(status).sort()
  const shouldConnectAll = targetSet.has("mcp") || targetSet.has("all")
  const requestedClients = shouldConnectAll
    ? configuredClients
    : (targets ?? []).filter((target) => state.knownMcpClientIDs.includes(target))

  if (requestedClients.length === 0) return undefined

  const connectionResults: Record<string, string> = {}
  await Promise.all(
    [...new Set(requestedClients)].map(async (name) => {
      const current = status[name]
      if (current?.status === "connected") {
        connectionResults[name] = "connected"
        return
      }
      await MCP.connect(name).catch((error) => {
        connectionResults[name] = error instanceof Error ? error.message : String(error)
      })
      const refreshed = await MCP.status().catch(() => ({} as Record<string, { status?: string; error?: string }>))
      const next = refreshed[name]
      connectionResults[name] =
        next?.status === "failed" ? `failed: ${next.error ?? "unknown error"}` : next?.status ?? "unknown"
    }),
  )

  return connectionResults
}

function formatMcpInspection(inspection: Awaited<ReturnType<typeof inspectMcpSurface>>) {
  const lines = ["MCP inspection:"]
  const accessMode =
    inspection.requestedVisibleClients.length === 0
      ? "hidden"
      : inspection.connectedClients.length === inspection.requestedVisibleClients.length
        ? "client-targeted"
        : "client-targeted (some clients still disconnected)"
  lines.push(`- MCP access mode: ${accessMode}`)
  lines.push(
    `- connected clients: ${inspection.connectedClients.length > 0 ? inspection.connectedClients.join(", ") : "none"}`,
  )
  lines.push(
    `- browser client targets: ${inspection.browserClients.length > 0 ? inspection.browserClients.join(", ") : "none"}`,
  )
  lines.push(
    `- visible or inspectable clients: ${
      inspection.requestedVisibleClients.length > 0 ? inspection.requestedVisibleClients.join(", ") : "none"
    }`,
  )
  if (Object.keys(inspection.sampleMcpTools).length === 0) {
    lines.push("- sample MCP tools: none")
    return lines.join("\n")
  }
  lines.push("- sample MCP tools:")
  for (const [clientName, ids] of Object.entries(inspection.sampleMcpTools).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  - ${clientName}: ${ids.join(", ")}`)
  }
  return lines.join("\n")
}

export const CapabilityTool = Tool.define("capability", {
  description: [
    "Inspect or expand the current capability surface for this session.",
    "",
    "Foreground turns start with a lean default tool shell for faster responses.",
    "Use this tool when you want to enable more capabilities for the next model step.",
    "This tool is opt-in and is most useful when you explicitly want to expose non-default tools or prompt-context families for later turns.",
    "Use `playwright`, `chrome-devtools`, or `mcp` here to expose browser MCP tools and the broader MCP catalog on demand.",
    "The core shell already includes task delegation, direct skill loading, and websearch, so you do not need to enable a family just to launch a subagent, load a skill, or do web research.",
    "Changes persist for the session by default until you explicitly disable or reset them.",
    "Use scope=turn only when you want a temporary expansion that expires after the current turn.",
    "For substantial work, prefer the durable coordination surfaces: TodoWrite for smaller scoped checklists, tracker DAG for larger dependency-aware work, task for delegation, blackboard for compact shared lane memory, skills for full skill instructions, and jit for extra code context. Use blackboard for high-signal shared facts and ownership, not as a second tracker or a long scratch log. Websearch is core-visible for current external information. Plan mode is for explicit plan artifacts, not the default planner.",
    "",
    "Tool families:",
    "- files: read/glob/grep",
    "- patching: apply_patch/edit/write",
    "- world: bash/webfetch/websearch",
    "- coordination: task/skill/blackboard/tracker/todowrite",
    "- planning: question/enter_plan_mode/exit_plan_mode",
    "- search: websearch/codesearch",
    "- websearch is already core-visible; you do not need coordination just to use it",
    "- mcp: all MCP tools",
    "- all: all tools plus MCP and prompt context families",
    "",
    "Prompt context families:",
    "- jit: just-in-time workspace context",
    "- instructions: instruction-file prompt layers",
    "- mission: mission/workgraph context",
    "- transform: experimental message transforms",
    "- skills: lightweight DAG-linked skill references",
    "- all_context: all prompt context families",
  ].join("\n"),
  parameters: z.object({
    action: z.enum(["list", "enable", "disable", "reset"]).describe("How to inspect or change the capability surface."),
    targets: z
      .array(z.string())
      .optional()
      .describe("Capability family names or exact tool IDs. Not needed for list/reset."),
    scope: z
      .enum(["turn", "session"])
      .default("session")
      .describe("Whether the change should apply only to this turn or persist for the whole session."),
  }),
  async execute(params, ctx) {
    const scope = params.scope ?? "session"
    const requireTargets = params.action === "enable" || params.action === "disable"
    if (requireTargets && (!params.targets || params.targets.length === 0)) {
      throw new Error(`capability action="${params.action}" requires at least one target.`)
    }
    const turnID = typeof ctx.extra?.turnID === "string" ? ctx.extra.turnID : undefined
    const scopeOptions = { scope, turnID }

    const state =
      params.action === "list"
        ? CapabilityRuntime.snapshot(ctx.sessionID, turnID)
        : params.action === "enable"
          ? CapabilityRuntime.enable(ctx.sessionID, params.targets, scopeOptions)
          : params.action === "disable"
            ? CapabilityRuntime.disable(ctx.sessionID, params.targets, scopeOptions)
            : CapabilityRuntime.reset(ctx.sessionID, scopeOptions)

    const changeSummary =
      params.action === "list"
        ? "Current capability state."
        : params.action === "reset"
          ? `Capability surface reset to the lean default shell for this ${scope}.`
          : `${params.action === "enable" ? "Enabled" : "Disabled"} targets for future steps in this ${scope}: ${(params.targets ?? []).join(", ")}`
    const connectionResults = await connectRequestedMcpTargets(params.action, params.targets, turnID, ctx.sessionID)
    const inspection = params.action === "list" ? await inspectMcpSurface(ctx.sessionID, turnID) : undefined

    return {
      title: "Capability Surface",
      output: [
        changeSummary,
        connectionResults ? "" : undefined,
        connectionResults
          ? [
              "MCP connection attempts:",
              ...Object.entries(connectionResults)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, result]) => `- ${name}: ${result}`),
            ].join("\n")
          : undefined,
        inspection ? "" : undefined,
        inspection ? formatMcpInspection(inspection) : undefined,
        "",
        JSON.stringify(state, null, 2),
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        action: params.action,
        scope,
        targets: params.targets ?? [],
        state,
        inspection,
        connectionResults,
      },
    }
  },
})
