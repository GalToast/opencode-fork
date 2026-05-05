import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageID } from "../../src/session/schema"
import { HarnessBlackboard } from "../../src/harness/blackboard"
import { tmpdir } from "../fixture/fixture"
import {
  BlackboardTool,
  BlackboardAppendTool,
  BlackboardClearTool,
  BlackboardCompareAndSwapTool,
  BlackboardDeleteTool,
  BlackboardGetTool,
  BlackboardIncrementTool,
} from "../../src/tool/blackboard"

const baseCtx = {
  messageID: MessageID.make("message_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("HarnessBlackboard", () => {
  test("shares state across parent, child, and grandchild sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ title: "parent" })
        const child = await Session.create({ parentID: parent.id, title: "child" })
        const grandchild = await Session.create({ parentID: child.id, title: "grandchild" })

        HarnessBlackboard.clear(parent.id)

        await HarnessBlackboard.set(parent.id, "entry", { file: "src/index.ts" }, parent.id)
        expect(HarnessBlackboard.get<{ file: string }>(child.id, "entry")).toEqual({ file: "src/index.ts" })
        expect(HarnessBlackboard.get<{ file: string }>(grandchild.id, "entry")).toEqual({ file: "src/index.ts" })

        await HarnessBlackboard.set(grandchild.id, "rootCause", "stale-child-focus", grandchild.id)
        expect(HarnessBlackboard.get<string>(parent.id, "rootCause")).toBe("stale-child-focus")
        expect(HarnessBlackboard.get<string>(child.id, "rootCause")).toBe("stale-child-focus")
      },
    })
  })

  test("supports richer blackboard mutations through the tool layer", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ title: "parent" })
        const child = await Session.create({ parentID: parent.id, title: "child" })

        HarnessBlackboard.clear(parent.id)

        const append = await BlackboardAppendTool.init()
        const increment = await BlackboardIncrementTool.init()
        const compareAndSwap = await BlackboardCompareAndSwapTool.init()
        const get = await BlackboardGetTool.init()
        const remove = await BlackboardDeleteTool.init()
        const clear = await BlackboardClearTool.init()

        const ctx = { ...baseCtx, sessionID: child.id }

        const appended = await append.execute({ key: "findings", value: "missing-cache-guard" }, ctx)
        expect(appended.output).toContain("missing-cache-guard")

        const counter = await increment.execute({ key: "completed", delta: 2 }, ctx)
        expect(counter.output).toBe("2")

        const cas = await compareAndSwap.execute(
          { key: "status", expectedValue: undefined, value: "triaging" },
          ctx,
        )
        expect(cas.output).toContain('"success": true')

        const status = await get.execute({ key: "status" }, ctx)
        expect(status.output).toContain("triaging")

        const deleted = await remove.execute({ key: "status" }, ctx)
        expect(deleted.output).toContain("Deleted blackboard key 'status'")
        expect(HarnessBlackboard.get(parent.id, "status")).toBeUndefined()

        await clear.execute({}, ctx)
        expect(HarnessBlackboard.getAll(parent.id)).toEqual({})
      },
    })
  })

  test("supports high-level coordination patterns through the blackboard wrapper", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ title: "parent" })
        const child = await Session.create({ parentID: parent.id, title: "child" })
        const sibling = await Session.create({ parentID: parent.id, title: "sibling" })

        HarnessBlackboard.clear(parent.id)

        const board = await BlackboardTool.init()
        const ctx = { ...baseCtx, sessionID: child.id, agent: "explore" }

        const claim = await board.execute(
          { action: "claim_ownership", resource: "sidebar-audit", owner: "lane-a", note: "checking renderers" },
          ctx,
        )
        expect(claim.output).toContain("Claimed 'sidebar-audit'")

        const duplicateClaim = await board.execute(
          { action: "claim_ownership", resource: "sidebar-audit", owner: "lane-b" },
          { ...baseCtx, sessionID: sibling.id, agent: "general" },
        )
        expect(duplicateClaim.output).toContain("already claimed")

        const finding = await board.execute(
          {
            action: "publish_finding",
            topic: "session-tools",
            summary: "generic renderer fallback still appears for old tools",
            severity: "medium",
            evidence: ["src/cli/cmd/tui/routes/session/index.tsx"],
          },
          ctx,
        )
        expect(finding.output).toContain("Published medium finding")

        const blocker = await board.execute(
          {
            action: "share_blocker",
            resource: "tool-ux-polish",
            summary: "Need dedicated renderers before exposing more tools",
            nextStep: "Add blackboard-aware transcript components",
            severity: "high",
          },
          ctx,
        )
        expect(blocker.output).toContain("Shared high blocker")

        const snapshot = await board.execute({ action: "read" }, ctx)
        expect(snapshot.output).toContain("ownership:sidebar-audit")
        expect(snapshot.output).toContain('"topic": "session-tools"')
        expect(snapshot.output).toContain("blocker:tool-ux-polish")
      },
    })
  })

  test("filters blackboard subscriptions to the same root session family", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rootA = await Session.create({ title: "root-a" })
        const childA = await Session.create({ parentID: rootA.id, title: "child-a" })
        const rootB = await Session.create({ title: "root-b" })

        HarnessBlackboard.clear(rootA.id)
        HarnessBlackboard.clear(rootB.id)

        const seenA: Array<{ key: string; updater: string }> = []
        const seenB: Array<{ key: string; updater: string }> = []

        const unsubscribeA = HarnessBlackboard.subscribe(childA.id, (key, _value, updater) => {
          seenA.push({ key, updater })
        })
        const unsubscribeB = HarnessBlackboard.subscribe(rootB.id, (key, _value, updater) => {
          seenB.push({ key, updater })
        })

        try {
          await HarnessBlackboard.set(rootA.id, "shared", "alpha", rootA.id)
          await HarnessBlackboard.set(rootB.id, "isolated", "beta", rootB.id)
        } finally {
          unsubscribeA()
          unsubscribeB()
        }

        expect(seenA).toEqual([{ key: "shared", updater: rootA.id }])
        expect(seenB).toEqual([{ key: "isolated", updater: rootB.id }])
      },
    })
  })
})
