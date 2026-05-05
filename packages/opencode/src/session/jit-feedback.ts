// JIT Feedback — tracks whether files paged by the JIT hydrator were actually
// useful (referenced by a subsequent tool call) and feeds that signal back into
// the retrieval engine so future paging decisions improve over time.

import { Bus } from "@/bus"
import { File } from "@/file"
import { FileTime } from "@/file/time"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { createHash } from "crypto"

const log = Log.create({ service: "session.jit-feedback" })
let initialized = false

// Per-session tracking of which files were paged and whether they were touched.
const sessionPaged = Instance.state(() => new Map<string, SessionPagingState>())

type PagedFile = {
  path: string
  at: number
  touched: boolean
}

type SessionPagingState = {
  files: Map<string, PagedFile>
  turnID?: string
  settled: boolean
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Record that JIT paged a file into context for this session/turn. */
function record(input: {
  sessionID: string
  turnID?: string
  path: string
}) {
  const state = getOrCreate(input.sessionID)
  state.turnID = input.turnID
  state.settled = false
  if (state.files.has(input.path)) return
  state.files.set(input.path, {
    path: input.path,
    at: Date.now(),
    touched: false,
  })
}

/** Mark a file as "touched" — the agent referenced it via a tool call. */
function touch(sessionID: string, filepath: string) {
  const state = sessionPaged().get(sessionID)
  if (!state) return
  // Normalize path for matching (could be relative or absolute)
  for (const [key, file] of state.files) {
    if (filepath.endsWith(key) || key.endsWith(filepath) || filepath === key) {
      file.touched = true
      return
    }
  }
}

/**
 * Settle a session's paged files — call at the end of a turn to flush
 * positive/negative signals to the retrieval engine.
 */
async function settle(input: {
  sessionID: string
  projectID?: string
}) {
  const state = sessionPaged().get(input.sessionID)
  if (!state || state.settled) return
  state.settled = true

  const pid = input.projectID
  if (!pid) {
    state.files.clear()
    return
  }

  const files = [...state.files.values()]
  state.files.clear()

  if (files.length === 0) return

  try {
    const { RetrievalService } = await import("@/retrieval")

    for (const file of files) {
      const score = file.touched ? 1.0 : -0.5
      const content = [
        `JIT paging outcome for ${file.path}`,
        `session_id: ${input.sessionID}`,
        `touched: ${file.touched}`,
        `score: ${score}`,
      ].join("\n")

      const fingerprint = createHash("sha1").update(content + file.at).digest("hex")
      const id = `jit-outcome-${fingerprint.slice(0, 12)}`

      await RetrievalService.upsertDocument({
        id,
        projectID: pid,
        sourceType: "jit_outcome",
        sourceID: file.path,
        title: `JIT ${file.touched ? "hit" : "miss"}: ${file.path}`,
        fingerprint,
      })

      await RetrievalService.replaceChunks({
        documentID: id,
        projectID: pid,
        content,
      })
    }

    log.debug("jit-feedback.settled", {
      sessionID: input.sessionID,
      total: files.length,
      hits: files.filter((f) => f.touched).length,
      misses: files.filter((f) => !f.touched).length,
    })
  } catch {
    return
  }
}

/**
 * Query the retrieval engine for historical utility of candidate file paths.
 * Returns a map of path → average outcome score.
 */
async function scores(input: {
  projectID: string
  paths: string[]
}): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (input.paths.length === 0) return result

  try {
    const { RetrievalService } = await import("@/retrieval")

    const query = input.paths.join(" ")
    const search = await RetrievalService.search({
      projectID: input.projectID,
      query,
      policy: "fast",
      limit: Math.min(input.paths.length * 2, 20),
      sourceTypes: ["jit_outcome"],
      metadata: { trigger: "jit_feedback_score" },
    })

    for (const candidate of search.candidates) {
      const sourcePath = candidate.sourceID
      if (!sourcePath) continue
      const existing = result.get(sourcePath) ?? 0
      const meta = candidate.metadata as Record<string, unknown> | undefined
      const score = (meta?.outcomeScore as number) ?? 0
      // Running average — simple blend
      result.set(sourcePath, existing === 0 ? score : (existing + score) / 2)
    }
  } catch {
    return result
  }

  return result
}

// ---------------------------------------------------------------------------
// Bus integration — listen for file events to auto-mark touched files
// ---------------------------------------------------------------------------

function init() {
  if (initialized) return
  initialized = true
  // When a file is edited by any tool, mark it as touched across all sessions
  Bus.subscribe(File.Event.Edited, (payload) => {
    const filepath = payload.properties.file
    if (!filepath) return
    for (const [sessionID] of sessionPaged()) {
      touch(sessionID, filepath)
    }
  })
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function getOrCreate(sessionID: string) {
  const map = sessionPaged()
  const existing = map.get(sessionID)
  if (existing) return existing
  const state: SessionPagingState = {
    files: new Map(),
    settled: false,
  }
  map.set(sessionID, state)
  return state
}

function clear(sessionID: string) {
  sessionPaged().delete(sessionID)
}

export const JitFeedback = {
  record,
  touch,
  settle,
  scores,
  init,
  clear,
} as const
