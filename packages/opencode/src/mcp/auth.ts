import path from "path"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Effect, Layer, ServiceMap } from "effect"

const TokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
})
export type Tokens = z.infer<typeof TokensSchema>

const ClientInfoSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  clientIdIssuedAt: z.number().optional(),
  clientSecretExpiresAt: z.number().optional(),
})
export type ClientInfo = z.infer<typeof ClientInfoSchema>

const EntrySchema = z.object({
  tokens: TokensSchema.optional(),
  clientInfo: ClientInfoSchema.optional(),
  codeVerifier: z.string().optional(),
  oauthState: z.string().optional(),
  serverUrl: z.string().optional(), // Track the URL these credentials are for
})
export type Entry = z.infer<typeof EntrySchema>

const filepath = path.join(Global.Path.data, "mcp-auth.json")

async function get(mcpName: string): Promise<Entry | undefined> {
  const data = await all()
  return data[mcpName]
}

  /**
   * Get auth entry and validate it's for the correct URL.
   * Returns undefined if URL has changed (credentials are invalid).
   */
async function getForUrl(mcpName: string, serverUrl: string): Promise<Entry | undefined> {
  const entry = await get(mcpName)
  if (!entry) return undefined

  // If no serverUrl is stored, this is from an old version - consider it invalid
  if (!entry.serverUrl) return undefined

  // If URL has changed, credentials are invalid
  if (entry.serverUrl !== serverUrl) return undefined

  return entry
}

async function all(): Promise<Record<string, Entry>> {
  return Filesystem.readJson<Record<string, Entry>>(filepath).catch(() => ({}))
}

async function set(mcpName: string, entry: Entry, serverUrl?: string): Promise<void> {
  const data = await all()
  // Always update serverUrl if provided
  if (serverUrl) {
    entry.serverUrl = serverUrl
  }
  await Filesystem.writeJson(filepath, { ...data, [mcpName]: entry }, 0o600)
}

async function remove(mcpName: string): Promise<void> {
  const data = await all()
  delete data[mcpName]
  await Filesystem.writeJson(filepath, data, 0o600)
}

async function updateTokens(mcpName: string, tokens: Tokens, serverUrl?: string): Promise<void> {
  const entry = (await get(mcpName)) ?? {}
  entry.tokens = tokens
  await set(mcpName, entry, serverUrl)
}

async function updateClientInfo(mcpName: string, clientInfo: ClientInfo, serverUrl?: string): Promise<void> {
  const entry = (await get(mcpName)) ?? {}
  entry.clientInfo = clientInfo
  await set(mcpName, entry, serverUrl)
}

async function updateCodeVerifier(mcpName: string, codeVerifier: string): Promise<void> {
  const entry = (await get(mcpName)) ?? {}
  entry.codeVerifier = codeVerifier
  await set(mcpName, entry)
}

async function clearCodeVerifier(mcpName: string): Promise<void> {
  const entry = await get(mcpName)
  if (entry) {
    delete entry.codeVerifier
    await set(mcpName, entry)
  }
}

async function updateOAuthState(mcpName: string, oauthState: string): Promise<void> {
  const entry = (await get(mcpName)) ?? {}
  entry.oauthState = oauthState
  await set(mcpName, entry)
}

async function getOAuthState(mcpName: string): Promise<string | undefined> {
  const entry = await get(mcpName)
  return entry?.oauthState
}

async function clearOAuthState(mcpName: string): Promise<void> {
  const entry = await get(mcpName)
  if (entry) {
    delete entry.oauthState
    await set(mcpName, entry)
  }
}

  /**
   * Check if stored tokens are expired.
   * Returns null if no tokens exist, false if no expiry or not expired, true if expired.
   */
async function isTokenExpired(mcpName: string): Promise<boolean | null> {
  const entry = await get(mcpName)
  if (!entry?.tokens) return null
  if (!entry.tokens.expiresAt) return false
  return entry.tokens.expiresAt < Date.now() / 1000
}

