import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionAuthority } from "../../src/session/authority"
import { SessionBatonRegistry } from "../../src/session/baton-registry"

describe("session authority baton", () => {
  test("materializes only non-default authority posture and records registry history", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "authority root" })
        const child = await Session.create({ title: "authority child", parentID: root.id })

        await SessionAuthority.recordAuthority({
          rootSessionID: root.id,
          sessionID: root.id,
          messageID: "msg_root_default" as any,
          at: 100,
          executionAuthority: "local",
          scopeAuthority: "root",
          userAuthority: "root",
          authoritySource: "root_default",
          delegationMode: "stay_solo",
        })

        const defaultPrompt = await SessionAuthority.materialize({
          rootSessionID: root.id,
          sessionID: root.id,
        })
        expect(defaultPrompt).toBeUndefined()

        await SessionAuthority.recordAuthority({
          rootSessionID: root.id,
          sessionID: child.id,
          messageID: "msg_child_override" as any,
          at: 200,
          executionAuthority: "delegated",
          scopeAuthority: "local_refine_only",
          userAuthority: "none",
          authoritySource: "explicit_override",
          delegationMode: "delegate_bounded_worker",
          scopeEscalationRequired: true,
          scopeEscalationReason: "Needs supervisor review before widening the patch scope.",
          latestUserOverrideAnchor: "Patch only the targeted worker slice.",
          doNotActBeyond: "the targeted worker slice",
        })

        const childPrompt = await SessionAuthority.materialize({
          rootSessionID: root.id,
          sessionID: child.id,
        })
        expect(childPrompt?.text).toContain("Execution authority: delegated")
        expect(childPrompt?.text).toContain("Do not act beyond: the targeted worker slice")
        expect(childPrompt?.text).toContain("Escalation reason: Needs supervisor review before widening the patch scope.")

        const active = await SessionBatonRegistry.active({ sessionID: child.id })
        const authority = active.batons.find((item) => item.kind === "authority")
        expect(authority?.summary).toContain("execution=delegated")
        expect(authority?.text).toContain("Patch only the targeted worker slice.")

        const history = await SessionBatonRegistry.history({ sessionID: child.id, limit: 4 })
        expect(history.entries.some((entry) => entry.kind === "authority" && entry.action === "root_default")).toBe(true)
        expect(history.entries.some((entry) => entry.kind === "authority" && entry.action === "escalation_required")).toBe(true)
      },
    })
  })
})
