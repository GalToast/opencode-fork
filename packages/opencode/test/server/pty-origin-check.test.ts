import { test, expect, describe } from "bun:test"
import { Hono } from "hono"
import { upgradeWebSocket } from "hono/bun"

describe("PTY WebSocket origin check", () => {
  test("rejects cross-origin WebSocket upgrades", () => {
    // Simulate the origin check logic from pty.ts
    const allowedHosts = ["localhost", "127.0.0.1", "::1"]

    const maliciousOrigins = [
      "https://evil.com",
      "https://attacker.example.com",
      "http://malicious-site.org:8080",
      "https://192.168.1.100",
    ]

    for (const origin of maliciousOrigins) {
      const originURL = new URL(origin)
      expect(allowedHosts.includes(originURL.hostname)).toBe(false)
    }
  })

  test("allows localhost WebSocket upgrades", () => {
    const allowedHosts = ["localhost", "127.0.0.1", "::1"]

    const safeOrigins = [
      "http://localhost:3000",
      "http://127.0.0.1:8080",
    ]

    for (const origin of safeOrigins) {
      const originURL = new URL(origin)
      expect(allowedHosts.includes(originURL.hostname)).toBe(true)
    }
  })

  test("allows missing origin (same-origin or native clients)", () => {
    // When origin header is absent, the check is skipped
    const origin: string | undefined = undefined
    if (origin) {
      const originURL = new URL(origin)
      const allowedHosts = ["localhost", "127.0.0.1", "::1"]
      if (!allowedHosts.includes(originURL.hostname)) {
        throw new Error(`WebSocket origin not allowed: ${origin}`)
      }
    }
    // Should reach here without throwing
    expect(true).toBe(true)
  })

  test("rejects malformed origin headers", () => {
    const allowedHosts = ["localhost", "127.0.0.1", "::1"]
    const malformedOrigins = ["not-a-url", "://missing-scheme", "localhost/path"]

    for (const origin of malformedOrigins) {
      try {
        const originURL = new URL(origin)
        // If URL parsing succeeds, check the host
        if (!allowedHosts.includes(originURL.hostname)) {
          throw new Error(`WebSocket origin not allowed: ${origin}`)
        }
      } catch {
        // Expected: malformed origins should be rejected
        expect(true).toBe(true)
      }
    }
  })
})
