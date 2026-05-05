import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import { type SessionID, MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"
import { SessionPlanState } from "../session/plan-state"

async function getLastModel(sessionID: SessionID) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({
    plan_path: z.string().optional(),
  }),
  async execute(params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = params.plan_path ?? path.relative(Instance.worktree, Session.plan(session))
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Plan at ${plan} is complete. Approve it for build mode, or provide feedback to keep planning.`,
          header: "Build Agent",
          custom: true,
          options: [
            { label: "Approve", description: "Switch to build agent and start implementing the plan" },
            { label: "Revise", description: "Stay with plan agent and record feedback" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    if (answer !== "Approve") {
      const feedback = answer && answer !== "Revise" ? answer : undefined
      await SessionPlanState.set(ctx.sessionID, {
        mode: "planning",
        pendingPlanPath: plan,
        feedback,
      })
      return {
        title: "Plan needs revision",
        output: feedback ? `Feedback: ${feedback}` : "Plan needs revision. Continue planning.",
        metadata: { feedback, planPath: undefined as string | undefined },
      }
    }

    const model = await getLastModel(ctx.sessionID)

    await SessionPlanState.set(ctx.sessionID, {
      mode: "approved",
      approvedPlanPath: plan,
    })

    const userMsg: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "build",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to build agent",
      output: "Plan approved. Switching to build agent.",
      metadata: { feedback: undefined as string | undefined, planPath: plan },
    }
  },
})

export const PlanEnterTool = Tool.define("plan_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({
    reason: z.string().optional(),
  }),
  async execute(params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = path.relative(Instance.worktree, Session.plan(session))

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Would you like to switch to the plan agent and create a plan saved to ${plan}?`,
          header: "Plan Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to plan agent for research and planning" },
            { label: "No", description: "Stay with build agent to continue making changes" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]

    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    await SessionPlanState.set(ctx.sessionID, {
      mode: "planning",
      pendingPlanPath: plan,
    })

    const userMsg: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "plan",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: [
        "User has requested to enter plan mode. Switch to plan mode and begin planning.",
        params.reason ? `Reason: ${params.reason}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to plan agent",
      output: `User confirmed to switch to plan mode. A new message has been created to switch you to plan mode. The plan file will be at ${plan}. Begin planning.`,
      metadata: {},
    }
  },
})
