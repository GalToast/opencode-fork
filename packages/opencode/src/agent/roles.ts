// Agent Roles & Specialization — defines formal roles that child sessions
// can adopt, each with specialized tool access, knowledge focus, and
// behavioral constraints. Enables division of labor in multi-agent tasks.

import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "agent.roles" })

export type RoleName =
  | "architect"    // designs systems, reviews structure
  | "implementer"  // writes code, edits files
  | "reviewer"     // reviews diffs, checks quality
  | "debugger"     // diagnoses failures, forms hypotheses
  | "researcher"   // reads documentation, searches codebase
  | "tester"       // writes/runs tests, validates behavior
  | "planner"      // breaks tasks into subtasks, manages dependencies

export type Role = {
  name: RoleName
  description: string
  tools: {
    allowed: string[]
    denied: string[]
    preferred: string[]
  }
  context: {
    sources: string[]
    priority: Record<string, number>
  }
  constraints: {
    maxFiles: number
    maxTokens: number
    canCreateSessions: boolean
    canEditTests: boolean
  }
}

const ROLES: Record<RoleName, Role> = {
  architect: {
    name: "architect",
    description: "Designs system structure, reviews architecture decisions, proposes evolution",
    tools: {
      allowed: ["read", "search", "grep", "glob", "dependency_explorer", "list", "structural_read"],
      denied: ["edit", "write", "shell", "terminal", "bash", "apply_patch"],
      preferred: ["dependency_explorer", "structural_read"],
    },
    context: {
      sources: ["reasoning_ledger", "episodes", "patterns"],
      priority: { reasoning_ledger: 8, patterns: 7, episodes: 5 },
    },
    constraints: {
      maxFiles: 50,
      maxTokens: 16000,
      canCreateSessions: true,
      canEditTests: false,
    },
  },
  implementer: {
    name: "implementer",
    description: "Writes production code, applies patches, creates files",
    tools: {
      allowed: ["read", "edit", "write", "apply_patch", "search", "grep", "shell", "terminal", "bash", "multi_edit"],
      denied: [],
      preferred: ["edit", "write", "shell"],
    },
    context: {
      sources: ["jit", "workgraph", "instructions"],
      priority: { jit: 8, workgraph: 6, instructions: 5 },
    },
    constraints: {
      maxFiles: 20,
      maxTokens: 12000,
      canCreateSessions: false,
      canEditTests: false,
    },
  },
  reviewer: {
    name: "reviewer",
    description: "Reviews code changes, checks for bugs, validates patterns",
    tools: {
      allowed: ["read", "search", "grep", "dependency_explorer", "diagnostics"],
      denied: ["edit", "write", "shell", "terminal", "bash", "apply_patch"],
      preferred: ["read", "dependency_explorer"],
    },
    context: {
      sources: ["episodes", "reasoning_ledger", "patterns"],
      priority: { episodes: 7, reasoning_ledger: 6, patterns: 5 },
    },
    constraints: {
      maxFiles: 30,
      maxTokens: 10000,
      canCreateSessions: false,
      canEditTests: false,
    },
  },
  debugger: {
    name: "debugger",
    description: "Diagnoses failures, forms hypotheses, runs targeted experiments",
    tools: {
      allowed: ["read", "search", "grep", "shell", "terminal", "bash", "diagnostics", "dependency_explorer"],
      denied: ["write"],
      preferred: ["shell", "diagnostics", "search"],
    },
    context: {
      sources: ["episodes", "reasoning_ledger", "jit"],
      priority: { episodes: 8, reasoning_ledger: 7, jit: 5 },
    },
    constraints: {
      maxFiles: 25,
      maxTokens: 14000,
      canCreateSessions: true,
      canEditTests: true,
    },
  },
  researcher: {
    name: "researcher",
    description: "Reads documentation, searches the codebase, gathers context",
    tools: {
      allowed: ["read", "search", "grep", "glob", "list", "fetch", "structural_read"],
      denied: ["edit", "write", "shell", "terminal", "bash", "apply_patch"],
      preferred: ["search", "grep", "structural_read"],
    },
    context: {
      sources: ["jit", "episodes", "patterns"],
      priority: { jit: 7, episodes: 5, patterns: 4 },
    },
    constraints: {
      maxFiles: 100,
      maxTokens: 8000,
      canCreateSessions: false,
      canEditTests: false,
    },
  },
  tester: {
    name: "tester",
    description: "Writes and runs tests, validates behavior, checks coverage",
    tools: {
      allowed: ["read", "edit", "write", "shell", "terminal", "bash", "search", "grep", "diagnostics"],
      denied: [],
      preferred: ["shell", "edit"],
    },
    context: {
      sources: ["jit", "workgraph", "instructions"],
      priority: { jit: 6, workgraph: 7, instructions: 4 },
    },
    constraints: {
      maxFiles: 15,
      maxTokens: 10000,
      canCreateSessions: false,
      canEditTests: true,
    },
  },
  planner: {
    name: "planner",
    description: "Breaks tasks into subtasks, manages dependencies, coordinates work",
    tools: {
      allowed: ["read", "search", "grep", "task", "structural_read"],
      denied: ["edit", "write", "shell", "terminal", "bash"],
      preferred: ["task", "structural_read"],
    },
    context: {
      sources: ["workgraph", "reasoning_ledger", "episodes"],
      priority: { workgraph: 9, reasoning_ledger: 6, episodes: 4 },
    },
    constraints: {
      maxFiles: 50,
      maxTokens: 12000,
      canCreateSessions: true,
      canEditTests: false,
    },
  },
}

// Per-session role assignments
const assignments = Instance.state(() => new Map<string, RoleName>())

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function assign(sessionID: string, role: RoleName) {
  assignments().set(sessionID, role)
  log.debug("role.assigned", { sessionID, role })
}

function get(sessionID: string): Role | undefined {
  const name = assignments().get(sessionID)
  if (!name) return undefined
  return ROLES[name]
}

function name(sessionID: string): RoleName | undefined {
  return assignments().get(sessionID)
}

function allowed(sessionID: string, tool: string): boolean {
  const role = get(sessionID)
  if (!role) return true // no role = no restrictions

  if (role.tools.denied.includes(tool)) return false
  if (role.tools.allowed.length > 0 && !role.tools.allowed.includes(tool)) return false
  return true
}

function preferred(sessionID: string): string[] {
  const role = get(sessionID)
  return role?.tools.preferred ?? []
}

/** Auto-classify a task description into a role. */
function classify(description: string): RoleName {
  const lower = description.toLowerCase()

  if (lower.includes("review") || lower.includes("check")) return "reviewer"
  if (lower.includes("debug") || lower.includes("fix") || lower.includes("diagnose")) return "debugger"
  if (lower.includes("test") || lower.includes("spec") || lower.includes("validate")) return "tester"
  if (lower.includes("research") || lower.includes("read") || lower.includes("understand")) return "researcher"
  if (lower.includes("plan") || lower.includes("break down") || lower.includes("organize")) return "planner"
  if (lower.includes("design") || lower.includes("architect") || lower.includes("structure")) return "architect"
  return "implementer"
}

function clear(sessionID: string) {
  assignments().delete(sessionID)
}

function all(): typeof ROLES {
  return { ...ROLES }
}

export const AgentRoles = {
  assign,
  get,
  name,
  allowed,
  preferred,
  classify,
  clear,
  all,
  ROLES,
} as const
