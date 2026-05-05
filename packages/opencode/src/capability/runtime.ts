const CORE_TOOL_IDS = new Set([
    "capability",
    "task",
    "skill",
    "websearch",
    "read",
    "glob",
    "grep",
    "apply_patch",
    "edit",
    "write",
    "bash",
    "webfetch",
  ])
const KNOWN_MCP_CLIENT_IDS = new Set([
  "playwright",
  "chrome-devtools",
])
const CORE_MCP_IDS = new Set<string>()

const FAMILY_TOOL_IDS: Record<string, string[]> = {
    core: [...CORE_TOOL_IDS],
    files: ["read", "glob", "grep"],
    patching: ["apply_patch", "edit", "write"],
    world: ["bash", "webfetch", "websearch"],
    coordination: [
      "task",
      "skill",
      "blackboard_get",
      "blackboard_set",
      "blackboard_append",
      "blackboard_increment",
      "blackboard_compare_and_swap",
      "blackboard_delete",
      "blackboard_clear",
      "todowrite",
      "tracker_create_task",
      "tracker_update_task",
      "tracker_get_task",
      "tracker_list_tasks",
      "tracker_add_dependency",
      "tracker_visualize",
      "tracker_dag_unblock",
      "tracker_add_artifact",
      "tracker_delete_task",
    ],
    planning: ["question", "enter_plan_mode", "exit_plan_mode"],
    search: ["websearch", "codesearch"],
  }

const CONTEXT_IDS = ["jit", "instructions", "mission", "transform", "skills"] as const
const CONTEXT_ID_SET = new Set<string>(CONTEXT_IDS)

const FAMILY_CONTEXT_IDS: Record<string, string[]> = {
    all_context: [...CONTEXT_IDS],
    context: [...CONTEXT_IDS],
    jit: ["jit"],
    instructions: ["instructions"],
    mission: ["mission"],
    transform: ["transform"],
    skills: ["skills"],
  }

type CapabilityState = {
  allToolsEnabled: boolean
  allContextEnabled: boolean
  mcpEnabled: boolean
  toolIDs: Set<string>
  contextIDs: Set<string>
}

type SessionCapabilityState = {
  session: CapabilityState
  turns: Map<string, CapabilityState>
}

type Scope = "session" | "turn"

const sessionState = new Map<string, SessionCapabilityState>()

function createState(): CapabilityState {
  return {
    allToolsEnabled: false,
    allContextEnabled: false,
    mcpEnabled: false,
    toolIDs: new Set<string>(),
    contextIDs: new Set<string>(),
  }
}

function getOrCreate(sessionID: string): SessionCapabilityState {
    const existing = sessionState.get(sessionID)
    if (existing) return existing
    const created: SessionCapabilityState = {
      session: createState(),
      turns: new Map<string, CapabilityState>(),
    }
    sessionState.set(sessionID, created)
    return created
  }

function getOrCreateScope(sessionID: string, scope: Scope, turnID?: string): CapabilityState {
    const state = getOrCreate(sessionID)
    if (scope === "session" || !turnID) return state.session
    const existing = state.turns.get(turnID)
    if (existing) return existing
    const created = createState()
    state.turns.set(turnID, created)
    return created
  }

function mergeStates(base: CapabilityState, overlay?: CapabilityState): CapabilityState {
    return {
      allToolsEnabled: base.allToolsEnabled || !!overlay?.allToolsEnabled,
      allContextEnabled: base.allContextEnabled || !!overlay?.allContextEnabled,
      mcpEnabled: base.mcpEnabled || !!overlay?.mcpEnabled,
      toolIDs: new Set<string>([...base.toolIDs, ...(overlay ? [...overlay.toolIDs] : [])]),
      contextIDs: new Set<string>([...base.contextIDs, ...(overlay ? [...overlay.contextIDs] : [])]),
    }
  }

function stateForTurn(sessionID: string, turnID?: string) {
    const state = getOrCreate(sessionID)
    if (!turnID) return state.session
    return mergeStates(state.session, state.turns.get(turnID))
  }

function normalizeTargets(targets?: string[]) {
    return [...new Set((targets ?? []).map((item) => item.trim()).filter(Boolean))]
  }

function expandTargets(targets?: string[]) {
    const toolIDs = new Set<string>()
    const contextIDs = new Set<string>()
    let allToolsEnabled = false
    let allContextEnabled = false
    let mcpEnabled = false

    for (const raw of normalizeTargets(targets)) {
      const key = raw.toLowerCase()
      if (key === "all") {
        allToolsEnabled = true
        allContextEnabled = true
        mcpEnabled = true
        continue
      }
      if (key === "mcp") {
        mcpEnabled = true
        continue
      }
    if (key in FAMILY_CONTEXT_IDS) {
      const family = FAMILY_CONTEXT_IDS[key]
      if (!family) continue
      for (const id of family) contextIDs.add(id)
      continue
    }
    if (key in FAMILY_TOOL_IDS) {
      const family = FAMILY_TOOL_IDS[key]
      if (!family) continue
      for (const id of family) toolIDs.add(id)
      continue
    }
      if (CONTEXT_ID_SET.has(key)) {
        contextIDs.add(key)
        continue
      }
      toolIDs.add(raw)
    }

    return { toolIDs, contextIDs, allToolsEnabled, allContextEnabled, mcpEnabled }
  }

