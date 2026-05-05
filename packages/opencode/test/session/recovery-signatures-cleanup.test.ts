import { describe, expect, test } from "bun:test"

function clearAssistantTranscriptRecovery(
  messageID: string,
  sessionID: string | undefined,
  signatures: Map<string, string>,
  timers: Map<string, number>,
  attempts: Map<string, unknown>,
  activity: Map<string, number>,
) {
  const explicitKey = sessionID ? `${sessionID}:${messageID}` : undefined
  if (explicitKey) {
    const timer = timers.get(explicitKey)
    if (timer) clearTimeout(timer)
    timers.delete(explicitKey)
    attempts.delete(`assistant:${explicitKey}`)
    activity.delete(explicitKey)
    signatures.delete(explicitKey)
    return
  }
  for (const [key, timer] of timers.entries()) {
    if (!key.endsWith(`:${messageID}`)) continue
    clearTimeout(timer)
    timers.delete(key)
    attempts.delete(`assistant:${key}`)
    activity.delete(key)
    signatures.delete(key)
  }
}

function invalidateSessionCleanup(
  sessionID: string,
  cascade: boolean,
  descendants: string[],
  signatures: Map<string, string>,
  timers: Map<string, number>,
  attempts: Map<string, unknown>,
  activity: Map<string, number>,
) {
  const sessionIDs = cascade ? descendants : [sessionID]
  for (const id of sessionIDs) {
    for (const [key] of signatures.entries()) {
      if (key.startsWith(`${id}:`)) {
        clearAssistantTranscriptRecovery(key.split(":")[1], id, signatures, timers, attempts, activity)
      }
    }
  }
}

describe("assistantTranscriptRecoverySignatures cleanup", () => {
  test("clearAssistantTranscriptRecovery removes entries for specific message", () => {
    const signatures = new Map([["session-1:msg-1", "sig1"], ["session-1:msg-2", "sig2"]])
    const timers = new Map([["session-1:msg-1", 1]])
    const attempts = new Map([["assistant:session-1:msg-1", {}]])
    const activity = new Map([["session-1:msg-1", 100]])

    clearAssistantTranscriptRecovery("msg-1", "session-1", signatures, timers, attempts, activity)

    expect(signatures.has("session-1:msg-1")).toBe(false)
    expect(signatures.has("session-1:msg-2")).toBe(true)
    expect(timers.has("session-1:msg-1")).toBe(false)
    expect(attempts.has("assistant:session-1:msg-1")).toBe(false)
    expect(activity.has("session-1:msg-1")).toBe(false)
  })

  test("invalidateSessionCleanup removes all entries for a session", () => {
    const signatures = new Map([
      ["session-1:msg-1", "sig1"],
      ["session-1:msg-2", "sig2"],
      ["session-2:msg-1", "sig3"],
    ])
    const timers = new Map([["session-1:msg-1", 1], ["session-1:msg-2", 2]])
    const attempts = new Map([["assistant:session-1:msg-1", {}]])
    const activity = new Map([["session-1:msg-1", 100], ["session-1:msg-2", 200]])

    invalidateSessionCleanup("session-1", false, [], signatures, timers, attempts, activity)

    expect(signatures.has("session-1:msg-1")).toBe(false)
    expect(signatures.has("session-1:msg-2")).toBe(false)
    expect(signatures.has("session-2:msg-1")).toBe(true)
  })

  test("invalidateSessionCleanup with cascade removes descendant entries too", () => {
    const signatures = new Map([
      ["root:msg-1", "sig1"],
      ["child-1:msg-2", "sig2"],
      ["child-2:msg-3", "sig3"],
      ["other:msg-4", "sig4"],
    ])
    const timers = new Map()
    const attempts = new Map()
    const activity = new Map()

    invalidateSessionCleanup("root", true, ["root", "child-1", "child-2"], signatures, timers, attempts, activity)

    expect(signatures.has("root:msg-1")).toBe(false)
    expect(signatures.has("child-1:msg-2")).toBe(false)
    expect(signatures.has("child-2:msg-3")).toBe(false)
    expect(signatures.has("other:msg-4")).toBe(true)
  })
})
