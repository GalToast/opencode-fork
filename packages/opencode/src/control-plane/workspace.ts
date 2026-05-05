import z from "zod"
import { Identifier } from "@/id/id"
import { fn } from "@/util/fn"
import { Database, eq } from "@/storage/db"
import type { Project } from "@/project/project"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Log } from "@/util/log"
import { WorkspaceTable } from "@/storage/schema"
import { WorkspaceID } from "./schema"
import type { ProjectID } from "@/project/schema"
import { getAdaptor } from "./adaptors"
import { WorkspaceInfoSchema } from "./types"
import { parseSSE } from "./sse"

const Event = {
  Ready: BusEvent.define(
    "workspace.ready",
    z.object({
      name: z.string(),
    }),
  ),
  Failed: BusEvent.define(
    "workspace.failed",
    z.object({
      message: z.string(),
    }),
  ),
}

const Info = WorkspaceInfoSchema.meta({
  ref: "Workspace",
})
type WorkspaceInfoData = z.infer<typeof Info>
type WorkspaceRow = typeof WorkspaceTable.$inferSelect

function fromRow(row: typeof WorkspaceTable.$inferSelect): WorkspaceInfoData {
  return {
    id: row.id,
    type: row.type,
    branch: row.branch,
    name: row.name,
    directory: row.directory,
    extra: row.extra,
    projectID: row.project_id,
  }
}

const CreateInput = z.object({
  id: Identifier.schema("workspace").optional(),
  type: WorkspaceInfoSchema.shape.type,
  branch: WorkspaceInfoSchema.shape.branch,
  projectID: WorkspaceInfoSchema.shape.projectID,
  extra: WorkspaceInfoSchema.shape.extra,
})

const create = fn(CreateInput, async (input: z.infer<typeof CreateInput>) => {
  const id = Identifier.ascending("workspace", input.id)
  const adaptor = await getAdaptor(input.type)

  const config = WorkspaceInfoSchema.parse({
    ...input,
    id,
    name: null,
    directory: null,
  })
  const resolved = await adaptor.configure(config)
  const info = WorkspaceInfoSchema.parse(resolved)

  Database.use((db) => {
    db.insert(WorkspaceTable)
      .values({
        id: WorkspaceID.make(info.id),
        type: info.type,
        branch: info.branch,
        name: info.name,
        directory: info.directory,
        extra: info.extra,
        project_id: info.projectID as ProjectID,
      })
      .run()
  })

  await adaptor.create(info)
  return info
})

function list(project: Project.Info) {
  const rows = Database.use((db): WorkspaceRow[] =>
    db.select().from(WorkspaceTable).where(eq(WorkspaceTable.project_id, project.id as ProjectID)).all(),
  )
  return rows.map(fromRow).sort((a, b) => a.id.localeCompare(b.id))
}

const get = fn(Identifier.schema("workspace"), (id) => {
  const row = Database.use((db): WorkspaceRow | undefined =>
    db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, WorkspaceID.make(id))).get(),
  )
  if (!row) return
  return fromRow(row)
})

const remove = fn(Identifier.schema("workspace"), async (id) => {
  const row = Database.use((db): WorkspaceRow | undefined =>
    db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, WorkspaceID.make(id))).get(),
  )
  if (row) {
    const info = fromRow(row)
    const adaptor = await getAdaptor(row.type)
    await adaptor.remove(info)
    Database.use((db) => db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, WorkspaceID.make(id))).run())
    return info
  }
})
const log = Log.create({ service: "workspace-sync" })

async function workspaceEventLoop(space: WorkspaceInfoData, stop: AbortSignal) {
  while (!stop.aborted) {
    const adaptor = await getAdaptor(space.type)
    const res = await adaptor.fetch(space, "/event", { method: "GET", signal: stop }).catch(() => undefined)
    if (!res || !res.ok || !res.body) {
      await Bun.sleep(1000)
      continue
    }
    await parseSSE(res.body, stop, (event) => {
      GlobalBus.emit("event", {
        directory: space.id,
        payload: event,
      })
    })
    // Wait 250ms and retry if SSE connection fails
    await Bun.sleep(250)
  }
}

function startSyncing(project: Project.Info) {
  const stop = new AbortController()
  const spaces = list(project).filter((space) => space.type !== "worktree")

  spaces.forEach((space) => {
    void workspaceEventLoop(space, stop.signal).catch((error) => {
      log.warn("workspace sync listener failed", {
        workspaceID: space.id,
        error,
      })
    })
  })

  return {
    stop() {
      stop.abort()
    },
  }
}

export const Workspace = {
  Event,
  Info,
  create,
  list,
  get,
  remove,
  startSyncing,
}