export interface Interface {
  readonly get: (mcpName: string) => Effect.Effect<Entry | undefined>
  readonly getForUrl: (mcpName: string, serverUrl: string) => Effect.Effect<Entry | undefined>
  readonly remove: (mcpName: string) => Effect.Effect<void>
  readonly updateOAuthState: (mcpName: string, state: string) => Effect.Effect<void>
  readonly getOAuthState: (mcpName: string) => Effect.Effect<string | undefined>
  readonly clearOAuthState: (mcpName: string) => Effect.Effect<void>
  readonly clearCodeVerifier: (mcpName: string) => Effect.Effect<void>
  readonly isTokenExpired: (mcpName: string) => Effect.Effect<boolean | null>
}

export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/McpAuth") {}

export const layer: Layer.Layer<Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const get_ = Effect.fn("McpAuth.get")(function* (mcpName: string) {
      return yield* Effect.promise(() => get(mcpName))
    })

    const getForUrl_ = Effect.fn("McpAuth.getForUrl")(function* (mcpName: string, serverUrl: string) {
      return yield* Effect.promise(() => getForUrl(mcpName, serverUrl))
    })

    const remove_ = Effect.fn("McpAuth.remove")(function* (mcpName: string) {
      yield* Effect.promise(() => remove(mcpName))
    })

    const updateOAuthState_ = Effect.fn("McpAuth.updateOAuthState")(function* (mcpName: string, state: string) {
      yield* Effect.promise(() => updateOAuthState(mcpName, state))
    })

    const getOAuthState_ = Effect.fn("McpAuth.getOAuthState")(function* (mcpName: string) {
      return yield* Effect.promise(() => getOAuthState(mcpName))
    })

    const clearOAuthState_ = Effect.fn("McpAuth.clearOAuthState")(function* (mcpName: string) {
      yield* Effect.promise(() => clearOAuthState(mcpName))
    })

    const clearCodeVerifier_ = Effect.fn("McpAuth.clearCodeVerifier")(function* (mcpName: string) {
      yield* Effect.promise(() => clearCodeVerifier(mcpName))
    })

    const isTokenExpired_ = Effect.fn("McpAuth.isTokenExpired")(function* (mcpName: string) {
      return yield* Effect.promise(() => isTokenExpired(mcpName))
    })

    return Service.of({
      get: get_,
      getForUrl: getForUrl_,
      remove: remove_,
      updateOAuthState: updateOAuthState_,
      getOAuthState: getOAuthState_,
      clearOAuthState: clearOAuthState_,
      clearCodeVerifier: clearCodeVerifier_,
      isTokenExpired: isTokenExpired_,
    })
  }),
)

export const defaultLayer = layer

export type McpAuthType = {
  Tokens: typeof TokensSchema
  ClientInfo: typeof ClientInfoSchema
  Entry: typeof EntrySchema
  get: typeof get
  getForUrl: typeof getForUrl
  all: typeof all
  set: typeof set
  remove: typeof remove
  updateTokens: typeof updateTokens
  updateClientInfo: typeof updateClientInfo
  updateCodeVerifier: typeof updateCodeVerifier
  clearCodeVerifier: typeof clearCodeVerifier
  updateOAuthState: typeof updateOAuthState
  getOAuthState: typeof getOAuthState
  clearOAuthState: typeof clearOAuthState
  isTokenExpired: typeof isTokenExpired
  Service: typeof Service
  layer: typeof layer
  defaultLayer: typeof defaultLayer
}

export const McpAuth: McpAuthType = {
  Tokens: TokensSchema,
  ClientInfo: ClientInfoSchema,
  Entry: EntrySchema,
  get,
  getForUrl,
  all,
  set,
  remove,
  updateTokens,
  updateClientInfo,
  updateCodeVerifier,
  clearCodeVerifier,
  updateOAuthState,
  getOAuthState,
  clearOAuthState,
  isTokenExpired,
  Service,
  layer,
  defaultLayer,
}
