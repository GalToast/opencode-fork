import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { TaskTool } from "../../src/tool/task"
import { Bus } from "../../src/bus"
import { SessionStatus } from "../../src/session/status"
import { ExecutionLedger } from "../../src/execution/ledger"
import { resetDatabase } from "../fixture/db"

async function createSupervisorContext(input: { tmpPath: string; callID: string }) {
  const parentModel = {
    providerID: "alibaba-coding-plan" as any,
    modelID: "glm-5" as any,
  }
  const supervisor = await Session.create({})
  const parentUserID = Identifier.ascending("message")
  await Session.updateMessage({
    // @ts-ignore
    id: parentUserID,
    sessionID: supervisor.id,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: parentModel,
  })
  const anchorAssistantID = Identifier.ascending("message")
  await Session.updateMessage({
    // @ts-ignore
    id: anchorAssistantID,
    sessionID: supervisor.id,
    role: "assistant",
    time: { created: Date.now(), completed: Date.now() },
    // @ts-ignore
    parentID: parentUserID,
    modelID: parentModel.modelID,
    providerID: parentModel.providerID,
    mode: "build",
    agent: "build",
    path: {
      cwd: input.tmpPath,
      root: input.tmpPath,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  })
  return {
    supervisor,
    ctx: {
      sessionID: supervisor.id,
      messageID: anchorAssistantID,
      callID: input.callID,
      agent: "build",
      abort: AbortSignal.any([]),
      extra: { bypassAgentCheck: true },
      messages: [],
      metadata: () => {},
      ask: async () => {},
    },
  }
}

describe("task wait settlement", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("settles wait when execution is completed but runtime still looks running", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { supervisor, ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-wait-ledger-settlement",
        })
        const task = await Session.create({
          parentID: supervisor.id,
          title: "Ledger-settled worker",
        })
        const userID = Identifier.ascending("message")
        await Session.updateMessage({
          // @ts-ignore
          id: userID,
          sessionID: task.id,
          role: "user",
          time: { created: Date.now() },
          agent: "general",
          model: { providerID: "alibaba-coding-plan" as any, modelID: "glm-5" as any },
        })
        await ExecutionLedger.append({
          jobID: task.id,
          sessionID: task.id,
          supervisorSessionID: supervisor.id,
          kind: "task",
          lane: "subagent_tasks",
          priority: "background",
          phase: "running",
          status: "running",
          description: "ledger-settled worker",
          time: Date.now(),
          source: "task",
          action: "turn",
          messageID: userID,
          pendingTurns: 1,
          queuedTurns: 0,
          paused: false,
        })

        const tool = await TaskTool.init()
        await tool.execute(
          {
            // @ts-ignore
            action: "status",
            task_id: task.id,
          },
          ctx,
        )
        const waiting = tool.execute(
          {
            // @ts-ignore
            action: "wait",
            task_id: task.id,
            timeout_ms: 3_000,
          },
          ctx,
        )

        await Bun.sleep(500)
        await ExecutionLedger.append({
          jobID: task.id,
          sessionID: task.id,
          supervisorSessionID: ctx.sessionID,
          kind: "task",
          lane: "subagent_tasks",
          priority: "background",
          phase: "completed",
          status: "completed",
          description: "ledger-settled worker",
          time: Date.now(),
          source: "task",
          action: "turn_complete",
          pendingTurns: 0,
          queuedTurns: 0,
          paused: false,
        })
        const assistantID = Identifier.ascending("message")
        await Session.updateMessage({
          // @ts-ignore
          id: assistantID,
          sessionID: task.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          // @ts-ignore
          parentID: userID,
          modelID: "glm-5" as any,
          providerID: "alibaba-coding-plan" as any,
          mode: "build",
          agent: "general",
          path: {
            cwd: tmp.path,
            root: tmp.path,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        })
        await Bus.publish(SessionStatus.Event.Status, {
          sessionID: task.id,
          status: { type: "idle" },
        })

        const waited = await Promise.race([
          waiting,
          Bun.sleep(3_500).then(() => "timeout" as const),
        ])

        expect(waited).not.toBe("timeout")
        if (waited === "timeout") return
        expect(waited.title).toBe("Task completed: Resumed task @general")
        // @ts-ignore
        expect(waited.metadata.settled).toBe(true)
        // @ts-ignore
        expect(waited.metadata.waitReason).toBe("settled")
        // @ts-ignore
        expect(waited.metadata.status).toBe("completed")
        expect(waited.output).toContain("status: completed")
        expect(waited.output).toContain("pending_turns: 0")
        expect(waited.output).toContain("queued_turns: 0")
        expect(waited.output).toContain("execution_latest_phase: completed")
      },
    })
  }, 20_000)
})
