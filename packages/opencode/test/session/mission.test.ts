import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionMission } from "../../src/session/mission"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

describe("session mission", () => {
  test("records prompt ingress on the root session mission ledger", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

        const prepared = await SessionMission.recordIngress({
          sessionID: child.id,
          // @ts-ignore
          agent: "build",
          parts: [
            { type: "text", text: "Keep changes small. Do not touch task.ts. Prefer lightweight tests only." },
          ],
        })

        // @ts-ignore
        expect(prepared.message.info.role).toBe("user")
        const mission = await SessionMission.get(root.id)

        expect(mission).toMatchObject({
          rootSessionID: root.id,
          latestSessionID: child.id,
          // @ts-ignore
          latestMessageID: prepared.message.info.id,
          latestIntent: "Keep changes small. Do not touch task.ts. Prefer lightweight tests only.",
        })
        expect(mission?.latestConstraintsSummary).toContain("Do not touch task")
        expect(mission?.intentLog).toHaveLength(1)
        expect(mission?.intentLog[0]).toMatchObject({
          sessionID: child.id,
          // @ts-ignore
          messageID: prepared.message.info.id,
          intent: "Keep changes small. Do not touch task.ts. Prefer lightweight tests only.",
        })

        await Session.remove(child.id)
        await Session.remove(root.id)
      },
    })
  })

  test("records steer receipt in the root session mission ledger", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

        const prepared = await SessionMission.recordIngress({
          sessionID: child.id,
          // @ts-ignore
          agent: "build",
          steer: true,
          parts: [{ type: "text", text: "Pause the long path and answer my blocker first." }],
        })

        // @ts-ignore
        expect(prepared.loopInput?.rootSessionID).toBe(root.id)
        const mission = await SessionMission.get(root.id)

        expect(mission?.steeringDeltas).toHaveLength(1)
        expect(mission?.steeringDeltas[0]).toMatchObject({
          sessionID: child.id,
          stage: "received",
          // @ts-ignore
          messageID: prepared.message.info.id,
          pending: 1,
        })

        await Session.remove(child.id)
        await Session.remove(root.id)
      },
    })
  })

  test("materializes a compact mission digest for model context", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})

        await SessionMission.recordIngress({
          sessionID: root.id,
          rootSessionID: root.id,
          messageID: "message_user_1" as any,
          at: 100,
          intent: "Ship the compaction fix without widening scope.",
          constraintsSummary: "Keep changes minimal; do not touch routing.",
        })
        await SessionMission.recordSteer({
          sessionID: root.id,
          rootSessionID: root.id,
          stage: "received",
          at: 125,
          pending: 1,
          messageID: "message_user_2" as any,
        })

        const materialized = await SessionMission.materialize({
          rootSessionID: root.id,
        })

        expect(materialized?.blocks.map((item) => item.title)).toEqual([
          "Mission focus",
          "Constraints",
          "Recent steering",
        ])
        expect(materialized?.text).toContain("Ship the compaction fix")
        expect(materialized?.text).toContain("Keep changes minimal")
        expect(materialized?.text).toContain("received (pending=1)")

        await Session.remove(root.id)
      },
    })
  })

  test("deduplicates repeated constraint lines while keeping later unique entries", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})

        await SessionMission.recordIngress({
          sessionID: root.id,
          rootSessionID: root.id,
          messageID: "message_constraints_1",
          at: 100,
          intent: "First pass",
          constraintsSummary: "Keep routing stable.\nAvoid noisy churn.",
        })
        await SessionMission.recordIngress({
          sessionID: root.id,
          rootSessionID: root.id,
          messageID: "message_constraints_2",
          at: 150,
          intent: "Second pass",
          constraintsSummary: "Keep routing stable.\nPrefer stable prefixes.",
        })

        const mission = await SessionMission.get(root.id)
        expect(mission?.latestConstraintsSummary).toBe(
          "Keep routing stable.\nAvoid noisy churn.\nPrefer stable prefixes.",
        )

        await Session.remove(root.id)
      },
    })
  })
})
