import { NodeFileSystem } from "@effect/platform-node"
import { afterEach, beforeEach, describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"

import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session"
import type { SessionID } from "../../src/session/schema"
import { ShareNext } from "../../src/share/share-next"
import { SessionShareTable } from "../../src/share/share.sql"
import { Database, eq } from "../../src/storage/db"
import { provideTmpdirInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"

const env = Layer.mergeAll(
  Bus.layer,
  Session.defaultLayer,
  NodeFileSystem.layer,
  CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env as unknown as Layer.Layer<any, any, never>)

const originalFetch = globalThis.fetch

type SeenRequest = {
  method: string
  url: string
  body?: string
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const share = (id: SessionID) =>
  Database.use((db) => db.select().from(SessionShareTable).where(eq(SessionShareTable.session_id, id)).get())

function mockFetch(handler: (request: Request) => Response | Promise<Response>) {
  globalThis.fetch = ((input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    return Promise.resolve(handler(request))
  }) as typeof fetch
}

beforeEach(async () => {
  globalThis.fetch = originalFetch
  await resetDatabase()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("ShareNext", () => {
  it.live("request uses legacy share API without active org account", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const req = yield* Effect.promise(() => ShareNext.request())

          expect(req.api.create).toBe("/api/share")
          expect(req.api.sync("shr_123")).toBe("/api/share/shr_123/sync")
          expect(req.api.remove("shr_123")).toBe("/api/share/shr_123")
          expect(req.api.data("shr_123")).toBe("/api/share/shr_123/data")
          expect(req.baseUrl).toBe("https://legacy-share.example.com")
          expect(req.headers).toEqual({})
        }),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("request uses default URL when no enterprise config", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const req = yield* Effect.promise(() => ShareNext.request())

        expect(req.baseUrl).toBe("https://opncd.ai")
        expect(req.api.create).toBe("/api/share")
        expect(req.headers).toEqual({})
      }),
    ),
  )

  it.live("create posts share, persists it, and returns the result", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const session = yield* Session.Service.use((svc) => svc.create({ title: "test" }))
          const seen: SeenRequest[] = []

          mockFetch(async (request) => {
            seen.push({
              method: request.method,
              url: request.url,
              body: request.body ? await request.text() : undefined,
            })
            if (request.url.endsWith("/api/share")) {
              return json({
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              })
            }
            return json({ ok: true })
          })

          const result = yield* Effect.promise(() => ShareNext.create(session.id))

          expect(result.id).toBe("shr_abc")
          expect(result.url).toBe("https://legacy-share.example.com/share/abc")
          expect(result.secret).toBe("sec_123")

          const row = share(session.id)
          expect(row?.id).toBe("shr_abc")
          expect(row?.url).toBe("https://legacy-share.example.com/share/abc")
          expect(row?.secret).toBe("sec_123")

          expect(seen[0]).toMatchObject({
            method: "POST",
            url: "https://legacy-share.example.com/api/share",
          })
        }),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("remove deletes the persisted share and calls the delete endpoint", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const session = yield* Session.Service.use((svc) => svc.create({ title: "test" }))
          const seen: SeenRequest[] = []

          mockFetch(async (request) => {
            seen.push({
              method: request.method,
              url: request.url,
              body: request.body ? await request.text() : undefined,
            })
            if (request.method === "POST") {
              return json({
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              })
            }
            return new Response(null, { status: 200 })
          })

          yield* Effect.promise(() => ShareNext.create(session.id))
          yield* Effect.promise(() => ShareNext.remove(session.id))

          expect(share(session.id)).toBeUndefined()
          expect(seen.map((req) => [req.method, req.url])).toContainEqual([
            "POST",
            "https://legacy-share.example.com/api/share",
          ])
          expect(seen.map((req) => [req.method, req.url])).toContainEqual([
            "DELETE",
            "https://legacy-share.example.com/api/share/shr_abc",
          ])
        }),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("create fails on a non-ok response and does not persist a share", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service.use((svc) => svc.create({ title: "test" }))
        mockFetch(() => json({ error: "bad" }, 500))

        const exit = yield* Effect.exit(Effect.promise(() => ShareNext.create(session.id)))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(share(session.id)).toBeUndefined()
      }),
    ),
  )

  it.live("ShareNext coalesces rapid diff events into one delayed sync with latest data", () =>
    provideTmpdirInstance(
      () => {
        const seen: Array<{ url: string; body: string }> = []
        mockFetch(async (request) => {
          if (request.url.endsWith("/sync")) {
            seen.push({ url: request.url, body: await request.text() })
          }
          return json({ ok: true })
        })

        return Effect.gen(function* () {
          const bus = yield* Bus.Service
          const session = yield* Session.Service

          const info = yield* session.create({ title: "first" })
          ShareNext.init()
          yield* Effect.sleep(50)
          yield* Effect.sync(() =>
            Database.use((db) =>
              db
                .insert(SessionShareTable)
                .values({
                  session_id: info.id,
                  id: "shr_abc",
                  url: "https://legacy-share.example.com/share/abc",
                  secret: "sec_123",
                })
                .run(),
            ),
          )

          yield* bus.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [
              {
                file: "a.ts",
                before: "one",
                after: "two",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          })
          yield* bus.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [
              {
                file: "b.ts",
                before: "old",
                after: "new",
                additions: 2,
                deletions: 0,
                status: "modified",
              },
            ],
          })
          yield* Effect.sleep(1_250)

          expect(seen).toHaveLength(1)
          expect(seen[0].url).toBe("https://legacy-share.example.com/api/share/shr_abc/sync")

          const body = JSON.parse(seen[0].body) as {
            secret: string
            data: Array<{
              type: string
              data: Array<{
                file: string
                before: string
                after: string
                additions: number
                deletions: number
                status?: string
              }>
            }>
          }
          expect(body.secret).toBe("sec_123")
          const diff = body.data.find((item) => item.type === "session_diff")
          expect(diff).toBeDefined()
          expect(diff?.data).toEqual([
            {
              file: "b.ts",
              before: "old",
              after: "new",
              additions: 2,
              deletions: 0,
              status: "modified",
            },
          ])
        })
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )
})
