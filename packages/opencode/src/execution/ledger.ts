import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Lock } from "@/util/lock"

export const Phase = z.enum(["queued", "dispatched", "running", "completed", "error", "canceled", "recovered"])
export type ExecutionPhase = z.infer<typeof Phase>

export const Event = z.object({
  id: Identifier.schema("part"),
  jobID: z.string(),
  sessionID: Identifier.schema("session"),
  supervisorSessionID: Identifier.schema("session").optional(),
  kind: z.string(),
  lane: z.string(),
  priority: z.string(),
  phase: Phase,
  status: z.string(),
  description: z.string(),
  time: z.number(),
  error: z.string().optional(),
  source: z.enum(["scheduler", "task"]).optional(),
  action: z.string().optional(),
  messageID: Identifier.schema("message").optional(),
  pendingTurns: z.number().int().min(0).optional(),
  queuedTurns: z.number().int().min(0).optional(),
  paused: z.boolean().optional(),
})
export type ExecutionEvent = z.infer<typeof Event>

const LedgerBusEvent = {
  Appended: BusEvent.define(
    "execution-ledger.appended",
    z.object({
      event: Event,
    }),
  ),
}

export const ListInput = z.object({
  jobID: z.string().optional(),
  sessionID: Identifier.schema("session").optional(),
  phase: Phase.optional(),
  source: z.enum(["scheduler", "task"]).optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).optional(),
  order: z.enum(["asc", "desc"]).optional(),
})

export const TimelineInput = ListInput.extend({
  sessionID: Identifier.schema("session"),
})

const Persisted = z.object({
  version: z.literal(1),
  events: z.array(Event),
})

const MAX_LIMIT = 200

const state = Instance.state(
  () => ({
    loaded: false,
    events: [] as ExecutionEvent[],
    mtimeMs: -1,
  }),
  async (current) => {
    current.loaded = false
    current.events = []
    current.mtimeMs = -1
  },
)

function filePath() {
  return path.join(Global.Path.state, "execution-ledger.json")
}

function filterEvents(events: ExecutionEvent[], parsed: z.infer<typeof ListInput>) {
  const filtered: ExecutionEvent[] = []
    for (const event of events) {
      if (parsed.jobID && event.jobID !== parsed.jobID) continue
      if (parsed.sessionID && event.sessionID !== parsed.sessionID) continue
      if (parsed.phase && event.phase !== parsed.phase) continue
      if (parsed.source && event.source !== parsed.source) continue
      if (parsed.action && event.action !== parsed.action) continue
      filtered.push(event)
    }
    filtered.sort((a, b) => (a.time === b.time ? a.id.localeCompare(b.id) : a.time - b.time))
    if (parsed.order === "desc") filtered.reverse()
    return filtered
  }

  function hasFilters(parsed: z.infer<typeof ListInput>) {
    return !!(parsed.jobID || parsed.sessionID || parsed.phase || parsed.source || parsed.action)
  }

  async function reload() {
    const current = state()
    const target = filePath()
    const stat = await fs.stat(target).catch(() => undefined)
    const mtimeMs = stat?.mtimeMs ?? -1
    if (current.loaded && current.mtimeMs === mtimeMs) return
    const persisted = await Filesystem.readJson<z.infer<typeof Persisted>>(target).catch(() => undefined)
    current.events = persisted && Persisted.safeParse(persisted).success ? persisted.events : []
    current.loaded = true
    current.mtimeMs = mtimeMs
  }

  async function persist() {
    const target = filePath()
    await Filesystem.writeJson(target, {
      version: 1,
      events: state().events,
    } satisfies z.infer<typeof Persisted>)
    const current = state()
    current.loaded = true
    current.mtimeMs = (await fs.stat(target).catch(() => undefined))?.mtimeMs ?? -1
  }

export async function append(input: Omit<ExecutionEvent, "id"> & { id?: string }) {
  const target = filePath()
  using _ = await Lock.write(target)
  await reload()
  const event: ExecutionEvent = {
    id: input.id ?? Identifier.ascending("part"),
    jobID: input.jobID,
    sessionID: input.sessionID,
    supervisorSessionID: input.supervisorSessionID,
    kind: input.kind,
    lane: input.lane,
    priority: input.priority,
    phase: input.phase,
    status: input.status,
    description: input.description,
    time: input.time,
    error: input.error,
    source: input.source,
    action: input.action,
    messageID: input.messageID,
    pendingTurns: input.pendingTurns,
    queuedTurns: input.queuedTurns,
    paused: input.paused,
  }
  state().events.push(event)
  await persist()
  await Bus.publish(LedgerBusEvent.Appended, { event })
  return event
}

export async function list(input?: z.input<typeof ListInput>) {
  const target = filePath()
  using _ = await Lock.read(target)
  await reload()
  const parsed = ListInput.parse(input ?? {})
  if (!hasFilters(parsed)) {
    let events = [...state().events]
    if (parsed.order === "desc") events.reverse()
    if (parsed.limit !== undefined) events = events.slice(0, Math.min(parsed.limit, MAX_LIMIT))
    return events
  }
  let events = filterEvents(state().events, parsed)
  if (parsed.limit !== undefined) events = events.slice(0, Math.min(parsed.limit, MAX_LIMIT))
  return events
}

export async function query(input: z.input<typeof TimelineInput>) {
  const target = filePath()
  using _ = await Lock.read(target)
  await reload()
  const parsed = TimelineInput.parse(input)
  const filtered = filterEvents(state().events, parsed)
  return {
    sessionID: parsed.sessionID,
    total: filtered.length,
    events: parsed.limit !== undefined ? filtered.slice(0, Math.min(parsed.limit, MAX_LIMIT)) : filtered,
  }
}

export const ExecutionLedger = {
  Phase,
  Event,
  ListInput,
  TimelineInput,
  BusEvent: LedgerBusEvent,
  append,
  list,
  query,
}
