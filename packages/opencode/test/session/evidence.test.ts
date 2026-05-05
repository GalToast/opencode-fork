import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionEvidence } from "../../src/session/evidence"
import { SessionBatonRegistry } from "../../src/session/baton-registry"

describe("session evidence baton", () => {
  test("records curated evidence and keeps it available through registry history and inspection", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "evidence root" })
        const child = await Session.create({ title: "evidence child", parentID: root.id })

        const first = await SessionEvidence.recordEvidence({
          rootSessionID: root.id,
          sessionID: child.id,
          messageID: "msg_evidence_1" as any,
          at: 100,
          fact: "Focused baton tests are passing for authority, open loops, and decision.",
          sourceAnchor: "baton-focused test run",
          trustBasis: "direct test execution",
          freshness: "fresh",
          confidence: 0.97,
          supportingRefs: ["authority.test.ts", "open-loops.test.ts", "decision.test.ts"],
        })
        const evidenceID = first.items.at(-1)?.id
        if (!evidenceID) throw new Error("expected evidence id")

        await SessionEvidence.recordEvidence({
          rootSessionID: root.id,
          sessionID: child.id,
          evidenceID,
          messageID: "msg_evidence_2" as any,
          at: 200,
          fact: "Focused baton tests are passing for authority, open loops, and decision.",
          sourceAnchor: "validation rerun",
          trustBasis: "direct test execution plus registry inspection",
          freshness: "recent",
          confidence: 0.98,
          supportingRefs: ["baton-registry.test.ts"],
        })

        const materialized = await SessionEvidence.materialize({ rootSessionID: root.id })
        expect(materialized?.text).toContain("Focused baton tests are passing for authority, open loops, and decision.")
        expect(materialized?.text).toContain("source=validation rerun")
        expect(materialized?.text).toContain("trust=direct test execution plus registry inspection")

        const active = await SessionBatonRegistry.active({ sessionID: child.id })
        expect(active.batons.find((item) => item.kind === "evidence")?.summary).toContain("evidence=1")

        const history = await SessionBatonRegistry.history({ sessionID: child.id, limit: 4 })
        const actions = history.entries.filter((entry) => entry.kind === "evidence").map((entry) => entry.action)
        expect(actions).toEqual(expect.arrayContaining(["recorded", "updated"]))
      },
    })
  })
})
