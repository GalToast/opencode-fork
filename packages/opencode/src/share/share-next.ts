import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Database, eq } from "@/storage/db"
import { SessionShareTable } from "./share.sql"
import { Log } from "@/util/log"
import type * as SDK from "@opencode-ai/sdk/v2"
import type { SessionID } from "@/session/schema"
import { ProviderID, ModelID } from "@/provider/schema"

const log = Log.create({ service: "share-next" })

const disabled =
  process.env["OPENCODE_DISABLE_SHARE"] === "true" || process.env["OPENCODE_DISABLE_SHARE"] === "1"

/** Session data shape sent to the share API (superset of SDK.Session with required fields) */
type ShareSession = {
  id: string
  title: string
  slug: string
  projectID: string
  directory: string
  version: string
  time: {
    created: number
    updated: number
  }
}

type Data =
  | {
      type: "session"
      data: ShareSession
    }
  | {
      type: "message"
      data: SDK.Message
    }
  | {
      type: "part"
      data: SDK.Part
    }
  | {
      type: "session_diff"
      data: SDK.FileDiff[]
    }
  | {
      type: "model"
      data: SDK.Model[]
    }

const queue = new Map<string, { timeout: NodeJS.Timeout; data: Map<string, Data> }>()

function dataKey(item: Data) {
  switch (item.type) {
    case "session":
      return `session:${item.data.id}`
    case "message":
      return `message:${item.data.id}`
    case "part":
      return `part:${item.data.id}`
    case "session_diff":
      return "session_diff"
    case "model":
      return "model"
  }
}

async function url() {
  const cfg = await Config.get()
  return cfg.enterprise?.url ?? "https://opncd.ai"
}

async function request() {
  const baseUrl = await url()
  return {
    baseUrl,
    headers: {} as Record<string, string>,
    api: {
      create: "/api/share",
      sync: (id: string) => `/api/share/${id}/sync`,
      remove: (id: string) => `/api/share/${id}`,
      data: (id: string) => `/api/share/${id}/data`,
    },
  }
}

async function sendSessionSync(
  share: {
    id: string
    secret: string
  },
  data: Data[],
) {
  await fetch(`${await url()}/api/share/${share.id}/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      secret: share.secret,
      data,
    }),
  })
}

function get(sessionID: SessionID) {
  const row = Database.use((db) =>
    db.select().from(SessionShareTable).where(eq(SessionShareTable.session_id, sessionID)).get(),
  )
  if (!row) return
  return { id: row.id, secret: row.secret, url: row.url }
}

function sync(sessionID: string, data: Data[]) {
  if (disabled) return
  const existing = queue.get(sessionID)
  if (existing) {
    for (const item of data) {
      existing.data.set(dataKey(item), item)
    }
    return
  }

  const dataMap = new Map<string, Data>()
  for (const item of data) {
    dataMap.set(dataKey(item), item)
  }

  const timeout = setTimeout(() => {
    const queued = queue.get(sessionID)
    if (!queued) return
    queue.delete(sessionID)
    const share = get(sessionID as SessionID)
    if (!share) return

    const payload = Array.from(queued.data.values())
    void sendSessionSync(share, payload)
  }, 1000)
  queue.set(sessionID, { timeout, data: dataMap })
}

async function fullSync(sessionID: SessionID) {
  log.info("full sync", { sessionID })
  const session = await Session.get(sessionID)
  const diffs = await Session.diff(sessionID)
  const messages = await Array.fromAsync(MessageV2.stream(sessionID))
  const models = await Promise.all(
    messages
      .filter((message) => message.info.role === "user")
      .map((message) => (message.info as SDK.UserMessage).model)
      .map((messageModel) => Provider.getModel(messageModel.providerID as ProviderID, messageModel.modelID as ModelID)),
  )
  const sessionInfo: ShareSession = {
    id: session.id,
    title: session.title,
    slug: session.slug,
    projectID: session.projectID,
    directory: session.directory,
    version: session.version,
    time: session.time,
  }
  sync(sessionID, [
    {
      type: "session",
      data: sessionInfo,
    },
    ...messages.map((message) => ({
      type: "message" as const,
      data: message.info,
    })),
    ...messages.flatMap((message) => message.parts.map((part) => ({ type: "part" as const, data: part }))),
    {
      type: "session_diff",
      data: diffs,
    },
    {
      type: "model",
      data: models,
    },
  ])
}

async function create(sessionID: SessionID) {
  if (disabled) return { id: "", url: "", secret: "" }
  log.info("creating share", { sessionID })
  const response = await fetch(`${await url()}/api/share`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionID: sessionID }),
  })
  if (!response.ok) throw new Error(`Failed to create share: ${response.status}`)
  const result = (await response.json()) as { id: string; url: string; secret: string }
  Database.use((db) =>
    db
      .insert(SessionShareTable)
      .values({ session_id: sessionID, id: result.id, secret: result.secret, url: result.url })
      .onConflictDoUpdate({
        target: SessionShareTable.session_id,
        set: { id: result.id, secret: result.secret, url: result.url },
      })
      .run(),
  )
  void fullSync(sessionID).catch((error) => {
    log.warn("failed to run share full sync", { error, sessionID })
  })
  return result
}

async function remove(sessionID: SessionID) {
  if (disabled) return
  log.info("removing share", { sessionID })
  const share = get(sessionID)
  if (!share) return
  await fetch(`${await url()}/api/share/${share.id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      secret: share.secret,
    }),
  })
  Database.use((db) => db.delete(SessionShareTable).where(eq(SessionShareTable.session_id, sessionID)).run())
}

function init() {
  if (disabled) return
  Bus.subscribe(Session.Event.Updated, (evt) => {
    void sync(evt.properties.info.id as SessionID, [
      {
        type: "session",
        data: evt.properties.info as unknown as ShareSession,
      },
    ])
  })
  Bus.subscribe(MessageV2.Event.Updated, (evt) => {
    void sync(evt.properties.info.sessionID as SessionID, [
      {
        type: "message",
        data: evt.properties.info,
      },
    ])
    if (evt.properties.info.role === "user") {
      void Provider.getModel(evt.properties.info.model.providerID as ProviderID, evt.properties.info.model.modelID)
        .then((model) =>
          sync(evt.properties.info.sessionID as SessionID, [
            {
              type: "model",
              data: [model],
            },
          ]),
        )
        .catch(() => {
          return
        })
    }
  })
  Bus.subscribe(MessageV2.Event.PartUpdated, (evt) => {
    void sync(evt.properties.part.sessionID as SessionID, [
      {
        type: "part",
        data: evt.properties.part,
      },
    ])
  })
  Bus.subscribe(Session.Event.Diff, (evt) => {
    void sync(evt.properties.sessionID as SessionID, [
      {
        type: "session_diff",
        data: evt.properties.diff,
      },
    ])
  })
}

export const ShareNext = {
  url,
  request,
  init,
  create,
  remove,
}

/** Session data shape sent to/from the share API */
export type { ShareSession }
