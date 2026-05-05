// Trust & Reputation — tracks the reliability and performance of each
// child session over time. Sessions that consistently produce good results
// earn higher trust, which affects conflict resolution priority and
// autonomous operation permissions.

import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "agent.trust" })

export type TrustLevel = "untrusted" | "provisional" | "trusted" | "expert"

export type TrustProfile = {
  sessionID: string
  role?: string
  score: number
  level: TrustLevel
  actions: number
  successes: number
  failures: number
  edits: number
  reverts: number
  streak: number // consecutive successes
  at: number
}

// Per-session trust profiles
const profiles = Instance.state(() => new Map<string, TrustProfile>())

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function get(sessionID: string): TrustProfile {
  const existing = profiles().get(sessionID)
  if (existing) return existing

  const fresh: TrustProfile = {
    sessionID,
    score: 50,
    level: "provisional",
    actions: 0,
    successes: 0,
    failures: 0,
    edits: 0,
    reverts: 0,
    streak: 0,
    at: Date.now(),
  }

  profiles().set(sessionID, fresh)
  return fresh
}

/** Record a successful action (edit applied, test passed, etc.). */
function success(sessionID: string, weight = 1) {
  const profile = get(sessionID)
  profile.actions += 1
  profile.successes += 1
  profile.streak += 1
  profile.score = Math.min(100, profile.score + weight * 2 + Math.floor(profile.streak / 3))
  profile.level = classify(profile.score)
  profile.at = Date.now()
}

/** Record a failed action (edit rejected, test failed, etc.). */
function failure(sessionID: string, weight = 1) {
  const profile = get(sessionID)
  profile.actions += 1
  profile.failures += 1
  profile.streak = 0
  profile.score = Math.max(0, profile.score - weight * 5)
  profile.level = classify(profile.score)
  profile.at = Date.now()
}

/** Record an edit operation. */
function edit(sessionID: string) {
  get(sessionID).edits += 1
}

/** Record a reverted edit (significant trust penalty). */
function revert(sessionID: string) {
  const profile = get(sessionID)
  profile.reverts += 1
  profile.streak = 0
  profile.score = Math.max(0, profile.score - 10)
  profile.level = classify(profile.score)
  profile.at = Date.now()

  log.debug("trust.revert", {
    sessionID,
    score: profile.score,
    level: profile.level,
    reverts: profile.reverts,
  })
}

/** Check if a session is trusted enough for autonomous operations. */
function canOperate(sessionID: string, threshold: TrustLevel = "trusted"): boolean {
  const profile = get(sessionID)
  const levels: TrustLevel[] = ["untrusted", "provisional", "trusted", "expert"]
  return levels.indexOf(profile.level) >= levels.indexOf(threshold)
}

/** Get the trust-weighted priority for conflict resolution. */
function priority(sessionID: string): number {
  const profile = get(sessionID)
  return profile.score + (profile.streak * 2)
}

/** Compare two sessions by trust. */
function compare(a: string, b: string): number {
  return priority(b) - priority(a) // Higher trust = higher priority
}

function leaderboard(): TrustProfile[] {
  return [...profiles().values()]
    .sort((a, b) => b.score - a.score)
}

function clear(sessionID: string) {
  profiles().delete(sessionID)
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function classify(score: number): TrustLevel {
  if (score >= 85) return "expert"
  if (score >= 60) return "trusted"
  if (score >= 30) return "provisional"
  return "untrusted"
}

export const Trust = {
  get,
  success,
  failure,
  edit,
  revert,
  canOperate,
  priority,
  compare,
  leaderboard,
  clear,
} as const
