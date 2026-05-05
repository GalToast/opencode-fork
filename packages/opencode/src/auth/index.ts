import path from "path"
import { Global } from "../global"
import z from "zod"
import { Filesystem } from "../util/filesystem"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

// Define schemas first
const OauthSchema = z
  .object({
    type: z.literal("oauth"),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
    accountId: z.string().optional(),
    enterpriseUrl: z.string().optional(),
  })
  .meta({ ref: "OAuth" })

const ApiSchema = z
  .object({
    type: z.literal("api"),
    key: z.string(),
  })
  .meta({ ref: "ApiAuth" })

const WellKnownSchema = z
  .object({
    type: z.literal("wellknown"),
    key: z.string(),
    token: z.string(),
  })
  .meta({ ref: "WellKnownAuth" })

const InfoSchema = z.discriminatedUnion("type", [OauthSchema, ApiSchema, WellKnownSchema]).meta({ ref: "Auth" })

// Infer types from schemas (after schemas are defined)
export type AuthInfo = z.infer<typeof InfoSchema>
type OauthData = z.infer<typeof OauthSchema>
type ApiData = z.infer<typeof ApiSchema>
type WellKnownData = z.infer<typeof WellKnownSchema>

const filepath = path.join(Global.Path.data, "auth.json")

async function doGet(providerID: string): Promise<AuthInfo | undefined> {
  const auth = await doAll()
  return auth[providerID]
}

async function doAll(): Promise<Record<string, AuthInfo>> {
  const data = await Filesystem.readJson<Record<string, unknown>>(filepath).catch(() => ({}))
  return Object.entries(data).reduce(
    (acc, [key, value]) => {
      const parsed = InfoSchema.safeParse(value)
      if (!parsed.success) return acc
      acc[key] = parsed.data
      return acc
    },
    {} as Record<string, AuthInfo>,
  )
}

async function doSet(key: string, info: AuthInfo): Promise<void> {
  const normalized = key.replace(/\/+$/, "")
  const data = await doAll()
  if (normalized !== key) delete data[key]
  delete data[normalized + "/"]
  await Filesystem.writeJson(filepath, { ...data, [normalized]: info }, 0o600)
}

async function doRemove(key: string): Promise<void> {
  const normalized = key.replace(/\/+$/, "")
  const data = await doAll()
  delete data[key]
  delete data[normalized]
  await Filesystem.writeJson(filepath, data, 0o600)
}

export namespace Auth {
  export const Oauth = OauthSchema
  export const Api = ApiSchema
  export const WellKnown = WellKnownSchema
  export const Info = InfoSchema

  export interface Interface {
    readonly get: (providerID: string) => Effect.Effect<AuthInfo | undefined>
    readonly all: () => Effect.Effect<Record<string, AuthInfo>>
    readonly set: (key: string, info: AuthInfo) => Effect.Effect<void>
    readonly remove: (key: string) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Auth") {}

  export const layer: Layer.Layer<Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const get_ = Effect.fn("Auth.get")(function* (providerID: string) {
        return yield* Effect.promise(() => doGet(providerID))
      })

      const all_ = Effect.fn("Auth.all")(function* () {
        return yield* Effect.promise(() => doAll())
      })

      const set_ = Effect.fn("Auth.set")(function* (key: string, info: AuthInfo) {
        yield* Effect.promise(() => doSet(key, info))
      })

      const remove_ = Effect.fn("Auth.remove")(function* (key: string) {
        yield* Effect.promise(() => doRemove(key))
      })

      return Service.of({
        get: get_,
        all: all_,
        set: set_,
        remove: remove_,
      })
    }),
  )

  export const defaultLayer = layer

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function get(providerID: string): Promise<AuthInfo | undefined> {
    return runPromise((svc) => svc.get(providerID))
  }

  export async function all(): Promise<Record<string, AuthInfo>> {
    return runPromise((svc) => svc.all())
  }

  export async function set(key: string, info: AuthInfo): Promise<void> {
    return runPromise((svc) => svc.set(key, info))
  }

  export async function remove(key: string): Promise<void> {
    return runPromise((svc) => svc.remove(key))
  }
}
