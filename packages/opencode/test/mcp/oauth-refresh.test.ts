import { test, expect, mock } from "bun:test"
import { McpOAuthProvider, OAuthRefreshError, TokenRefreshFailed } from "../../src/mcp/oauth-provider"
import { McpAuth } from "../../src/mcp/auth"
import { Bus } from "../../src/bus"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

const mockOnRedirect = mock(async (url: URL) => {})

test("tokens() returns stored tokens", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-oauth": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.updateTokens(
        "test-oauth",
        {
          accessToken: "test-access-token",
          refreshToken: "test-refresh-token",
          expiresAt: Date.now() / 1000 + 3600,
          scope: "read write",
        },
        "https://example.com/mcp",
      )

      const provider = new McpOAuthProvider("test-oauth", "https://example.com/mcp", {}, { onRedirect: mockOnRedirect })
      const tokens = await provider.tokens()

      expect(tokens).toBeDefined()
      expect(tokens?.access_token).toBe("test-access-token")
      expect(tokens?.refresh_token).toBe("test-refresh-token")
      expect(tokens?.token_type).toBe("Bearer")
      expect(tokens?.scope).toBe("read write")
    },
  })
})

test("tokens() returns undefined when no tokens stored", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-oauth-no-tokens": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-oauth-no-tokens",
        "https://example.com/mcp",
        {},
        { onRedirect: mockOnRedirect },
      )
      const tokens = await provider.tokens()

      expect(tokens).toBeUndefined()
    },
  })
})

test("tokens() returns undefined when no tokens stored", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-oauth-no-tokens": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-oauth-no-tokens",
        "https://example.com/mcp",
        {},
        { onRedirect: mockOnRedirect },
      )
      const tokens = await provider.tokens()

      expect(tokens).toBeUndefined()
    },
  })
})

test("refreshTokenWithRetry succeeds when tokens are available", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-oauth-refresh": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let refreshEventPublished: any = null
      const unsubscribe = Bus.subscribe(TokenRefreshFailed, (evt) => {
        refreshEventPublished = evt.properties
      })

      try {
        await McpAuth.updateTokens(
          "test-oauth-refresh",
          {
            accessToken: "valid-access-token",
            refreshToken: "valid-refresh-token",
            expiresAt: Date.now() / 1000 + 3600,
          },
          "https://example.com/mcp",
        )

        const provider = new McpOAuthProvider(
          "test-oauth-refresh",
          "https://example.com/mcp",
          {},
          { onRedirect: mockOnRedirect },
        )
        const tokens = await provider.refreshTokenWithRetry()

        expect(tokens).toBeDefined()
        // @ts-ignore
        expect(tokens?.refresh_token).toBe("valid-refresh-token")
        expect(refreshEventPublished).toBeNull()
      } finally {
        unsubscribe()
      }
    },
  })
})

test("refreshTokenWithRetry returns undefined when no refresh token available", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-oauth-no-refresh": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-oauth-no-refresh",
        "https://example.com/mcp",
        {},
        { onRedirect: mockOnRedirect },
      )
      const tokens = await provider.refreshTokenWithRetry()

      expect(tokens).toBeUndefined()
    },
  })
})

test("handleRefreshFailure invalidates tokens on auth error", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-oauth-auth-error": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let refreshEventPublished: any = null
      const unsubscribe = Bus.subscribe(TokenRefreshFailed, (evt) => {
        refreshEventPublished = evt.properties
      })

      try {
        await McpAuth.updateTokens(
          "test-oauth-auth-error",
          {
            accessToken: "test-access",
            refreshToken: "test-refresh",
            expiresAt: Date.now() / 1000 + 3600,
          },
          "https://example.com/mcp",
        )

        const provider = new McpOAuthProvider(
          "test-oauth-auth-error",
          "https://example.com/mcp",
          {},
          { onRedirect: mockOnRedirect },
        )

        const authError = new Error("invalid_grant: Token has been revoked")
        await provider.handleRefreshFailure(authError)

        const entry = await McpAuth.get("test-oauth-auth-error")
        expect(entry?.tokens).toBeUndefined()
        expect(refreshEventPublished).not.toBeNull()
        expect(refreshEventPublished?.requiresReauth).toBe(true)
      } finally {
        unsubscribe()
      }
    },
  })
})

test("handleRefreshFailure keeps tokens on network error", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-oauth-network-error": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let refreshEventPublished: any = null
      const unsubscribe = Bus.subscribe(TokenRefreshFailed, (evt) => {
        refreshEventPublished = evt.properties
      })

      try {
        await McpAuth.updateTokens(
          "test-oauth-network-error",
          {
            accessToken: "test-access",
            refreshToken: "test-refresh",
            expiresAt: Date.now() / 1000 + 3600,
          },
          "https://example.com/mcp",
        )

        const provider = new McpOAuthProvider(
          "test-oauth-network-error",
          "https://example.com/mcp",
          {},
          { onRedirect: mockOnRedirect },
        )

        const networkError = new Error("ETIMEDOUT: Connection timed out")
        await provider.handleRefreshFailure(networkError)

        const entry = await McpAuth.get("test-oauth-network-error")
        expect(entry?.tokens).toBeDefined()
        expect(entry?.tokens?.accessToken).toBe("test-access")
        expect(refreshEventPublished).not.toBeNull()
        expect(refreshEventPublished?.requiresReauth).toBe(false)
      } finally {
        unsubscribe()
      }
    },
  })
})

