import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { RetrievalService } from "../../src/retrieval"
import { Session } from "../../src/session"
import { ReasoningLedger } from "../../src/session/reasoning-ledger"
import { tmpdir } from "../fixture/fixture"

describe("reasoning ledger", () => {
  test("records commitments, assumptions, and falsifiers under the root session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

        await ReasoningLedger.recordCommitment({
          sessionID: child.id,
          rootSessionID: root.id,
          statement: "Keep the ledger narrow and prompt-oriented.",
          source: "operator",
          status: "active",
        })
        await ReasoningLedger.recordAssumption({
          sessionID: child.id,
          rootSessionID: root.id,
          statement: "The ledger should stay root-scoped.",
          kind: "state",
          validationStatus: "untested",
          source: "operator",
        })
        await ReasoningLedger.recordFalsifier({
          sessionID: child.id,
          rootSessionID: root.id,
          statement: "If compaction starts summarizing raw chatter, this lane is wrong.",
          targetType: "assumption",
          status: "armed",
          checkType: "counterexample",
          source: "operator",
        })

        const info = await ReasoningLedger.get(root.id)
        expect(info).toMatchObject({
          rootSessionID: root.id,
          latestSessionID: child.id,
        })
        expect(info?.commitments).toHaveLength(1)
        expect(info?.assumptions).toHaveLength(1)
        expect(info?.falsifiers).toHaveLength(1)
        expect(info?.latestSummary).toContain("commitments=1")
        expect(info?.latestSummary).toContain("assumptions=1")
        expect(info?.latestSummary).toContain("falsifiers=1")

        await Session.remove(child.id)
        await Session.remove(root.id)
      },
    })
  })

  test("materializes a compact baton that surfaces only active and risky reasoning state", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})

        await ReasoningLedger.recordCommitment({
          sessionID: root.id,
          rootSessionID: root.id,
          statement: "Preserve the current execution contract.",
          status: "active",
        })
        await ReasoningLedger.recordCommitment({
          sessionID: root.id,
          rootSessionID: root.id,
          statement: "This old commitment has already been satisfied.",
          status: "satisfied",
        })
        await ReasoningLedger.recordAssumption({
          sessionID: root.id,
          rootSessionID: root.id,
          statement: "The API remains stable.",
          kind: "environment",
          validationStatus: "untested",
        })
        await ReasoningLedger.recordAssumption({
          sessionID: root.id,
          rootSessionID: root.id,
          statement: "This assumption has already been verified.",
          kind: "state",
          validationStatus: "supported",
        })
        await ReasoningLedger.recordFalsifier({
          sessionID: root.id,
          rootSessionID: root.id,
          statement: "Watch for silent prompt churn.",
          targetType: "assumption",
          status: "armed",
          checkType: "observation",
        })
        await ReasoningLedger.recordFalsifier({
          sessionID: root.id,
          rootSessionID: root.id,
          statement: "This falsifier has already been dismissed.",
          targetType: "commitment",
          status: "dismissed",
          checkType: "user_correction",
        })

        const materialized = await ReasoningLedger.materialize({
          rootSessionID: root.id,
        })

        expect(materialized?.blocks.map((item) => item.title)).toEqual([
          "Active commitments",
          "Risky assumptions",
          "Armed falsifiers",
          "Latest summary",
        ])
        expect(materialized?.text).toContain("Preserve the current execution contract.")
        expect(materialized?.text).toContain("The API remains stable.")
        expect(materialized?.text).toContain("Watch for silent prompt churn.")
        expect(materialized?.text).not.toContain("This old commitment has already been satisfied.")
        expect(materialized?.text).not.toContain("This assumption has already been verified.")
        expect(materialized?.text).not.toContain("This falsifier has already been dismissed.")

        await Session.remove(root.id)
      },
    })
  })

  test("reconciles commitments, assumptions, and falsifiers with append-only transitions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})
        const child = await Session.create({ parentID: root.id })

        await ReasoningLedger.recordCommitment({
          sessionID: child.id,
          rootSessionID: root.id,
          statement: "Keep the reasoning ledger live.",
          source: "operator",
          status: "active",
        })
        await ReasoningLedger.recordAssumption({
          sessionID: child.id,
          rootSessionID: root.id,
          statement: "The prompt hook is in place.",
          kind: "state",
          validationStatus: "untested",
          source: "operator",
        })
        await ReasoningLedger.recordFalsifier({
          sessionID: child.id,
          rootSessionID: root.id,
          statement: "If the prompt stops surfacing the baton, something regressed.",
          targetType: "assumption",
          status: "armed",
          checkType: "counterexample",
          source: "operator",
        })

        const before = await ReasoningLedger.get(root.id)
        const commitmentID = before?.commitments[0]?.id
        const assumptionID = before?.assumptions[0]?.id
        const falsifierID = before?.falsifiers[0]?.id
        if (!commitmentID || !assumptionID || !falsifierID) throw new Error("expected seeded reasoning entries")

        await ReasoningLedger.reconcileCommitment({
          sessionID: child.id,
          rootSessionID: root.id,
          commitmentID,
          outcome: "satisfied",
          note: "The baton is surfaced through the prompt and compaction paths.",
          source: "tool",
        })
        await ReasoningLedger.reconcileAssumption({
          sessionID: child.id,
          rootSessionID: root.id,
          assumptionID,
          outcome: "contradicted",
          note: "The prompt hook was missing in the previous build.",
          source: "tool",
        })
        await ReasoningLedger.reconcileFalsifier({
          sessionID: child.id,
          rootSessionID: root.id,
          falsifierID,
          outcome: "triggered",
          note: "The baton disappeared in the previous test run.",
          source: "tool",
        })

        const after = await ReasoningLedger.get(root.id)
        expect(after?.commitments[0]?.status).toBe("satisfied")
        expect(after?.assumptions[0]?.validationStatus).toBe("contradicted")
        expect(after?.falsifiers[0]?.status).toBe("triggered")
        expect(after?.events).toHaveLength(3)
        expect(after?.latestSummary).toContain("transitions=3")

        const materialized = await ReasoningLedger.materialize({
          rootSessionID: root.id,
        })
        expect(materialized?.blocks.map((item) => item.title)).toContain("Recent transitions")
        expect(materialized?.text).toContain("The baton is surfaced through the prompt and compaction paths.")
        expect(materialized?.text).toContain("The prompt hook was missing in the previous build.")
        expect(materialized?.text).toContain("The baton disappeared in the previous test run.")

        const recall = await RetrievalService.search({
          projectID: Instance.project.id,
          preferredSessionIDs: [child.id],
          query: "prompt hook missing previous build",
          policy: "auto",
          limit: 5,
          sourceTypes: ["note"],
        })
        // @ts-ignore
        const assumptionOutcome = recall.candidates.find((item) => item.provenance?.kind === "assumption_outcome")
        expect(assumptionOutcome).toBeDefined()
        expect(assumptionOutcome?.content).toContain("Reasoning assumption outcome")
        expect(assumptionOutcome?.content).toContain("statement: The prompt hook is in place.")
        expect(assumptionOutcome?.content).toContain("outcome: contradicted")
        expect(assumptionOutcome?.content).toContain("note: The prompt hook was missing in the previous build.")

        await Session.remove(child.id)
        await Session.remove(root.id)
      },
    })
  })
})
