// Episodic Memory — captures significant events as persistent episodes that
// span sessions. Episodes are indexed in the retrieval engine so future
// sessions can learn from past outcomes.

import { createHash } from "crypto"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"

const log = Log.create({ service: "memory.episodes" })

export type EpisodeType =
  | "patch_success"
  | "patch_failure"
  | "debugging_session"
  | "architecture_decision"
  | "tool_gap"
  | "user_correction"
  | "assumption_contradicted"
  | "commitment_broken"
  | "falsifier_triggered"

export type Episode = {
  id: string
  projectID: string
  sessionID: string
  rootSessionID?: string
  type: EpisodeType
  summary: string
  context: string
  outcome: string
  confidence: number
  files: string[]
  tools: string[]
  at: number
}

// ---------------------------------------------------------------------------
// Create & persist
// ---------------------------------------------------------------------------

async function create(input: {
  projectID: string
  sessionID: string
  rootSessionID?: string
  type: EpisodeType
  summary: string
  context: string
  outcome: string
  confidence?: number
  files?: string[]
  tools?: string[]
}): Promise<Episode> {
  const episode: Episode = {
    id: Identifier.ascending("part"),
    projectID: input.projectID,
    sessionID: input.sessionID,
    rootSessionID: input.rootSessionID,
    type: input.type,
    summary: input.summary,
    context: input.context,
    outcome: input.outcome,
    confidence: input.confidence ?? 0.5,
    files: input.files ?? [],
    tools: input.tools ?? [],
    at: Date.now(),
  }

  try {
    await persist(episode)
  } catch (err) {
    log.warn("episode.persist.failed", { id: episode.id, err })
  }

  log.debug("episode.created", {
    id: episode.id,
    type: episode.type,
    summary: episode.summary.slice(0, 80),
  })

  return episode
}

// ---------------------------------------------------------------------------
// Retrieval integration
// ---------------------------------------------------------------------------

async function persist(episode: Episode) {
  const { RetrievalService } = await import("@/retrieval")

  const content = [
    `Episode: ${episode.type}`,
    `summary: ${episode.summary}`,
    `project_id: ${episode.projectID}`,
    `session_id: ${episode.sessionID}`,
    episode.rootSessionID ? `root_session_id: ${episode.rootSessionID}` : undefined,
    `outcome: ${episode.outcome}`,
    `confidence: ${episode.confidence}`,
    episode.files.length > 0 ? `files: ${episode.files.join(", ")}` : undefined,
    episode.tools.length > 0 ? `tools: ${episode.tools.join(", ")}` : undefined,
    `context: ${episode.context}`,
  ]
    .filter(Boolean)
    .join("\n")

  const fingerprint = createHash("sha1").update(content).digest("hex")
  const id = `episode-${episode.id}`

  const negative = isNegative(episode.type)

  await RetrievalService.upsertDocument({
    id,
    projectID: episode.projectID,
    sessionID: episode.sessionID,
    sourceType: "episode",
    sourceID: episode.id,
    title: `Episode: ${episode.type} — ${episode.summary.slice(0, 60)}`,
    fingerprint,
    metadata: {
      kind: "episode",
      type: episode.type,
      rootSessionID: episode.rootSessionID,
      files: episode.files,
      tools: episode.tools,
    },
    outcomeScore: negative ? -1 : 1,
    negativeSignal: negative,
  })

  await RetrievalService.replaceChunks({
    documentID: id,
    projectID: episode.projectID,
    content,
    chunkType: "episode",
  })
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

async function search(input: {
  projectID: string
  query: string
  limit?: number
}) {
  const { RetrievalService } = await import("@/retrieval")

  return RetrievalService.search({
    projectID: input.projectID,
    query: input.query,
    policy: "fast",
    limit: input.limit ?? 5,
    sourceTypes: ["episode"],
  })
}

// ---------------------------------------------------------------------------
// Convenience: create episodes from reasoning ledger transitions
// ---------------------------------------------------------------------------

function fromTransition(input: {
  projectID: string
  sessionID: string
  rootSessionID: string
  targetType: "commitment" | "assumption" | "falsifier"
  outcome: string
  statement: string
  note?: string
  previous?: string
  current?: string
}): Promise<Episode> {
  const type = resolveType(input.targetType, input.outcome)

  const context = [
    `${input.targetType}: ${input.statement}`,
    input.previous ? `previous_status: ${input.previous}` : undefined,
    input.current ? `current_status: ${input.current}` : undefined,
    input.note ? `note: ${input.note}` : undefined,
  ]
    .filter(Boolean)
    .join("\n")

  return create({
    projectID: input.projectID,
    sessionID: input.sessionID,
    rootSessionID: input.rootSessionID,
    type,
    summary: `${input.targetType} ${input.outcome}: ${input.statement}`,
    context,
    outcome: input.outcome,
    files: [],
    tools: [],
  })
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveType(target: string, outcome: string): EpisodeType {
  if (target === "commitment" && outcome === "broken") return "commitment_broken"
  if (target === "assumption" && outcome === "contradicted") return "assumption_contradicted"
  if (target === "falsifier" && outcome === "triggered") return "falsifier_triggered"
  if (target === "commitment" && outcome === "satisfied") return "patch_success"
  return "debugging_session"
}

function isNegative(type: EpisodeType) {
  return type === "patch_failure"
    || type === "assumption_contradicted"
    || type === "commitment_broken"
    || type === "falsifier_triggered"
    || type === "tool_gap"
}

export const Episodes = {
  create,
  search,
  fromTransition,
} as const
