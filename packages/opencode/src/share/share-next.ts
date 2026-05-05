import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { ulid } from "ulid"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Database, eq } from "@/storage/db"
import { SessionShareTable } from "./share.sql"
import { Log } from "@/util/log"
import type * as SDK from "@opencode-ai/sdk/v2"

const log = Log.create({ service: "share-next" })

const disabled =
  process.env["OPENCODE_DISABLE_SHARE"] === "true" || process.env["OPENCODE_DISABLE_SHARE"] === "1"

type Data =
  | {
      type: "session"
      data: SDK.Session
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

async function url() {
  const cfg = await Config.get()
  return cfg.enterprise?.url ?? "https://opncd.ai"
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

function get(sessionID: string) {
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
      existing.data.set("id" in item ? (item.id as string) : ulid(), item)
    }
    return
  }

  const dataMap = new Map<string, Data>()
  for (const item of data) {
    dataMap.set("id" in item ? (item.id as string) : ulid(), item)
  }

  const timeout = setTimeout(() => {
    const queued = queue.get(sessionID)
    if (!queued) return
    queue.delete(sessionID)
    const share = get(sessionID)
    if (!share) return

    const payload = Array.from(queued.data.values())
    void sendSessionSync(share, payload)
  }, 1000)
  queue.set(sessionID, { timeout, data: dataMap })
}

async function fullSync(sessionID: string) {
  log.info("full sync", { sessionID })
  const session = Session.get(sessionID)
  const diffs = await Session.diff(sessionID)
  const messages = await Array.fromAsync(MessageV2.stream(sessionID))
  const models = await Promise.all(
    messages
      .filter((message) => message.info.role === "user")
      .map((message) => (message.info as SDK.UserMessage).model)
      .map((messageModel) => Provider.getModel(messageModel.providerID, messageModel.modelID)),
  )
  sync(sessionID, [
    {
      type: "session",
      data: session,
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

async function create(sessionID: string) {
  if (disabled) return { id: "", url: "", secret: "" }
  log.info("creating share", { sessionID })
  const result = await fetch(`${await url()}/api/share`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionID: sessionID }),
  })
    .then((x) => x.json())
    .then((x) => x as { id: string; url: string; secret: string })
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
  void fullSync(sessionID)
  return result
}

async function remove(sessionID: string) {
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
    void sync(evt.properties.info.id, [
      {
        type: "session",
        data: evt.properties.info,
      },
    ])
  })
  Bus.subscribe(MessageV2.Event.Updated, (evt) => {
    void sync(evt.properties.info.sessionID, [
      {
        type: "message",
        data: evt.properties.info,
      },
    ])
    if (evt.properties.info.role === "user") {
      void Provider.getModel(evt.properties.info.model.providerID, evt.properties.info.model.modelID)
        .then((model) =>
          sync(evt.properties.info.sessionID, [
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
    void sync(evt.properties.part.sessionID, [
      {
        type: "part",
        data: evt.properties.part,
      },
    ])
  })
  Bus.subscribe(Session.Event.Diff, (evt) => {
    void sync(evt.properties.sessionID, [
      {
        type: "session_diff",
        data: evt.properties.diff,
      },
    ])
  })
}

export const ShareNext = {
  url,
  init,
  create,
  remove,
}
