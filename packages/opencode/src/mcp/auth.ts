import path from "path"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

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

export const McpAuth = {
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
}
