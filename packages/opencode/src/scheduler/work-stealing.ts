// Work Stealing — enables idle child sessions to steal queued work from
// busy sessions. This maximizes throughput by keeping all agents occupied
// and prevents bottlenecks from overloaded sessions.

import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "scheduler.work-stealing" })

export type WorkItem = {
  id: string
  sessionID: string    // Currently assigned session
  description: string
  tool: string
  args: Record<string, unknown>
  priority: number
  stealable: boolean
  stolen: boolean
  stolenBy?: string
  queued: number
  started?: number
}

// Per-session work queues
const queues = Instance.state(() => new Map<string, WorkItem[]>())

// Sessions that have declared themselves idle
const idle = Instance.state(() => new Set<string>())

// ---------------------------------------------------------------------------
// Queue management
// ---------------------------------------------------------------------------

function enqueue(item: WorkItem) {
  const queue = queues().get(item.sessionID) ?? []
  queue.push(item)
  queues().set(item.sessionID, queue)

  // Check if any idle session can steal this work
  trySteal()
}

function dequeue(sessionID: string): WorkItem | undefined {
  const queue = queues().get(sessionID) ?? []
  if (queue.length === 0) return undefined

  // Sort by priority (higher first)
  queue.sort((a, b) => b.priority - a.priority)
  return queue.shift()
}

function complete(sessionID: string, itemID: string) {
  const queue = queues().get(sessionID) ?? []
  const idx = queue.findIndex((w) => w.id === itemID)
  if (idx >= 0) queue.splice(idx, 1)
}

// ---------------------------------------------------------------------------
// Steal protocol
// ---------------------------------------------------------------------------

/** Mark a session as idle and ready to steal work. */
function advertise(sessionID: string) {
  idle().add(sessionID)
  trySteal()
}

/** Mark a session as busy (no longer available for stealing). */
function busy(sessionID: string) {
  idle().delete(sessionID)
}

/** Attempt to redistribute work from overloaded sessions to idle ones. */
function trySteal() {
  const idleSessions = [...idle()]
  if (idleSessions.length === 0) return

  // Find sessions with the longest queues
  const sorted = [...queues().entries()]
    .filter(([_, q]) => q.length > 1) // Only steal if queue has 2+ items
    .sort((a, b) => b[1].length - a[1].length)

  for (const [sourceID, queue] of sorted) {
    if (idleSessions.length === 0) break

    // Find stealable items (from the tail = lowest priority)
    const stealable = queue.filter((w) => w.stealable && !w.started)
    if (stealable.length === 0) continue

    const thief = idleSessions.shift()!
    const victim = stealable[stealable.length - 1] // Steal lowest priority

    // Transfer
    const idx = queue.indexOf(victim)
    if (idx >= 0) queue.splice(idx, 1)

    victim.stolen = true
    victim.stolenBy = thief
    victim.sessionID = thief

    const thiefQueue = queues().get(thief) ?? []
    thiefQueue.push(victim)
    queues().set(thief, thiefQueue)

    idle().delete(thief)

    log.debug("work.stolen", {
      item: victim.id,
      from: sourceID,
      to: thief,
      description: victim.description.slice(0, 40),
    })
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function depth(sessionID: string): number {
  return (queues().get(sessionID) ?? []).length
}

function stats(): {
  queues: { session: string; depth: number }[]
  idle: string[]
  stolen: number
} {
  const stolen = [...queues().values()]
    .flat()
    .filter((w) => w.stolen).length

  return {
    queues: [...queues().entries()].map(([s, q]) => ({
      session: s,
      depth: q.length,
    })),
    idle: [...idle()],
    stolen,
  }
}

function clear(sessionID: string) {
  queues().delete(sessionID)
  idle().delete(sessionID)
}

export const WorkStealing = {
  enqueue,
  dequeue,
  complete,
  advertise,
  busy,
  trySteal,
  depth,
  stats,
  clear,
} as const
