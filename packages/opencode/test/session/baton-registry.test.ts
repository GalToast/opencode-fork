import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionAuthority } from "../../src/session/authority"
import { SessionDecision } from "../../src/session/decision"
import { SessionEvidence } from "../../src/session/evidence"
import { SessionMission } from "../../src/session/mission"
import { SessionOpenLoops } from "../../src/session/open-loops"
import { ReasoningLedger as SessionReasoningLedger } from "../../src/session/reasoning-ledger"
import { SessionSocialMemory } from "../../src/session/social-memory"
import { SessionForeground } from "../../src/session/foreground"
import { SessionWorkGraph } from "../../src/session/workgraph"
import { SessionBatonRegistry } from "../../src/session/baton-registry"
import { SessionPrompt } from "../../src/session/prompt"

describe("session baton registry", () => {
  test("collects an agent-centric active snapshot and recent baton history", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "registry root" })
        const child = await Session.create({ title: "registry child", parentID: root.id })

        await SessionMission.recordIngress({
          sessionID: child.id,
          rootSessionID: root.id,
          messageID: "message_ingress" as any,
          at: 100,
          intent: "Keep baton debugging tight and factual.",
          constraintsSummary: "Avoid broad rewrites.",
        })

        await SessionAuthority.recordAuthority({
          rootSessionID: root.id,
          sessionID: child.id,
          messageID: "message_authority" as any,
          at: 105,
          executionAuthority: "delegated",
          scopeAuthority: "local_refine_only",
          userAuthority: "none",
          authoritySource: "explicit_override",
          delegationMode: "delegate_bounded_worker",
          scopeEscalationRequired: true,
          scopeEscalationReason: "Do not widen the registry validation pass without proof.",
          latestUserOverrideAnchor: "Validate the baton surfaces first.",
          doNotActBeyond: "the baton validation slice",
        })

        await SessionDecision.recordDecision({
          rootSessionID: root.id,
          sessionID: child.id,
          messageID: "message_decision" as any,
          at: 110,
          decision: "Validate baton slices before adding new families.",
          rationale: "This keeps the architecture honest and avoids prompt-noise inflation.",
          alternativesRejected: ["Add several new baton families before validation."],
          scope: "baton rollout",
          invalidationCondition: "Invalidate if validation shows no behavior gain.",
        })

        await SessionOpenLoops.recordLoop({
          rootSessionID: root.id,
          sessionID: child.id,
          messageID: "message_open_loop" as any,
          at: 115,
          summary: "Prove the current baton set improves behavior before adding evidence.",
          verificationRequired: true,
        })

        await SessionReasoningLedger.recordCommitment({
          sessionID: child.id,
          rootSessionID: root.id,
          messageID: "message_reasoning" as any,
          at: 120,
          statement: "Preserve baton truthfulness.",
          source: "assistant",
        })
        const reasoning = await SessionReasoningLedger.get(root.id)
        const commitment = reasoning?.commitments[0]
        if (!commitment) throw new Error("expected commitment")
        await SessionReasoningLedger.reconcileCommitment({
          sessionID: child.id,
          rootSessionID: root.id,
          commitmentID: commitment.id,
          messageID: "message_reasoning_reconcile" as any,
          at: 130,
          source: "tool",
          outcome: "satisfied",
          note: "observed: baton registry stayed truthful",
        })

        await SessionSocialMemory.recordHandoffPattern({
          rootSessionID: root.id,
          sessionID: child.id,
          messageID: "message_social" as any,
          at: 140,
          pattern: "handoff with explicit baton summary",
          note: "Keeps continuity inspectable.",
        })

        await SessionWorkGraph.recordArtifact({
          rootSessionID: root.id,
          sessionID: child.id,
          messageID: "message_execution_brief" as any,
          type: "execution_brief",
          summary: "Execution brief: keep baton provenance explicit",
          at: 150,
          // @ts-ignore
          outcome: "success",
        })

        await SessionForeground.accept({
          sessionID: child.id,
          rootSessionID: root.id,
          messageID: "message_foreground_accept" as any,
          intent: "Investigate baton continuity.",
          acceptedAt: 160,
        })
        await SessionForeground.promote({
          sessionID: child.id,
          rootSessionID: root.id,
          turnID: "turn_baton",
          promotedAt: 170,
        })
        await SessionForeground.steer({
          sessionID: child.id,
          rootSessionID: root.id,
          stage: "received",
          at: 180,
          pending: 1,
          messageID: "message_foreground_steer" as any,
        })

        const active = await SessionBatonRegistry.active({ sessionID: child.id })
        expect(active.rootSessionID).toBe(root.id)
        expect(active.batons.map((item) => item.kind)).toEqual(
          expect.arrayContaining([
            "mission",
            "authority",
            "decision",
            "open_loops",
            "reasoning_ledger",
            "execution_brief",
            "social_memory",
            "foreground",
          ]),
        )
        expect(active.batons.find((item) => item.kind === "mission")?.summary).toContain("Keep baton debugging tight")
        expect(active.batons.find((item) => item.kind === "authority")?.summary).toContain("execution=delegated")
        expect(active.batons.find((item) => item.kind === "decision")?.summary).toContain("active_decisions=1")
        expect(active.batons.find((item) => item.kind === "open_loops")?.summary).toContain("open_loops=1")
        expect(active.batons.find((item) => item.kind === "execution_brief")?.summary).toContain("Execution brief:")
        expect(active.batons.find((item) => item.kind === "foreground")?.status).toBe("active")

        const history = await SessionBatonRegistry.history({ sessionID: child.id, limit: 10 })
        expect(history.rootSessionID).toBe(root.id)
        const historyActions = history.entries.map((entry) => `${entry.kind}:${entry.action}`)
        expect(historyActions).toContain("foreground:steer_received")
        expect(historyActions).toContain("foreground:promoted")
        expect(historyActions).toContain("execution_brief:committed")
        expect(historyActions).toContain("social_memory:handoff")
        expect(historyActions).toContain("reasoning_ledger:commitment_satisfied")
        expect(historyActions).toContain("authority:escalation_required")
        expect(historyActions).toContain("decision:recorded")
        expect(historyActions).toContain("open_loops:opened")
        expect(history.entries[0]?.at).toBeGreaterThanOrEqual(history.entries[1]?.at ?? 0)
      },
    })
  })

  test("lets prompt inspection reuse the baton registry snapshot", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "inspect root" })
        await SessionMission.recordIngress({
          sessionID: root.id,
          rootSessionID: root.id,
          at: 200,
          intent: "Keep inspection agent-centric.",
        })
        await SessionAuthority.recordAuthority({
          rootSessionID: root.id,
          sessionID: root.id,
          at: 210,
          executionAuthority: "delegated",
          scopeAuthority: "explicit_override",
          userAuthority: "none",
          authoritySource: "explicit_override",
          delegationMode: "delegate_bounded_worker",
          latestUserOverrideAnchor: "Inspect the baton registry without broadening scope.",
          doNotActBeyond: "registry inspection",
        })
        await SessionDecision.recordDecision({
          rootSessionID: root.id,
          sessionID: root.id,
          at: 220,
          decision: "Expose only active baton text through inspectBatons.",
          rationale: "Inspection should stay compact and agent-centric.",
          scope: "baton inspection",
        })
        await SessionOpenLoops.recordLoop({
          rootSessionID: root.id,
          sessionID: root.id,
          at: 230,
          summary: "Verify inspectBatons returns the same baton family snapshot.",
          verificationRequired: true,
        })
        await SessionEvidence.recordEvidence({
          rootSessionID: root.id,
          sessionID: root.id,
          at: 240,
          fact: "The current baton rollout is materially improving continuity behavior.",
          sourceAnchor: "baton-registry.test.ts validation run",
          trustBasis: "validated by focused baton tests and prompt checks",
          freshness: "fresh",
          confidence: 0.92,
        })

        // @ts-ignore
        const inspected = await SessionMission.inspectBatons({ sessionID: root.id })
        expect(inspected.rootSessionID).toBe(root.id)
        expect(inspected.registry.rootSessionID).toBe(root.id)
        expect(inspected.registry.batons.some((item: { kind: string }) => item.kind === "mission")).toBe(true)
        expect(inspected.registry.batons.some((item: { kind: string }) => item.kind === "authority")).toBe(true)
        expect(inspected.registry.batons.some((item: { kind: string }) => item.kind === "decision")).toBe(true)
        expect(inspected.registry.batons.some((item: { kind: string }) => item.kind === "evidence")).toBe(true)
        expect(inspected.registry.batons.some((item: { kind: string }) => item.kind === "open_loops")).toBe(true)
        expect(inspected.mission).toContain("Keep inspection agent-centric.")
        expect(inspected.authority).toContain("Do not act beyond: registry inspection")
        expect(inspected.decisions).toContain("Expose only active baton text through inspectBatons.")
        expect(inspected.evidence).toContain("The current baton rollout is materially improving continuity behavior.")
        expect(inspected.openLoops).toContain("Verify inspectBatons returns the same baton family snapshot.")
      },
    })
  })
})
