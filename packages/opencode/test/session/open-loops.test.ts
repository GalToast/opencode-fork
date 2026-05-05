import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionOpenLoops } from "../../src/session/open-loops"
import { SessionBatonRegistry } from "../../src/session/baton-registry"

describe("session open-loops baton", () => {
  test("tracks unresolved loops, resolution, and reopening through the registry", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "open loops root" })
        const child = await Session.create({ title: "open loops child", parentID: root.id })

        await SessionOpenLoops.recordLoop({
          rootSessionID: root.id,
          sessionID: child.id,
          messageID: "msg_loop_open" as any,
          at: 100,
          summary: "Verify the baton history survives compaction.",
          verificationRequired: true,
        })

        let info = await SessionOpenLoops.get(root.id)
        const loopID = info?.loops[0]?.id
        expect(loopID).toBeDefined()

        await SessionOpenLoops.resolveLoop({
          rootSessionID: root.id,
          sessionID: child.id,
          loopID: loopID!,
          messageID: "msg_loop_resolve" as any,
          at: 200,
        })

        await SessionOpenLoops.reopenLoop({
          rootSessionID: root.id,
          sessionID: child.id,
          loopID: loopID!,
          messageID: "msg_loop_reopen" as any,
          at: 300,
          blockerReason: "Compaction handoff did not preserve the active verification step.",
        })

        info = await SessionOpenLoops.get(root.id)
        expect(info?.latestSummary).toContain("open_loops=1")
        expect(info?.loops.find((loop) => loop.id === loopID)?.status).toBe("blocked")

        const materialized = await SessionOpenLoops.materialize({ rootSessionID: root.id })
        expect(materialized?.text).toContain("Verify the baton history survives compaction.")
        expect(materialized?.text).toContain("verification required")
        expect(materialized?.text).toContain("blocker=Compaction handoff did not preserve the active verification step.")

        const active = await SessionBatonRegistry.active({ sessionID: child.id })
        expect(active.batons.find((item) => item.kind === "open_loops")?.summary).toContain("open_loops=1")

        const history = await SessionBatonRegistry.history({ sessionID: child.id, limit: 6 })
        const actions = history.entries.filter((entry) => entry.kind === "open_loops").map((entry) => entry.action)
        expect(actions).toEqual(expect.arrayContaining(["opened", "resolved", "reopened"]))
      },
    })
  })
})