test("OAuthRefreshError is created with correct properties", () => {
  const retryableError = new OAuthRefreshError("Network error", true, new Error("ETIMEDOUT"))
  expect(retryableError.isRetryable).toBe(true)
  expect(retryableError.message).toBe("Network error")
  expect(retryableError.name).toBe("OAuthRefreshError")
  expect(retryableError.originalError).toBeDefined()

  const fatal = new OAuthRefreshError("Auth failed", false)
  expect(fatal.isRetryable).toBe(false)
  expect(fatal.message).toBe("Auth failed")
  expect(fatal.originalError).toBeUndefined()
})

test("isNetworkError correctly identifies network errors", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-network-check": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-network-check",
        "https://example.com/mcp",
        {},
        { onRedirect: mockOnRedirect },
      )

      expect((provider as any).isNetworkError(new Error("ETIMEDOUT"))).toBe(true)
      expect((provider as any).isNetworkError(new Error("ECONNREFUSED"))).toBe(true)
      expect((provider as any).isNetworkError(new Error("ENOTFOUND"))).toBe(true)
      expect((provider as any).isNetworkError(new Error("ECONNRESET"))).toBe(true)
      expect((provider as any).isNetworkError(new Error("network error"))).toBe(true)
      expect((provider as any).isNetworkError(new Error("fetch failed"))).toBe(true)
      expect((provider as any).isNetworkError(new Error("timeout"))).toBe(true)
      expect((provider as any).isNetworkError(new Error("socket hang up"))).toBe(true)
      expect((provider as any).isNetworkError(new Error("invalid_grant"))).toBe(false)
      expect((provider as any).isNetworkError(new Error("some other error"))).toBe(false)
    },
  })
})

test("isAuthError correctly identifies auth errors", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-auth-check": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-auth-check",
        "https://example.com/mcp",
        {},
        { onRedirect: mockOnRedirect },
      )

      expect((provider as any).isAuthError(new Error("invalid_grant"))).toBe(true)
      expect((provider as any).isAuthError(new Error("unauthorized"))).toBe(true)
      expect((provider as any).isAuthError(new Error("forbidden"))).toBe(true)
      expect((provider as any).isAuthError(new Error("401 Unauthorized"))).toBe(true)
      expect((provider as any).isAuthError(new Error("403 Forbidden"))).toBe(true)
      expect((provider as any).isAuthError(new Error("invalid token"))).toBe(true)
      expect((provider as any).isAuthError(new Error("expired token"))).toBe(true)
      expect((provider as any).isAuthError(new Error("token revoked"))).toBe(true)
      expect((provider as any).isAuthError(new Error("ETIMEDOUT"))).toBe(false)
      expect((provider as any).isAuthError(new Error("some other error"))).toBe(false)
    },
  })
})

test("expired tokens are properly handled", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-expired": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const expiredTime = Date.now() / 1000 - 3600
      await McpAuth.updateTokens(
        "test-expired",
        {
          accessToken: "expired-access",
          refreshToken: "valid-refresh",
          expiresAt: expiredTime,
        },
        "https://example.com/mcp",
      )

      const provider = new McpOAuthProvider("test-expired", "https://example.com/mcp", {}, { onRedirect: mockOnRedirect })
      const tokens = await provider.tokens()

      expect(tokens).toBeDefined()
      expect(tokens?.expires_in).toBe(0)
      expect(tokens?.refresh_token).toBe("valid-refresh")
    },
  })
})

test("invalidateCredentials removes tokens", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-invalidate": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.updateTokens(
        "test-invalidate",
        {
          accessToken: "test-access",
          refreshToken: "test-refresh",
        },
        "https://example.com/mcp",
      )

      const provider = new McpOAuthProvider(
        "test-invalidate",
        "https://example.com/mcp",
        {},
        { onRedirect: mockOnRedirect },
      )
      await provider.invalidateCredentials("tokens")

      const entry = await McpAuth.get("test-invalidate")
      expect(entry?.tokens).toBeUndefined()
    },
  })
})

test("invalidateCredentials removes all credentials", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-invalidate-all": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.updateTokens(
        "test-invalidate-all",
        {
          accessToken: "test-access",
          refreshToken: "test-refresh",
        },
        "https://example.com/mcp",
      )
      await McpAuth.updateClientInfo(
        "test-invalidate-all",
        {
          clientId: "test-client-id",
          clientSecret: "test-secret",
        },
        "https://example.com/mcp",
      )

      const provider = new McpOAuthProvider(
        "test-invalidate-all",
        "https://example.com/mcp",
        {},
        { onRedirect: mockOnRedirect },
      )
      await provider.invalidateCredentials("all")

      const entry = await McpAuth.get("test-invalidate-all")
      expect(entry).toBeUndefined()
    },
  })
})
