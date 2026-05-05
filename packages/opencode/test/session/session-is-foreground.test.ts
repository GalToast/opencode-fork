import { describe, expect, test } from "bun:test"

// Copy of the function for isolated testing (avoids JSX deps)
function sessionIsForeground(viewedSessionID: string | undefined, sessionID: string) {
  if (!viewedSessionID) return false
  return sessionID === viewedSessionID
}

describe("sessionIsForeground", () => {
  test("returns false when no session is viewed (home route)", () => {
    expect(sessionIsForeground(undefined, "session-1")).toBe(false)
    expect(sessionIsForeground(undefined, "session-2")).toBe(false)
  })

  test("returns true for the viewed session", () => {
    expect(sessionIsForeground("session-1", "session-1")).toBe(true)
  })

  test("returns false for non-viewed sessions", () => {
    expect(sessionIsForeground("session-1", "session-2")).toBe(false)
    expect(sessionIsForeground("session-1", "session-3")).toBe(false)
  })

  test("returns false for child sessions when parent is viewed", () => {
    expect(sessionIsForeground("parent-session", "child-session")).toBe(false)
  })
})
