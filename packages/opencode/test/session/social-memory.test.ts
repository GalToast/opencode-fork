import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionSocialMemory } from "../../src/session/social-memory"
import { tmpdir } from "../fixture/fixture"

describe("session.social-memory", () => {
  test("records pairings, handoffs, and stall patterns under the root session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

        await SessionSocialMemory.recordSuccessfulPairing({
          rootSessionID: root.id,
          sessionID: child.id,
          pattern: "repo scan first, then bounded patch",
          note: "Stable when implementation follows discovery.",
          confidence: 0.9,
        })
        await SessionSocialMemory.recordHandoffPattern({
          rootSessionID: root.id,
          sessionID: child.id,
          pattern: "handoff with checkpoint and artifact contract",
          note: "Keeps context losses low.",
        })
        await SessionSocialMemory.recordStallPattern({
          rootSessionID: root.id,
          sessionID: child.id,
          pattern: "implementation before repo scan causes churn",
          note: "Needs reconnaissance first.",
          severity: "high",
        })

        const info = await SessionSocialMemory.get(root.id)
        expect(info?.successfulPairings).toHaveLength(1)
        expect(info?.handoffPatterns).toHaveLength(1)
        expect(info?.stallPatterns).toHaveLength(1)
        expect(info?.latestSummary).toContain("pairings=1")
        expect(info?.latestSummary).toContain("handoffs=1")
        expect(info?.latestSummary).toContain("stalls=1")

        const materialized = await SessionSocialMemory.materialize({
          rootSessionID: root.id,
        })
        expect(materialized?.blocks.map((item) => item.title)).toEqual([
          "Successful pairings",
          "Handoff patterns",
          "Stall patterns",
          "Latest summary",
        ])
        expect(materialized?.text).toContain("repo scan first, then bounded patch")
        expect(materialized?.text).toContain("handoff with checkpoint and artifact contract")
        expect(materialized?.text).toContain("implementation before repo scan causes churn")
      },
    })
  })
})