function coreToolIDs() {
  return new Set(CORE_TOOL_IDS)
}

function families() {
  return {
    tools: Object.fromEntries(Object.entries(FAMILY_TOOL_IDS).map(([key, value]) => [key, [...value]])),
    context: Object.fromEntries(Object.entries(FAMILY_CONTEXT_IDS).map(([key, value]) => [key, [...value]])),
  }
}

function snapshot(sessionID: string, turnID?: string) {
  const state = stateForTurn(sessionID, turnID)
  const visibleClientIDs =
    state.allToolsEnabled || state.mcpEnabled
      ? [...KNOWN_MCP_CLIENT_IDS].sort()
      : [...new Set([...[...state.toolIDs].filter((id) => KNOWN_MCP_CLIENT_IDS.has(id))])].sort()
  const mcpAccessMode = state.allToolsEnabled || state.mcpEnabled ? "all" : visibleClientIDs.length > 0 ? "clients" : "hidden"
  return {
    allToolsEnabled: state.allToolsEnabled,
    allContextEnabled: state.allContextEnabled,
    mcpEnabled: state.mcpEnabled,
    mcpAccessMode,
    toolIDs: [...state.toolIDs].sort(),
    contextIDs: [...state.contextIDs].sort(),
    families: families(),
    coreToolIDs: [...CORE_TOOL_IDS].sort(),
    coreMcpIDs: [...CORE_MCP_IDS].sort(),
    knownMcpClientIDs: [...KNOWN_MCP_CLIENT_IDS].sort(),
    visibleMcpClientIDs: visibleClientIDs,
    contextCapabilityIDs: [...CONTEXT_IDS].sort(),
  }
}

function reset(sessionID: string, options?: { scope?: Scope; turnID?: string }) {
    const scope = options?.scope ?? "session"
    if (scope === "turn" && options?.turnID) {
      const state = getOrCreate(sessionID)
      state.turns.delete(options.turnID)
      return snapshot(sessionID, options.turnID)
    }
    sessionState.delete(sessionID)
    return snapshot(sessionID)
  }

function resetTurn(sessionID: string, turnID: string) {
    const state = sessionState.get(sessionID)
    if (!state) return snapshot(sessionID, turnID)
    state.turns.delete(turnID)
    return snapshot(sessionID, turnID)
  }

function enable(sessionID: string, targets?: string[], options?: { scope?: Scope; turnID?: string }) {
    const state = getOrCreateScope(sessionID, options?.scope ?? "session", options?.turnID)
    const expanded = expandTargets(targets)
    state.allToolsEnabled = state.allToolsEnabled || expanded.allToolsEnabled
    state.allContextEnabled = state.allContextEnabled || expanded.allContextEnabled
    state.mcpEnabled = state.mcpEnabled || expanded.mcpEnabled
    for (const id of expanded.toolIDs) state.toolIDs.add(id)
    for (const id of expanded.contextIDs) state.contextIDs.add(id)
    return snapshot(sessionID, options?.turnID)
  }

function disable(sessionID: string, targets?: string[], options?: { scope?: Scope; turnID?: string }) {
    const state = getOrCreateScope(sessionID, options?.scope ?? "session", options?.turnID)
    const expanded = expandTargets(targets)
    if (expanded.allToolsEnabled) state.allToolsEnabled = false
    if (expanded.allContextEnabled) state.allContextEnabled = false
    if (expanded.mcpEnabled) state.mcpEnabled = false
    for (const id of expanded.toolIDs) state.toolIDs.delete(id)
    for (const id of expanded.contextIDs) state.contextIDs.delete(id)
    return snapshot(sessionID, options?.turnID)
  }

function isToolVisible(sessionID: string, toolID: string, explicitlyEnabled = false, turnID?: string) {
    if (explicitlyEnabled) return true
    if (CORE_TOOL_IDS.has(toolID)) return true
    const state = stateForTurn(sessionID, turnID)
    if (state.allToolsEnabled) return true
    return state.toolIDs.has(toolID)
  }

function isMcpVisible(sessionID: string, toolID: string, explicitlyEnabled = false, turnID?: string) {
    if (explicitlyEnabled) return true
    const state = stateForTurn(sessionID, turnID)
    if (state.allToolsEnabled || state.mcpEnabled) return true
    return state.toolIDs.has(toolID)
  }

function visibleMcpClientIDs(sessionID: string, turnID?: string) {
    const state = stateForTurn(sessionID, turnID)
    if (state.allToolsEnabled || state.mcpEnabled) return undefined
    const visible = [...new Set([...[...state.toolIDs].filter((id) => KNOWN_MCP_CLIENT_IDS.has(id))])]
    return visible.length > 0 ? visible : []
  }

function isContextEnabled(
  sessionID: string,
  contextID: string,
  explicitlyEnabled = false,
  turnID?: string,
  defaultEnabled = false,
) {
  if (explicitlyEnabled) return true
  const state = stateForTurn(sessionID, turnID)
  if (state.allContextEnabled) return true
  if (state.contextIDs.has(contextID)) return true
  return defaultEnabled
}

export const CapabilityRuntime = {
  coreToolIDs,
  families,
  snapshot,
  reset,
  resetTurn,
  enable,
  disable,
  isToolVisible,
  isMcpVisible,
  visibleMcpClientIDs,
  isContextEnabled,
}
