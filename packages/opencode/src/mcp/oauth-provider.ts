import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformation,
  OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { McpAuth } from "./auth"
import { Log } from "../util/log"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "@/session/schema"
import z from "zod"

const log = Log.create({ service: "mcp.oauth" })

const OAUTH_CALLBACK_PORT = 19876
const OAUTH_CALLBACK_PATH = "/mcp/oauth/callback"

export class OAuthRefreshError extends Error {
  override name = "OAuthRefreshError"

  constructor(
    message: string,
    public readonly isRetryable: boolean,
    public readonly originalError?: Error,
  ) {
    super(message)
  }
}

export const TokenRefreshFailed = BusEvent.define("mcp.token_refresh_failed", z.object({
  mcpName: z.string(),
  serverUrl: z.string().optional(),
  requiresReauth: z.boolean(),
  error: z.string(),
}))

export interface McpOAuthConfig {
  clientId?: string
  clientSecret?: string
  scope?: string
}

export interface McpOAuthCallbacks {
  onRedirect: (url: URL) => void | Promise<void>
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private mcpName: string,
    private serverUrl: string,
    private config: McpOAuthConfig,
    private callbacks: McpOAuthCallbacks,
  ) {}

  get redirectUrl(): string {
    return `http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "OpenCode",
      client_uri: "https://opencode.ai",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
    }
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    // Check config first (pre-registered client)
    if (this.config.clientId) {
      return {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }
    }

    // Check stored client info (from dynamic registration)
    // Use getForUrl to validate credentials are for the current server URL
    const entry = await McpAuth.getForUrl(this.mcpName, this.serverUrl)
    if (entry?.clientInfo) {
      // Check if client secret has expired
      if (entry.clientInfo.clientSecretExpiresAt && entry.clientInfo.clientSecretExpiresAt < Date.now() / 1000) {
        log.info("client secret expired, need to re-register", { mcpName: this.mcpName })
        return undefined
      }
      return {
        client_id: entry.clientInfo.clientId,
        client_secret: entry.clientInfo.clientSecret,
      }
    }

    // No client info or URL changed - will trigger dynamic registration
    return undefined
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await McpAuth.updateClientInfo(
      this.mcpName,
      {
        clientId: info.client_id,
        clientSecret: info.client_secret,
        clientIdIssuedAt: info.client_id_issued_at,
        clientSecretExpiresAt: info.client_secret_expires_at,
      },
      this.serverUrl,
    )
    log.info("saved dynamically registered client", {
      mcpName: this.mcpName,
      clientId: info.client_id,
    })
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    // Use getForUrl to validate tokens are for the current server URL
    const entry = await McpAuth.getForUrl(this.mcpName, this.serverUrl)
    if (!entry?.tokens) return undefined

    return {
      access_token: entry.tokens.accessToken,
      token_type: "Bearer",
      refresh_token: entry.tokens.refreshToken,
      expires_in: entry.tokens.expiresAt
        ? Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1000))
        : undefined,
      scope: entry.tokens.scope,
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await McpAuth.updateTokens(
      this.mcpName,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined,
        scope: tokens.scope,
      },
      this.serverUrl,
    )
    log.info("saved oauth tokens", { mcpName: this.mcpName })
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    log.info("redirecting to authorization", { mcpName: this.mcpName, url: authorizationUrl.toString() })
    await this.callbacks.onRedirect(authorizationUrl)
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await McpAuth.updateCodeVerifier(this.mcpName, codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    const entry = await McpAuth.get(this.mcpName)
    if (!entry?.codeVerifier) {
      throw new Error(`No code verifier saved for MCP server: ${this.mcpName}`)
    }
    return entry.codeVerifier
  }

  async saveState(state: string): Promise<void> {
    await McpAuth.updateOAuthState(this.mcpName, state)
  }

  async state(): Promise<string> {
    const entry = await McpAuth.get(this.mcpName)
    if (entry?.oauthState) {
      return entry.oauthState
    }

    // Generate a new state if none exists — the SDK calls state() as a
    // generator, not just a reader, so we need to produce a value even when
    // startAuth() hasn't pre-saved one (e.g. during automatic auth on first
    // connect).
    const newState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    await McpAuth.updateOAuthState(this.mcpName, newState)
    return newState
  }

  async invalidateCredentials(type: "all" | "client" | "tokens"): Promise<void> {
    log.info("invalidating credentials", { mcpName: this.mcpName, type })
    const entry = await McpAuth.get(this.mcpName)
    if (!entry) {
      return
    }

    switch (type) {
      case "all":
        await McpAuth.remove(this.mcpName)
        break
      case "client":
        delete entry.clientInfo
        await McpAuth.set(this.mcpName, entry)
        break
      case "tokens":
        delete entry.tokens
        await McpAuth.set(this.mcpName, entry)
        break
    }
  }

  async refreshTokenWithRetry(): Promise<void> {
    log.info("attempting token refresh", { mcpName: this.mcpName })
    try {
      await this.invalidateCredentials("tokens")
    } catch (error) {
      const isNetwork = this.isNetworkError(error as Error)
      if (isNetwork) {
        throw new OAuthRefreshError("Network error during token refresh", true, error as Error)
      }
      throw new OAuthRefreshError("Token refresh failed", false, error as Error)
    }
  }

  async handleRefreshFailure(error: Error): Promise<void> {
    const isNetwork = this.isNetworkError(error)
    const isAuth = this.isAuthError(error)
    const requiresReauth = !isNetwork

    await Bus.publish(TokenRefreshFailed, {
      mcpName: this.mcpName,
      serverUrl: this.serverUrl,
      requiresReauth,
      error: error.message,
    })

    if (requiresReauth) {
      await this.invalidateCredentials("tokens")
    }
  }

  private isNetworkError(error: Error): boolean {
    const networkPatterns = [
      "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "ECONNRESET",
      "network error", "fetch failed", "timeout", "socket hang up",
    ]
    const msg = error.message.toLowerCase()
    return networkPatterns.some((pattern) => msg.includes(pattern.toLowerCase()))
  }

  private isAuthError(error: Error): boolean {
    const authPatterns = [
      "invalid_grant", "unauthorized", "forbidden", "401", "403",
      "invalid token", "expired token", "token revoked",
    ]
    const msg = error.message.toLowerCase()
    return authPatterns.some((pattern) => msg.includes(pattern.toLowerCase()))
  }
}

export { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH }
