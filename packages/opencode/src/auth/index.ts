import path from "path"
import { Global } from "../global"
import z from "zod"
import { Filesystem } from "../util/filesystem"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const Oauth = z
  .object({
    type: z.literal("oauth"),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
    accountId: z.string().optional(),
    enterpriseUrl: z.string().optional(),
  })
  .meta({ ref: "OAuth" })

const Api = z
  .object({
    type: z.literal("api"),
    key: z.string(),
  })
  .meta({ ref: "ApiAuth" })

const WellKnown = z
  .object({
    type: z.literal("wellknown"),
    key: z.string(),
    token: z.string(),
  })
  .meta({ ref: "WellKnownAuth" })

const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
type AuthInfoValue = z.infer<typeof Info>

const filepath = path.join(Global.Path.data, "auth.json")

async function get(providerID: string) {
  const auth = await all()
  return auth[providerID]
}

async function all(): Promise<Record<string, AuthInfoValue>> {
  const data = await Filesystem.readJson<Record<string, unknown>>(filepath).catch(() => ({}))
  return Object.entries(data).reduce(
    (acc, [key, value]) => {
      const parsed = Info.safeParse(value)
      if (!parsed.success) return acc
      acc[key] = parsed.data
      return acc
    },
    {} as Record<string, AuthInfoValue>,
  )
}

async function set(key: string, info: AuthInfoValue) {
  const normalized = key.replace(/\/+$/, "")
  const data = await all()
  if (normalized !== key) delete data[key]
  delete data[normalized + "/"]
  await Filesystem.writeJson(filepath, { ...data, [normalized]: info }, 0o600)
}

async function remove(key: string) {
  const normalized = key.replace(/\/+$/, "")
  const data = await all()
  delete data[key]
  delete data[normalized]
  await Filesystem.writeJson(filepath, data, 0o600)
}

export const Auth = {
  Oauth,
  Api,
  WellKnown,
  Info,
  get,
  all,
  set,
  remove,
}

export type AuthInfo = z.infer<typeof Info>
