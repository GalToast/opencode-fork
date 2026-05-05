import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionWorkGraph } from "../../src/session/workgraph"
import { SessionWorldState } from "../../src/session/world-state"
import { tmpdir } from "../fixture/fixture"

describe("session.world-state", () => {
  test("records structured world-state and materializes a compact digest", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

        await SessionWorldState.recordObjective({
          rootSessionID: root.id,
          sessionID: child.id,
          title: "Ship the first world-state slice",
          note: "Keep it additive and inspectable.",
        })
        await SessionWorldState.addConstraint({
          rootSessionID: root.id,
          sessionID: child.id,
          constraint: "Do not auto-spawn lanes or agents.",
        })
        await SessionWorldState.addRisk({
          rootSessionID: root.id,
          sessionID: child.id,
          statement: "The state layer could drift from actual execution.",
          severity: "high",
        })
        await SessionWorldState.recordAssumptionRef({
          rootSessionID: root.id,
          sessionID: child.id,
          reasoningID: "assump_1",
          statement: "The semantic baton already preserves critical constraints.",
        })
        await SessionWorldState.recordCommitmentRef({
          rootSessionID: root.id,
          sessionID: child.id,
          reasoningID: "com_1",
          statement: "Keep the main agent in command.",
        })
        await SessionWorldState.recordTouchedFile({
          rootSessionID: root.id,
          sessionID: child.id,
          path: "packages/opencode/src/session/world-state.ts",
          note: "First structured world-state slice.",
        })
        await SessionWorldState.recordOpenLoop({
          rootSessionID: root.id,
          sessionID: child.id,
          summary: "Wire world-state into the workgraph digest.",
        })

        const info = await SessionWorldState.get(root.id)
        expect(info?.objective?.title).toBe("Ship the first world-state slice")
        expect(info?.constraints).toEqual(["Do not auto-spawn lanes or agents."])
        expect(info?.openRisks[0]?.severity).toBe("high")
        expect(info?.assumptionRefs[0]?.reasoningID).toBe("assump_1")
        expect(info?.commitmentRefs[0]?.reasoningID).toBe("com_1")
        expect(info?.touchedFiles[0]?.path).toBe("packages/opencode/src/session/world-state.ts")
        expect(info?.openLoops).toHaveLength(1)
        expect(info?.latestSummary).toContain("objective=Ship the first world-state slice")

        const materialized = await SessionWorldState.materialize({ rootSessionID: root.id })
        expect(materialized?.blocks.map((item) => item.title)).toEqual([
          "Objective",
          "Constraints",
          "Open risks",
          "Assumption refs",
          "Commitment refs",
          "Touched files",
          "Open loops",
          "Latest summary",
        ])
        expect(materialized?.text).toContain("Do not auto-spawn lanes or agents.")
        expect(materialized?.text).toContain("The state layer could drift from actual execution.")
        expect(materialized?.text).toContain("Keep the main agent in command.")
      },
    })
  })

  test("surfaces world-state alongside the workgraph digest", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})

        await SessionWorkGraph.recordObjective({
          rootSessionID: root.id,
          sessionID: root.id,
          title: "Stabilize the world-state layer",
          constraintsSummary: "Keep it root-scoped and readable.",
        })

        await SessionWorldState.recordObjective({
          rootSessionID: root.id,
          sessionID: root.id,
          title: "Stabilize the world-state layer",
        })
        await SessionWorldState.addConstraint({
          rootSessionID: root.id,
          sessionID: root.id,
          constraint: "Prefer structured state over transcript summary.",
        })
        await SessionWorldState.recordOpenLoop({
          rootSessionID: root.id,
          sessionID: root.id,
          summary: "Expose world-state in the workgraph digest.",
        })

        const digest = await SessionWorkGraph.materialize({
          rootSessionID: root.id,
          // @ts-ignore
          projectID: Instance.project.id,
        })

        // @ts-ignore
        expect(digest?.worldState).toBeDefined()
        expect(digest?.blocks.map((item) => item.title)).toContain("Open loops")
        expect(digest?.text).toContain("Prefer structured state over transcript summary.")
        expect(digest?.text).toContain("Expose world-state in the workgraph digest.")
      },
    })
  })
})
