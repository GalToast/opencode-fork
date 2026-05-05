import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionCounterpressure } from "../../src/session/counterpressure"
import { SessionBatonRegistry } from "../../src/session/baton-registry"

describe("session counterpressure baton", () => {
  test("records severe counterpressure and exposes it through registry history", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "counterpressure root" })
        const child = await Session.create({ title: "counterpressure child", parentID: root.id })

        await SessionCounterpressure.recordWarning({
          rootSessionID: root.id,
          sessionID: child.id,
          messageID: "msg_cp_1" as any,
          at: 100,
          trigger: "The same fix path has repeated three times without new evidence.",
          severity: "critical",
          recommendedAction: "Change course before repeating the same fix again.",
          relatedInvalidationHints: ["Repeated retries without new evidence are invalidating the current path."],
        })

        const materialized = await SessionCounterpressure.materialize({ rootSessionID: root.id })
        expect(materialized?.text).toContain("The same fix path has repeated three times without new evidence.")
        expect(materialized?.text).toContain("recommended_action=Change course before repeating the same fix again.")

        const active = await SessionBatonRegistry.active({ sessionID: child.id })
        expect(active.batons.find((item) => item.kind === "counterpressure")?.summary).toContain("critical=1")

        const history = await SessionBatonRegistry.history({ sessionID: child.id, limit: 4 })
        expect(history.entries.some((entry) => entry.kind === "counterpressure" && entry.action === "recorded")).toBe(true)
      },
    })
  })

  test("keeps medium-only counterpressure out of default materialization", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "counterpressure root" })

        await SessionCounterpressure.recordWarning({
          rootSessionID: root.id,
          sessionID: root.id,
          messageID: "msg_cp_2" as any,
          at: 200,
          trigger: "The tone is getting a little repetitive.",
          severity: "medium",
          recommendedAction: "Pause and look for fresh evidence before continuing.",
        })

        const materialized = await SessionCounterpressure.materialize({ rootSessionID: root.id })
        expect(materialized).toBeUndefined()
      },
    })
  })
})
