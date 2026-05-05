import { describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { SessionPlanState } from "../../src/session/plan-state"
// @ts-ignore
import { PlanEnterTool, PlanExitTool } from "../../src/tool/plan"
import { tmpdir } from "../fixture/fixture"

const baseCtx = {
  sessionID: "",
  messageID: "msg_test" as any,
  callID: "call_test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.plan", () => {
  test(
    "enter_plan_mode switches to the plan agent",
    async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const question = spyOn(Question, "ask")
        question.mockResolvedValue([["Yes"]])

        const tool = await PlanEnterTool.init()
        const result = await tool.execute(
          { reason: "Need to investigate architecture" },
          { ...baseCtx, sessionID: session.id },
        )

        expect(result.title).toBe("Switching to plan agent")

        const messages = await Session.messages({ sessionID: session.id })
        const last = messages.at(-1)
        const state = await SessionPlanState.get(session.id)
        expect(last?.info.agent).toBe("plan")
        expect(state?.mode).toBe("planning")
        expect(state?.pendingPlanPath).toBe(path.relative(tmp.path, Session.plan(session)))
        expect(last?.parts.some((part) => part.type === "text" && part.text.includes("Need to investigate architecture"))).toBe(
          true,
        )
        question.mockRestore()
      },
    })
    },
    20_000,
  )

  test(
    "exit_plan_mode switches to the build agent after approval",
    async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const planPath = Session.plan(session)
        await fs.mkdir(path.dirname(planPath), { recursive: true })
        await fs.writeFile(planPath, "# Plan\n\n- Do the thing\n", "utf8")

        const question = spyOn(Question, "ask")
        question.mockResolvedValue([["Approve"]])

        const tool = await PlanExitTool.init()
        const result = await tool.execute(
          // @ts-ignore
          { plan_path: path.relative(tmp.path, planPath) },
          { ...baseCtx, sessionID: session.id, agent: "plan" },
        )

        expect(result.output).toContain("Plan approved")

        const messages = await Session.messages({ sessionID: session.id })
        const last = messages.at(-1)
        const state = await SessionPlanState.get(session.id)
        expect(last?.info.agent).toBe("build")
        expect(state?.mode).toBe("approved")
        expect(state?.approvedPlanPath).toBe(path.relative(tmp.path, planPath))
        expect(last?.parts.some((part) => part.type === "text" && part.text.includes("has been approved"))).toBe(true)
        question.mockRestore()
      },
    })
    },
    20_000,
  )

  test(
    "exit_plan_mode records feedback and returns to planning state when not approved",
    async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const planPath = Session.plan(session)
        await fs.mkdir(path.dirname(planPath), { recursive: true })
        await fs.writeFile(planPath, "# Plan\n\n- Try another approach\n", "utf8")

        const question = spyOn(Question, "ask")
        question.mockResolvedValue([["Please reduce risk first"]])

        const tool = await PlanExitTool.init()
        const result = await tool.execute(
          // @ts-ignore
          { plan_path: path.relative(tmp.path, planPath) },
          { ...baseCtx, sessionID: session.id, agent: "plan" },
        )

        const state = await SessionPlanState.get(session.id)
        expect(result.output).toContain("Feedback: Please reduce risk first")
        expect(state?.mode).toBe("planning")
        expect(state?.feedback).toBe("Please reduce risk first")
        question.mockRestore()
      },
    })
    },
    20_000,
  )
})
