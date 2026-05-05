import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionDecision } from "../../src/session/decision"
import { SessionBatonRegistry } from "../../src/session/baton-registry"

describe("session decision baton", () => {
  test("keeps active rationale while superseded decisions move to history", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "decision root" })
        const child = await Session.create({ title: "decision child", parentID: root.id })

        const first = await SessionDecision.recordDecision({
          rootSessionID: root.id,
          sessionID: root.id,
          messageID: "msg_decision_1" as any,
          at: 100,
          decision: "Keep continuity in the broad world-state lane.",
          rationale: "It is the fastest way to preserve context while the baton system is incomplete.",
          alternativesRejected: ["Split continuity into narrower baton families first."],
          scope: "continuity architecture",
          invalidationCondition: "Invalidate when narrower batons exist with real consumers.",
        })
        const firstID = first.decisions.at(-1)?.id
        if (!firstID) throw new Error("expected first decision id")

        const second = await SessionDecision.recordDecision({
          rootSessionID: root.id,
          sessionID: child.id,
          messageID: "msg_decision_2" as any,
          at: 200,
          decision: "Add narrow baton families before broad prompt injection.",
          rationale: "This keeps the prompt honest and lets us test behavior one baton at a time.",
          alternativesRejected: ["Inject every baton into the normal prompt immediately."],
          scope: "continuity architecture",
          invalidationCondition: "Invalidate if narrow-first testing does not improve continuity quality.",
        })
        const secondID = second.decisions.at(-1)?.id
        if (!secondID) throw new Error("expected second decision id")

        await SessionDecision.supersedeDecision({
          rootSessionID: root.id,
          sessionID: child.id,
          decisionID: firstID,
          supersededByDecisionID: secondID,
          messageID: "msg_decision_supersede" as any,
          at: 300,
        })

        const info = await SessionDecision.get(root.id)
        expect(info?.latestSummary).toContain("active_decisions=1")
        expect(info?.latestSummary).toContain("superseded=1")
        expect(info?.decisions.find((item) => item.id === firstID)?.status).toBe("superseded")
        expect(info?.decisions.find((item) => item.id === secondID)?.status).toBe("active")

        const materialized = await SessionDecision.materialize({ rootSessionID: root.id })
        expect(materialized?.text).toContain("Add narrow baton families before broad prompt injection.")
        expect(materialized?.text).toContain("This keeps the prompt honest and lets us test behavior one baton at a time.")
        expect(materialized?.text).not.toContain("Keep continuity in the broad world-state lane.")

        const active = await SessionBatonRegistry.active({ sessionID: child.id })
        expect(active.batons.find((item) => item.kind === "decision")?.summary).toContain("active_decisions=1")

        const history = await SessionBatonRegistry.history({ sessionID: child.id, limit: 6 })
        const actions = history.entries.filter((entry) => entry.kind === "decision").map((entry) => entry.action)
        expect(actions).toEqual(expect.arrayContaining(["recorded", "superseded"]))
      },
    })
  })
})
