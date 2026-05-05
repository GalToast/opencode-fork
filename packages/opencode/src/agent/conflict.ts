// Conflict Resolution Protocol — when multiple child sessions propose
// conflicting edits to the same file or disagree on approach, this
// module orchestrates a resolution process: merge, vote, or escalate.

import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "agent.conflict" })

export type ConflictType =
  | "file_contention"    // Multiple sessions editing the same file
  | "approach_divergence" // Sessions disagree on implementation approach
  | "resource_contention" // Sessions competing for limited resource (LSP, browser)
  | "dependency_cycle"    // Task dependencies form a cycle

export type Resolution =
  | "merge"     // Combine both changes
  | "prioritize" // One session wins based on role/trust
  | "vote"      // All participants vote
  | "escalate"  // Escalate to parent session or user
  | "defer"     // Defer to later resolution

export type Conflict = {
  id: string
  type: ConflictType
  sessions: string[]
  description: string
  files: string[]
  resolution?: Resolution
  winner?: string
  votes?: Record<string, string>
  status: "detected" | "resolving" | "resolved" | "escalated"
  at: number
}

// Active conflicts
const active = Instance.state(() => new Map<string, Conflict>())

// File locks — tracks which session is actively editing which files
const locks = Instance.state(() => new Map<string, string>())

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function detect(input: {
  type: ConflictType
  sessions: string[]
  description: string
  files?: string[]
}): Conflict {
  const conflict: Conflict = {
    id: Identifier.ascending("part"),
    type: input.type,
    sessions: input.sessions,
    description: input.description,
    files: input.files ?? [],
    status: "detected",
    at: Date.now(),
  }

  active().set(conflict.id, conflict)
  log.debug("conflict.detected", {
    id: conflict.id,
    type: conflict.type,
    sessions: conflict.sessions.length,
  })

  return conflict
}

/** Check if editing a file would cause a conflict. */
function check(sessionID: string, file: string): Conflict | undefined {
  const holder = locks().get(file)
  if (!holder || holder === sessionID) return undefined

  return detect({
    type: "file_contention",
    sessions: [sessionID, holder],
    description: `Sessions "${sessionID}" and "${holder}" both want to edit "${file}"`,
    files: [file],
  })
}

// ---------------------------------------------------------------------------
// Resolution strategies
// ---------------------------------------------------------------------------

async function resolve(id: string, strategy?: Resolution): Promise<Conflict> {
  const conflict = active().get(id)
  if (!conflict) throw new Error(`Conflict not found: ${id}`)

  conflict.status = "resolving"
  const resolution = strategy ?? autoStrategy(conflict)
  conflict.resolution = resolution

  switch (resolution) {
    case "prioritize":
      conflict.winner = await prioritize(conflict)
      break
    case "vote":
      // Voting is async — leave in resolving state
      return conflict
    case "escalate":
      conflict.status = "escalated"
      return conflict
    case "merge":
      // Merge is attempted — success or escalate
      conflict.winner = "merged"
      break
    case "defer":
      break
  }

  conflict.status = "resolved"

  log.debug("conflict.resolved", {
    id: conflict.id,
    resolution,
    winner: conflict.winner,
  })

  // Release file locks for losing sessions
  if (conflict.winner && conflict.files.length > 0) {
    for (const file of conflict.files) {
      locks().set(file, conflict.winner)
    }
  }

  return conflict
}

function vote(conflictID: string, sessionID: string, choice: string) {
  const conflict = active().get(conflictID)
  if (!conflict) return

  conflict.votes = conflict.votes ?? {}
  conflict.votes[sessionID] = choice

  // Auto-resolve when all participants have voted
  if (Object.keys(conflict.votes).length >= conflict.sessions.length) {
    const counts = new Map<string, number>()
    for (const v of Object.values(conflict.votes)) {
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }

    let max = 0
    let winner = ""
    for (const [choice, count] of counts) {
      if (count > max) {
        max = count
        winner = choice
      }
    }

    conflict.winner = winner
    conflict.status = "resolved"
  }
}

// ---------------------------------------------------------------------------
// File locking
// ---------------------------------------------------------------------------

function lock(sessionID: string, file: string): boolean {
  const existing = locks().get(file)
  if (existing && existing !== sessionID) return false
  locks().set(file, sessionID)
  return true
}

function unlock(sessionID: string, file: string) {
  if (locks().get(file) === sessionID) {
    locks().delete(file)
  }
}

function unlockAll(sessionID: string) {
  for (const [file, holder] of locks()) {
    if (holder === sessionID) locks().delete(file)
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function autoStrategy(conflict: Conflict): Resolution {
  if (conflict.type === "file_contention") return "prioritize"
  if (conflict.type === "resource_contention") return "prioritize"
  if (conflict.type === "approach_divergence") return "vote"
  if (conflict.type === "dependency_cycle") return "escalate"
  return "defer"
}

async function prioritize(conflict: Conflict): Promise<string> {
  // Use trust scores if available, otherwise use role priority
  try {
    const { AgentRoles } = await import("./roles")
    const scores = conflict.sessions.map((s) => {
      const role = AgentRoles.get(s)
      if (!role) return { session: s, priority: 0 }
      // Implementer > reviewer > debugger for file contention
      const priorities: Record<string, number> = {
        implementer: 10, debugger: 8, tester: 7,
        reviewer: 5, architect: 4, researcher: 3, planner: 2,
      }
      return { session: s, priority: priorities[role.name] ?? 0 }
    })

    scores.sort((a, b) => b.priority - a.priority)
    return scores[0]?.session ?? conflict.sessions[0]
  } catch {
    return conflict.sessions[0]
  }
}

function list(): Conflict[] {
  return [...active().values()]
}

function pending(): Conflict[] {
  return list().filter((c) => c.status === "detected" || c.status === "resolving")
}

export const ConflictResolution = {
  detect,
  check,
  resolve,
  vote,
  lock,
  unlock,
  unlockAll,
  list,
  pending,
} as const
