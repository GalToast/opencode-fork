// @ts-nocheck - TODO: re-enable when task routing APIs are restored
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { TaskEvent, TaskTool, selectTaskArtifactCandidate } from "../../src/tool/task"
import { Bus } from "../../src/bus"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionSteerInterrupt } from "../../src/session/interrupt"
import { ExecutionLedger } from "../../src/execution/ledger"
import { SessionWorkGraph } from "../../src/session/workgraph"
import { resetDatabase } from "../fixture/db"
import { Agent } from "../../src/agent/agent"

let promptSpy: any

async function createSupervisorContext(input: {
  tmpPath: string
  callID: string
  abort?: AbortSignal
  metadata?: (value: any) => void
  parentModel?: {
    providerID: string
    modelID: string
  }
}) {
  const parentModel = input.parentModel ?? {
    providerID: "openai" as any,
    modelID: "gpt-5.2" as any,
  }
  const supervisor = await Session.create({})
  const parentUserID = Identifier.ascending("message")
  await Session.updateMessage({
    id: parentUserID,
    sessionID: supervisor.id,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: parentModel,
  })

  const anchorAssistantID = Identifier.ascending("message")
  await Session.updateMessage({
    id: anchorAssistantID,
    sessionID: supervisor.id,
    role: "assistant",
    time: { created: Date.now(), completed: Date.now() },
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
      abort: input.abort ?? AbortSignal.any([]),
      extra: { bypassAgentCheck: true },
      messages: [],
      metadata: input.metadata ?? (() => {}),
      ask: async () => {},
    },
  }
}

describe("tool.task mailbox smoke", () => {
  beforeEach(() => {
    promptSpy = spyOn(SessionPrompt as any, "prompt").mockImplementation(async (input: any) => {
      const messageID = Identifier.ascending("message")
      return {
        info: {
          id: messageID,
          sessionID: input.sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: input.agent ?? "general",
          model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        },
        parts: [
          {
            id: Identifier.ascending("part"),
            sessionID: input.sessionID,
            messageID,
            type: "text",
            text: "mocked subagent reply",
          },
        ],
      }
    })
  })

  afterEach(async () => {
    promptSpy.mockRestore()
    await resetDatabase()
  })

  test("ignores failed and canceled sibling artifacts during arbitration", () => {
    const now = Date.now()
    const candidate = selectTaskArtifactCandidate({
      job: {
        taskID: "ses_orchestrator",
        parentSessionID: "ses_parent",
        swarmTemplate: "review",
        expectedArtifact: "critique",
      },
      jobs: [
        {
          taskID: "ses_failed",
          parentSessionID: "ses_parent",
          discipline: "adversarial",
          schedulerLane: "adversarial_review",
          status: "error",
          swarmTemplate: "review",
          artifacts: [
            {
              id: "art_failed",
              type: "critique",
              summary: "failed sibling critique",
              text: "stale failed critique",
              createdAt: now,
              template: "review",
            },
          ],
        },
        {
          taskID: "ses_canceled",
          parentSessionID: "ses_parent",
          discipline: "adversarial",
          schedulerLane: "adversarial_review",
          status: "canceled",
          swarmTemplate: "review",
          artifacts: [
            {
              id: "art_canceled",
              type: "critique",
              summary: "canceled sibling critique",
              text: "stale canceled critique",
              createdAt: now + 1,
              template: "review",
            },
          ],
        },
        {
          taskID: "ses_completed",
          parentSessionID: "ses_parent",
          discipline: "synthesis",
          schedulerLane: "subagent_tasks",
          status: "completed",
          swarmTemplate: "review",
          artifacts: [
            {
              id: "art_completed",
              type: "draft",
              summary: "completed sibling draft",
              text: "usable completed artifact",
              createdAt: now + 2,
              template: "review",
            },
          ],
        },
      ],
    })

    expect(candidate?.taskID).toBe("ses_completed")
    expect(candidate?.summary).toBe("completed sibling draft")
  })

  test("action=start ignores placeholder task_id values and creates a fresh task session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "placeholder id start succeeded",
              },
            ],
          }
        })

        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-placeholder-task-id",
        })

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            action: "start",
            task_id: "read_pkg_version",
            subagent_type: "general",
            description: "placeholder id worker",
            prompt: "Read one file and report success.",
            wait_for_result: true,
          },
          ctx,
        )

        expect(result.metadata.sessionId).toStartWith("ses_")
        expect(result.metadata.sessionId).not.toBe("read_pkg_version")
        expect(result.output).toContain("placeholder id start succeeded")
      },
    })
  })

  test("aliases search subagents to explore instead of failing", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-search-alias",
        })

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            action: "start",
            subagent_type: "search",
            description: "search alias worker",
            prompt: "Look around the repo quickly.",
            wait_for_result: true,
          },
          ctx,
        )

        const session = await Session.get(result.metadata.sessionId as string)
        expect(session.title).toContain("(@explore subagent)")
        expect(result.output).toContain("mocked subagent reply")
      },
    })
  })

  test("prefers an explicit task model override over the subagent default model", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const originalAgentGet = Agent.get
        const agentSpy = spyOn(Agent, "get").mockImplementation(async (name: string) => {
          const found = await originalAgentGet(name as any)
          if (name === "general" && found) {
            return {
              ...found,
              model: {
                providerID: "openrouter" as any,
                modelID: "codex-spark" as any,
              },
            }
          }
          return found
        })

        promptSpy.mockImplementation(async (input: any) => {
          expect(input.model).toEqual({
            providerID: "openai" as any,
            modelID: "gpt-5.2-mini" as any,
          })
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model,
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "model override succeeded",
              },
            ],
          }
        })

        try {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-model-override",
          })

          const tool = await TaskTool.init()
          const result = await tool.execute(
            {
              action: "start",
              subagent_type: "general",
              description: "model override worker",
              prompt: "Keep the inherited heavy-task model.",
              wait_for_result: true,
              model: {
                providerID: "openai" as any,
                modelID: "gpt-5.2-mini" as any,
              },
            },
            ctx,
          )

          expect(result.output).toContain("model override succeeded")
        } finally {
          agentSpy.mockRestore()
        }
      },
    })
  })

  test("keeps general subagents on the parent model even if the general agent has a configured default model", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const originalAgentGet = Agent.get
        const agentSpy = spyOn(Agent, "get").mockImplementation(async (name: string) => {
          const found = await originalAgentGet(name as any)
          if (name === "general" && found) {
            return {
              ...found,
              model: {
                providerID: "openrouter" as any,
                modelID: "codex-spark" as any,
              },
            }
          }
          return found
        })

        promptSpy.mockImplementation(async (input: any) => {
          expect(input.model).toEqual({
            providerID: "openai" as any,
            modelID: "gpt-5.2" as any,
          })
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model,
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "parent model inheritance succeeded",
              },
            ],
          }
        })

        try {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-general-parent-model",
          })

          const tool = await TaskTool.init()
          const result = await tool.execute(
            {
              action: "start",
              subagent_type: "general",
              description: "inherit the parent model",
              prompt: "Stay on the supervisor's active model.",
              wait_for_result: true,
            },
            ctx,
          )

          expect(result.output).toContain("parent model inheritance succeeded")
        } finally {
          agentSpy.mockRestore()
        }
      },
    })
  })

  test("keeps non-general subagents on the parent model when their configured default is codex-spark", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const originalAgentGet = Agent.get
        const agentSpy = spyOn(Agent, "get").mockImplementation(async (name: string) => {
          const found = await originalAgentGet(name as any)
          if (name === "explore" && found) {
            return {
              ...found,
              model: {
                providerID: "openrouter" as any,
                modelID: "codex-spark" as any,
              },
            }
          }
          return found
        })

        promptSpy.mockImplementation(async (input: any) => {
          expect(input.model).toEqual({
            providerID: "bailian-coding-plan-test" as any,
            modelID: "qwen3.5-plus" as any,
          })
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "explore",
              model: input.model,
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "non-general parent model inheritance succeeded",
              },
            ],
          }
        })

        try {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-explore-parent-model",
            parentModel: {
              providerID: "bailian-coding-plan-test" as any,
              modelID: "qwen3.5-plus" as any,
            },
          })

          const tool = await TaskTool.init()
          const result = await tool.execute(
            {
              action: "start",
              subagent_type: "explore",
              description: "inherit the parent model for explore",
              prompt: "Stay on the supervisor's active model instead of your configured spark default.",
              wait_for_result: true,
            },
            ctx,
          )

          expect(result.output).toContain("non-general parent model inheritance succeeded")
        } finally {
          agentSpy.mockRestore()
        }
      },
    })
  })

  test("persists completed task lanes into the supervisor workgraph before returning", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { supervisor, ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-workgraph-complete",
        })

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            action: "start",
            subagent_type: "general",
            description: "completed worker",
            prompt: "Finish one bounded task.",
            wait_for_result: true,
          },
          ctx,
        )

        const taskID = result.metadata.sessionId as string
        let lane: any
        for (let attempt = 0; attempt < 10; attempt++) {
          const graph = await SessionWorkGraph.get(supervisor.id)
          lane = graph?.lanes.find((item) => item.id === taskID)
          if (lane?.status === "completed") break
          await Bun.sleep(25)
        }
        expect(lane?.status).toBe("completed")
        expect(lane?.lastMessageID).toBeDefined()
      },
    })
  })

test("runs relay + broadcast through supervisor and emits inbox lifecycle updates", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const supervisor = await Session.create({})
        const parentUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentUserID,
          sessionID: supervisor.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        const anchorAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: anchorAssistantID,
          sessionID: supervisor.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: parentUserID,
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "build",
          agent: "build",
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

        const ctx = {
          sessionID: supervisor.id,
          messageID: anchorAssistantID,
          callID: "call-smoke",
          agent: "build",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const updates: Array<{
          status: string
          taskID: string
          supervisorSessionID?: string
        }> = []
        const unsub = Bus.subscribe(TaskEvent.SupervisorInbox, (event) => {
          updates.push({
            status: event.properties.status,
            taskID: event.properties.taskID,
            supervisorSessionID: event.properties.supervisorSessionID,
          })
        })

        const tool = await TaskTool.init()
        const startOne = await tool.execute(
          {
            action: "start",
            subagent_type: "general",
            description: "agent one",
            prompt: "analyze module A",
            wait_for_result: true,
          },
          ctx,
        )
        const taskOne = startOne.metadata.sessionId as string

        const startTwo = await tool.execute(
          {
            action: "start",
            subagent_type: "general",
            description: "agent two",
            prompt: "analyze module B",
            wait_for_result: true,
          },
          ctx,
        )
        const taskTwo = startTwo.metadata.sessionId as string

        const startThree = await tool.execute(
          {
            action: "start",
            subagent_type: "general",
            description: "agent three",
            prompt: "analyze module C",
            wait_for_result: true,
          },
          ctx,
        )
        const taskThree = startThree.metadata.sessionId as string

        const relay = await tool.execute(
          {
            action: "relay",
            from_task_id: taskOne,
            to_task_id: taskTwo,
            prompt: "share your findings and continue",
            wait_for_result: true,
          },
          ctx,
        )
        expect(relay.output).toContain("relay_count: 1")
        expect(relay.output).toContain(`task_id: ${taskTwo}`)

        const broadcast = await tool.execute(
          {
            action: "broadcast",
            from_task_id: taskOne,
            to_task_ids: [taskTwo, taskThree],
            prompt: "synchronize your conclusions",
            wait_for_result: true,
          },
          ctx,
        )
        expect(broadcast.output).toContain("relay_count: 2")
        expect(broadcast.output).toContain(`task_id: ${taskTwo}`)
        expect(broadcast.output).toContain(`task_id: ${taskThree}`)

        await Bun.sleep(25)
        unsub()

        const supervisorUpdates = updates.filter((u) => u.supervisorSessionID === supervisor.id)
        expect(supervisorUpdates.some((u) => u.status === "queued")).toBe(true)
        expect(supervisorUpdates.some((u) => u.status === "started")).toBe(true)
        expect(supervisorUpdates.some((u) => u.status === "completed")).toBe(true)
        expect(supervisorUpdates.some((u) => u.taskID === taskTwo && u.status === "completed")).toBe(true)
      },
    })
  })

  test("applies adversarial discipline contract to routed task prompts", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let capturedInput: any
        promptSpy.mockImplementation(async (input: any) => {
          capturedInput = input
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "mocked adversarial reply",
              },
            ],
          }
        })

        const supervisor = await Session.create({})
        const parentUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentUserID,
          sessionID: supervisor.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        const anchorAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: anchorAssistantID,
          sessionID: supervisor.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: parentUserID,
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "build",
          agent: "build",
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

        const ctx = {
          sessionID: supervisor.id,
          messageID: anchorAssistantID,
          callID: "call-adversarial-contract",
          agent: "build",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            action: "start",
            lane_hint: "adversarial",
            subagent_type: "general",
            description: "review risky patch",
            prompt: "Find hidden regressions in this change.",
            wait_for_result: true,
          },
          ctx,
        )

        expect(result.metadata.discipline).toBe("adversarial")
        expect(result.metadata.schedulerLane).toBe("adversarial_review")
        const textPrompt = capturedInput.parts.find((part: any) => part.type === "text")?.text
        expect(textPrompt).toContain("Operating discipline: adversarial reviewer.")
        expect(textPrompt).toContain("Assigned task: review risky patch")
        expect(textPrompt).toContain("Find hidden regressions in this change.")
      },
    })
  })

  test("keeps ordinary lane review tasks out of the adversarial scheduler lane", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let capturedInput: any
        promptSpy.mockImplementation(async (input: any) => {
          capturedInput = input
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "explore",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "ordinary lane review reply",
              },
            ],
          }
        })

        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-normal-review-lane",
        })

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            action: "start",
            subagent_type: "explore",
            description: "Algorithmic correctness lane review",
            prompt: "Analyze src/math.ts for correctness only. Do not edit files.",
            wait_for_result: true,
          },
          ctx,
        )

        expect(result.metadata.discipline).toBe("research")
        expect(result.metadata.schedulerLane).toBe("subagent_tasks")
        const textPrompt = capturedInput.parts.find((part: any) => part.type === "text")?.text ?? ""
        expect(textPrompt).not.toContain("Operating discipline: adversarial reviewer.")
        expect(textPrompt).toContain("Operating discipline: research scout.")
      },
    })
  })

  test("accepts natural lane_hint aliases like analysis and routes them to research", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-analysis-alias",
        })

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            action: "start",
            lane_hint: "analysis" as any,
            subagent_type: "explore",
            description: "API ergonomics lane analysis",
            prompt: "Analyze src/strings.ts for API ergonomics only. Do not edit files.",
            wait_for_result: true,
          },
          ctx,
        )

        expect(result.metadata.discipline).toBe("research")
        expect(result.metadata.schedulerLane).toBe("subagent_tasks")
      },
    })
  })

  test("does not auto-queue adversarial review for risky worker results", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const capturedPrompts: string[] = []
        promptSpy.mockImplementation(async (input: any) => {
          const textPrompt = input.parts.find((part: any) => part.type === "text")?.text ?? ""
          capturedPrompts.push(textPrompt)
          const messageID = Identifier.ascending("message")
          const text = textPrompt.includes("Operating discipline: adversarial reviewer.")
            ? "Potential regression: the lane budget can starve longrun jobs."
            : "Patched the scheduler and updated the main turn queue."
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text,
              },
            ],
          }
        })

        const supervisor = await Session.create({})
        const parentUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentUserID,
          sessionID: supervisor.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        const anchorAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: anchorAssistantID,
          sessionID: supervisor.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: parentUserID,
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "build",
          agent: "build",
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

        const ctx = {
          sessionID: supervisor.id,
          messageID: anchorAssistantID,
          callID: "call-auto-review",
          agent: "build",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const tool = await TaskTool.init()
        const start = await tool.execute(
          {
            action: "start",
            lane_hint: "worker",
            subagent_type: "general",
            description: "risky scheduler patch",
            prompt: "Patch the scheduler logic and verify regressions in queue fairness.",
            wait_for_result: true,
          },
          ctx,
        )
        expect(start.metadata.reviewStatus).toBe("idle")
        expect(capturedPrompts).toHaveLength(1)
      },
    })
  })

  test("does not auto-review ordinary research lanes by default", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const capturedPrompts: string[] = []
        promptSpy.mockImplementation(async (input: any) => {
          capturedPrompts.push(input.parts.find((part: any) => part.type === "text")?.text ?? "")
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "explore",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "Summarized the API ergonomics issues and tradeoffs.",
              },
            ],
          }
        })

        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-no-auto-review-research",
        })

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            action: "start",
            lane_hint: "research",
            subagent_type: "explore",
            description: "API ergonomics lane analysis",
            prompt: "Analyze src/strings.ts for API ergonomics only. Do not edit files.",
            wait_for_result: true,
          },
          ctx,
        )

        expect(result.metadata.reviewStatus).toBe("idle")
        expect(capturedPrompts).toHaveLength(1)
      },
    })
  })

  test("does not auto-review high-risk research lanes without an explicit adversarial task", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const capturedPrompts: string[] = []
        promptSpy.mockImplementation(async (input: any) => {
          const textPrompt = input.parts.find((part: any) => part.type === "text")?.text ?? ""
          capturedPrompts.push(textPrompt)
          const messageID = Identifier.ascending("message")
          const text = textPrompt.includes("Operating discipline: adversarial reviewer.")
            ? "Potential regression remains in the security guard."
            : "Security analysis found a critical regression path affecting production requests."
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "explore",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text,
              },
            ],
          }
        })

        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-auto-review-high-risk-research",
        })

        const tool = await TaskTool.init()
        const start = await tool.execute(
          {
            action: "start",
            lane_hint: "research",
            subagent_type: "explore",
            description: "Security findings lane",
            prompt: "Analyze the request path for security regressions affecting production traffic. Do not edit files.",
            wait_for_result: true,
          },
          ctx,
        )
        expect(start.metadata.reviewStatus).toBe("idle")
        expect(capturedPrompts).toHaveLength(1)
      },
    })
  })

  test("does not recursively auto-review adversarial tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const capturedPrompts: string[] = []
        promptSpy.mockImplementation(async (input: any) => {
          capturedPrompts.push(input.parts.find((part: any) => part.type === "text")?.text ?? "")
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "adversarial review finished",
              },
            ],
          }
        })

        const supervisor = await Session.create({})
        const parentUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentUserID,
          sessionID: supervisor.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        const anchorAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: anchorAssistantID,
          sessionID: supervisor.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: parentUserID,
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "build",
          agent: "build",
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

        const ctx = {
          sessionID: supervisor.id,
          messageID: anchorAssistantID,
          callID: "call-no-recursion",
          agent: "build",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            action: "start",
            lane_hint: "adversarial",
            subagent_type: "general",
            description: "review the risky scheduler patch",
            prompt: "Find regressions in the scheduler patch.",
            wait_for_result: true,
          },
          ctx,
        )

        expect(result.metadata.reviewStatus).toBe("idle")
        expect(capturedPrompts).toHaveLength(1)
      },
    })
  })

  test("captures structured artifact metadata for worker patch tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "Artifact Summary: Queue fairness patch ready\nApplied the queue fairness patch and updated retries.",
              },
            ],
          }
        })

        const supervisor = await Session.create({})
        const parentUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentUserID,
          sessionID: supervisor.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        const anchorAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: anchorAssistantID,
          sessionID: supervisor.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: parentUserID,
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "build",
          agent: "build",
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

        const ctx = {
          sessionID: supervisor.id,
          messageID: anchorAssistantID,
          callID: "call-artifact-worker",
          agent: "build",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            action: "start",
            lane_hint: "worker",
            swarm_template: "patch",
            expected_artifact: "patch",
            subagent_type: "general",
            description: "queue fairness patch",
            prompt: "Patch the queue fairness logic.",
            wait_for_result: true,
          },
          ctx,
        )

        expect(result.metadata.swarmTemplate).toBe("patch")
        expect(result.metadata.expectedArtifact).toBe("patch")
        expect(result.metadata.artifactCount).toBe(1)
        expect(result.metadata.artifactType).toBe("patch")
        expect(result.metadata.artifactSummary).toBe("Queue fairness patch ready")

        const status = await tool.execute(
          {
            action: "status",
            task_id: result.metadata.sessionId as string,
          },
          ctx,
        )

        expect(status.output).toContain("swarm_template: patch")
        expect(status.output).toContain("expected_artifact: patch")
        expect(status.output).toContain("artifact_type: patch")
        expect(status.output).toContain("artifact_summary: Queue fairness patch ready")
      },
    })
  })

  test("orchestrator status surfaces the best sibling artifact candidate", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          const textPrompt = input.parts.find((part: any) => part.type === "text")?.text ?? ""
          const messageID = Identifier.ascending("message")
          const text = textPrompt.includes("Operating discipline: adversarial reviewer.")
            ? "Artifact Summary: Regression critique ready\nFound a hidden starvation regression in the patch."
            : textPrompt.includes("Operating discipline: orchestrator.")
              ? "Artifact Summary: Review arbitration started\nCollecting candidate outputs for arbitration."
              : "Artifact Summary: Patch candidate ready\nMinimal queue patch prepared for merge."
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text,
              },
            ],
          }
        })

        const supervisor = await Session.create({})
        const parentUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentUserID,
          sessionID: supervisor.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        const anchorAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: anchorAssistantID,
          sessionID: supervisor.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: parentUserID,
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "build",
          agent: "build",
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

        const ctx = {
          sessionID: supervisor.id,
          messageID: anchorAssistantID,
          callID: "call-orchestrator-arbitration",
          agent: "build",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const tool = await TaskTool.init()
        const orchestrator = await tool.execute(
          {
            action: "start",
            lane_hint: "orchestrator",
            swarm_template: "review",
            expected_artifact: "critique",
            subagent_type: "general",
            description: "arbitrate swarm review",
            prompt: "Coordinate workers and pick the most important critique.",
            wait_for_result: true,
          },
          ctx,
        )

        await tool.execute(
          {
            action: "start",
            lane_hint: "worker",
            swarm_template: "patch",
            expected_artifact: "patch",
            subagent_type: "general",
            description: "worker patch candidate",
            prompt: "Produce a minimal patch candidate.",
            wait_for_result: true,
          },
          ctx,
        )

        const adversarial = await tool.execute(
          {
            action: "start",
            lane_hint: "adversarial",
            swarm_template: "review",
            expected_artifact: "critique",
            subagent_type: "general",
            description: "adversarial review candidate",
            prompt: "Red team the patch and surface the biggest regression.",
            wait_for_result: true,
          },
          ctx,
        )

        const status = await tool.execute(
          {
            action: "status",
            task_id: orchestrator.metadata.sessionId as string,
          },
          ctx,
        )

        expect(status.output).toContain(`arbitration_candidate_task_id: ${adversarial.metadata.sessionId}`)
        expect(status.output).toContain("arbitration_candidate_type: critique")
        expect(status.output).toContain("arbitration_candidate_summary: Regression critique ready")
      },
    })
  })

  test("surfaces parent-child lineage and checkpoint state for nested orchestrator tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "Artifact Summary: Nested task complete\nCaptured lineage successfully.",
              },
            ],
          }
        })

        const { supervisor, ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-lineage",
        })

        const tool = await TaskTool.init()
        const parent = await tool.execute(
          {
            action: "start",
            lane_hint: "orchestrator",
            swarm_template: "synthesize",
            expected_artifact: "summary",
            subagent_type: "general",
            description: "parent orchestrator",
            prompt: "Coordinate child work.",
            wait_for_result: false,
          },
          ctx,
        )

        const parentTaskID = parent.metadata.sessionId as string
        const parentAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentAssistantID,
          sessionID: parentTaskID,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: Identifier.ascending("message"),
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "general",
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

        const childCtx = {
          sessionID: parentTaskID,
          messageID: parentAssistantID,
          callID: "call-lineage-child",
          agent: "general",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const child = await tool.execute(
          {
            action: "start",
            lane_hint: "worker",
            swarm_template: "patch",
            expected_artifact: "patch",
            subagent_type: "general",
            description: "nested child worker",
            prompt: "Inspect one file and report lineage metadata only.",
            wait_for_result: true,
          },
          childCtx,
        )

        const childTaskID = child.metadata.sessionId as string
        expect(child.metadata.parentTaskID).toBe(parentTaskID)
        expect(child.metadata.rootSupervisorSessionID).toBe(supervisor.id)
        expect(child.metadata.lineageDepth).toBe(1)
        expect(child.metadata.lineagePath).toEqual([parentTaskID, childTaskID])

        const childStatus = await tool.execute(
          {
            action: "status",
            task_id: childTaskID,
          },
          ctx,
        )

        expect(childStatus.output).toContain(`parent_task_id: ${parentTaskID}`)
        expect(childStatus.output).toContain(`root_supervisor_session_id: ${supervisor.id}`)
        expect(childStatus.output).toContain("lineage_depth: 1")

        const parentStatus = await tool.execute(
          {
            action: "status",
            task_id: parentTaskID,
          },
          ctx,
        )

        expect(parentStatus.output).toContain(`child_task_ids: ${childTaskID}`)
        expect(parentStatus.output).toContain("checkpoint_child_count: 1")
        expect(parentStatus.output).toContain("checkpoint_child_artifact_count: 1")
      },
    })
  })

  test("orchestrator-discipline tasks grant nested task permission to spawned sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-orchestrator-task-permission",
        })

        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            action: "start",
            lane_hint: "orchestrator",
            subagent_type: "general",
            description: "orchestrator with nested delegation",
            prompt: "Coordinate nested work.",
            wait_for_result: false,
          },
          ctx,
        )

        const session = await Session.get(result.metadata.sessionId as string)
        expect(session.permission?.some((rule) => rule.permission === "task" && rule.action === "deny")).toBe(false)
      },
    })
  })

  test("orchestrator-nested tasks inherit task permission", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-orchestrator-nested-permission",
        })

        const tool = await TaskTool.init()
        const parent = await tool.execute(
          {
            action: "start",
            lane_hint: "orchestrator",
            subagent_type: "general",
            description: "orchestrator with nested delegation",
            prompt: "Coordinate nested work.",
            wait_for_result: false,
          },
          ctx,
        )

        const parentTaskID = parent.metadata.sessionId as string
        const parentAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentAssistantID,
          sessionID: parentTaskID,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: Identifier.ascending("message"),
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "general",
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

        const childCtx = {
          sessionID: parentTaskID,
          messageID: parentAssistantID,
          callID: "call-nested-orchestrator-child",
          agent: "general",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const child = await tool.execute(
          {
            action: "start",
            lane_hint: "worker",
            subagent_type: "general",
            description: "child worker",
            prompt: "Inspect a file and report notes.",
            wait_for_result: false,
          },
          childCtx,
        )

        const childTaskID = child.metadata.sessionId as string
        const childAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: childAssistantID,
          sessionID: childTaskID,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: Identifier.ascending("message"),
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "general",
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

        const grandCtx = {
          sessionID: childTaskID,
          messageID: childAssistantID,
          callID: "call-nested-orchestrator-grandchild",
          agent: "general",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const grandchild = await tool.execute(
          {
            action: "start",
            lane_hint: "worker",
            subagent_type: "general",
            description: "nested grandchild",
            prompt: "Produce nested task metadata summary.",
            wait_for_result: false,
          },
          grandCtx,
        )

        const grandchildSession = await Session.get(grandchild.metadata.sessionId as string)
        expect(
          grandchildSession.permission?.some((rule) => rule.permission === "task" && rule.action === "deny"),
        ).toBe(false)
      },
    })
  })

  test("orchestrator tasks can require child tasks before completion", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "Artifact Summary: No child used.",
              },
            ],
          }
        })

        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-require-child",
        })

        const tool = await TaskTool.init()
        await expect(
          tool.execute(
            {
              action: "start",
              lane_hint: "orchestrator",
              subagent_type: "general",
              description: "must delegate",
              prompt: "You must delegate to a child.",
              required_child_tasks: 1,
              wait_for_result: true,
            },
            ctx,
          ),
        ).rejects.toThrow("Task required at least 1 child task(s)")
      },
    })
  })

  test(
    "supports queued turn controls: pause, resume, escalate",
    async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          experimental: {
            orchestration: {
              task_scheduler: {
                enabled: true,
                max_concurrency: 1,
                aging_ms: 5_000,
                preemption: "soft",
              },
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      promptSpy.mockImplementation(async (input: any) => {
        await Bun.sleep(60)
        const messageID = Identifier.ascending("message")
        return {
          info: {
            id: messageID,
            sessionID: input.sessionID,
            role: "assistant",
            time: { created: Date.now(), completed: Date.now() },
            agent: input.agent ?? "general",
            model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              sessionID: input.sessionID,
              messageID,
              type: "text",
              text: "mocked queued task reply",
            },
          ],
        }
      })

      const supervisor = await Session.create({})
      const parentUserID = Identifier.ascending("message")
      await Session.updateMessage({
        id: parentUserID,
        sessionID: supervisor.id,
        role: "user",
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
      })

      const anchorAssistantID = Identifier.ascending("message")
      await Session.updateMessage({
        id: anchorAssistantID,
        sessionID: supervisor.id,
        role: "assistant",
        time: { created: Date.now(), completed: Date.now() },
        parentID: parentUserID,
        modelID: "gpt-5.2" as any,
        providerID: "openai" as any,
        mode: "build",
        agent: "build",
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

      const ctx = {
        sessionID: supervisor.id,
        messageID: anchorAssistantID,
        callID: "call-queue",
        agent: "build",
        abort: AbortSignal.any([]),
        extra: { bypassAgentCheck: true },
        messages: [],
        metadata: () => {},
        ask: async () => {},
      }

      const tool = await TaskTool.init()
      const start = await tool.execute(
        {
          action: "start",
          subagent_type: "general",
          description: "queued worker",
          prompt: "phase one",
          wait_for_result: false,
        },
        ctx,
      )
      const taskID = start.metadata.sessionId as string

      await tool.execute(
        {
          action: "pause",
          task_id: taskID,
        },
        ctx,
      )

      await tool.execute(
        {
          action: "message",
          task_id: taskID,
          subagent_type: "general",
          description: "queued worker",
          prompt: "phase two",
          wait_for_result: false,
          priority: "normal",
        },
        ctx,
      )

      await tool.execute(
        {
          action: "escalate",
          task_id: taskID,
          priority: "urgent",
        },
        ctx,
      )

      const pausedStatus = await tool.execute(
        {
          action: "status",
          task_id: taskID,
        },
        ctx,
      )
      expect(pausedStatus.output).toContain("paused: true")
      expect(pausedStatus.output).toContain("queued_turns:")
      expect(pausedStatus.output).toContain("priority: urgent")

      await tool.execute(
        {
          action: "resume",
          task_id: taskID,
        },
        ctx,
      )

      const waited = await tool.execute(
        {
          action: "wait",
          task_id: taskID,
          timeout_ms: 5_000,
        },
        ctx,
      )
      expect(waited.output).toContain("status: completed")
      expect(waited.output).toContain("queued_turns: 0")
      expect(waited.output).toContain("pending_turns: 0")
    },
  })
    },
    20_000,
  )

  test("wait reports canceled tasks as canceled instead of completed", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          await Bun.sleep(80)
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "slow worker reply",
              },
            ],
          }
        })

        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-wait-canceled",
        })

        const tool = await TaskTool.init()
        const start = await tool.execute(
          {
            action: "start",
            subagent_type: "general",
            description: "cancelable worker",
            prompt: "run a slow step",
            wait_for_result: false,
          },
          ctx,
        )
        const taskID = start.metadata.sessionId as string

        await tool.execute(
          {
            action: "cancel",
            task_id: taskID,
          },
          ctx,
        )

        const waited = await tool.execute(
          {
            action: "wait",
            task_id: taskID,
            timeout_ms: 1_000,
          },
          ctx,
        )

        expect(waited.title).toBe("Task canceled")
        expect(waited.metadata.status).toBe("canceled")
        expect(waited.output).toContain("status: canceled")
      },
    })
  })

  test("restart recovery keeps detached queued work active instead of completed", async () => {
    await using tmp = await tmpdir({ git: true })

    let supervisorSessionID = ""
    let supervisorMessageID = ""
    let taskID = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { supervisor, ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-detached-recovery-seed",
        })
        supervisorSessionID = supervisor.id
        supervisorMessageID = ctx.messageID

        const taskSession = await Session.create({
          parentID: supervisor.id,
          title: "Recovered detached worker",
        })
        taskID = taskSession.id

        const taskUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: taskUserID,
          sessionID: taskSession.id,
          role: "user",
          time: { created: Date.now() },
          agent: "general",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        await ExecutionLedger.append({
          jobID: taskSession.id,
          sessionID: taskSession.id,
          supervisorSessionID: supervisor.id,
          kind: "task",
          lane: "subagent_tasks",
          priority: "background",
          phase: "queued",
          status: "running",
          description: "Recovered detached worker",
          time: Date.now(),
          source: "task",
          action: "start",
          messageID: taskUserID,
          pendingTurns: 0,
          queuedTurns: 1,
          paused: false,
        })
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()
        const ctx = {
          sessionID: supervisorSessionID,
          messageID: supervisorMessageID,
          callID: "call-detached-recovery-check",
          agent: "build",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const status = await tool.execute(
          {
            action: "status",
            task_id: taskID,
            include_execution_history: true,
          },
          ctx,
        )
        expect(status.metadata.status).toBe("running")
        expect(status.output).toContain("status: running")
        expect(status.output).toContain("queued_turns: 1")
        expect(status.output).toContain("execution_latest_phase: queued")

        const waited = await tool.execute(
          {
            action: "wait",
            task_id: taskID,
            timeout_ms: 10,
          },
          ctx,
        )
        expect(waited.title).toBe("Task still running")
        expect(waited.metadata.status).toBe("running")
        expect(waited.output).toContain("status: running")
      },
    })
  })

  test("wait reports failed tasks as failed instead of completed", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async () => {
          await Bun.sleep(20)
          throw new Error("boom from worker")
        })

        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-wait-error",
        })

        const tool = await TaskTool.init()
        const start = await tool.execute(
          {
            action: "start",
            subagent_type: "general",
            description: "failing worker",
            prompt: "run a failing step",
            wait_for_result: false,
          },
          ctx,
        )
        const taskID = start.metadata.sessionId as string

        const waited = await tool.execute(
          {
            action: "wait",
            task_id: taskID,
            timeout_ms: 1_000,
          },
          ctx,
        )

        expect(waited.title).toBe("Task failed")
        expect(waited.metadata.status).toBe("error")
        expect(waited.output).toContain("status: error")
        expect(waited.output).toContain("last_error: boom from worker")
      },
    })
  })

  test("records task lifecycle events for start and follow-up message", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-ledger-start-message",
        })

        const tool = await TaskTool.init()
        const start = await tool.execute(
          {
            action: "start",
            subagent_type: "general",
            description: "ledger worker",
            prompt: "do the first thing",
          },
          ctx,
        )
        const taskID = start.metadata.sessionId as string

        await tool.execute(
          {
            action: "message",
            task_id: taskID,
            description: "follow-up message",
            prompt: "do the second thing",
            wait_for_result: true,
          },
          ctx,
        )

        await Bun.sleep(50)
        const events = await ExecutionLedger.list({
          sessionID: taskID,
          source: "task",
        })

        expect(events.some((event) => event.action === "start" && event.phase === "queued")).toBe(true)
        expect(events.some((event) => event.action === "message" && event.phase === "queued")).toBe(true)
        expect(events.some((event) => event.action === "dispatch" && event.phase === "dispatched")).toBe(true)
        expect(events.some((event) => event.action === "turn" && event.phase === "running")).toBe(true)
        expect(events.some((event) => event.action === "turn_complete" && event.phase === "completed")).toBe(true)
      },
    })
  })

  test("records task control transitions for pause, resume, escalate, and cancel", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          await Bun.sleep(120)
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "slow ledger reply",
              },
            ],
          }
        })

        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-ledger-controls",
        })

        const tool = await TaskTool.init()
        const start = await tool.execute(
          {
            action: "start",
            subagent_type: "general",
            description: "control worker",
            prompt: "run a slow task",
            wait_for_result: false,
          },
          ctx,
        )
        const taskID = start.metadata.sessionId as string

        await tool.execute({ action: "pause", task_id: taskID }, ctx)
        await tool.execute({ action: "resume", task_id: taskID }, ctx)
        await tool.execute({ action: "escalate", task_id: taskID, priority: "urgent" }, ctx)
        await tool.execute({ action: "cancel", task_id: taskID }, ctx)

        await Bun.sleep(50)
        const events = await ExecutionLedger.list({
          sessionID: taskID,
          source: "task",
        })
        const actions = events.map((event) => event.action)

        expect(actions).toContain("pause")
        expect(actions).toContain("resume")
        expect(actions).toContain("escalate")
        expect(actions).toContain("cancel")
      },
    })
  })

  test("status and list can project execution history when requested", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-status-execution-history",
        })

        const tool = await TaskTool.init()
        const start = await tool.execute(
          {
            action: "start",
            subagent_type: "general",
            description: "history worker",
            prompt: "run a tracked task",
            wait_for_result: true,
          },
          ctx,
        )
        const taskID = start.metadata.sessionId as string

        const status = await tool.execute(
          {
            action: "status",
            task_id: taskID,
            include_execution_history: true,
          },
          ctx,
        )

        expect(status.metadata.executionEventCount).toBeGreaterThan(0)
        expect(status.metadata.executionLatestPhase).toBe("completed")
        expect(status.output).toContain("execution_event_count:")
        expect(status.output).toContain("<task_execution>")

        const listed = await tool.execute(
          {
            action: "list",
            include_execution_history: true,
          },
          ctx,
        )

        const taskEntry = listed.metadata.tasks.find((task: any) => task.taskID === taskID)
        expect(taskEntry?.executionEventCount).toBeGreaterThan(0)
        expect(taskEntry?.executionLatestAction).toBeDefined()
        expect(listed.output).toContain("execution_latest_phase:")
      },
    })
  })

  test("steer abort on parent turn does not cancel foreground subagent session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          await Bun.sleep(80)
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "mocked steer-safe reply",
              },
            ],
          }
        })

        const supervisor = await Session.create({})
        const parentUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentUserID,
          sessionID: supervisor.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        const anchorAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: anchorAssistantID,
          sessionID: supervisor.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: parentUserID,
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "build",
          agent: "build",
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

        const parentAbort = new AbortController()
        const ctx = {
          sessionID: supervisor.id,
          messageID: anchorAssistantID,
          callID: "call-steer-safe",
          agent: "build",
          abort: parentAbort.signal,
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const cancelSpy = spyOn(SessionPrompt as any, "cancel")
        try {
          const tool = await TaskTool.init()
          const running = tool.execute(
            {
              action: "start",
              subagent_type: "general",
              description: "foreground worker",
              prompt: "run foreground work",
              wait_for_result: true,
            },
            ctx,
          )

          await Bun.sleep(10)
          parentAbort.abort(new SessionSteerInterrupt(supervisor.id))

          const result = await running
          const taskID = result.metadata.sessionId as string
          expect(cancelSpy.mock.calls.some((call) => call[0] === taskID)).toBe(false)
        } finally {
          cancelSpy.mockRestore()
        }
      },
    })
  })

  test("steer abort fallback does not cancel foreground subagent with delayed steer receipt", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          await Bun.sleep(80)
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "mocked steer-safe fallback reply",
              },
            ],
          }
        })

        const supervisor = await Session.create({})
        const parentUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentUserID,
          sessionID: supervisor.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        const anchorAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: anchorAssistantID,
          sessionID: supervisor.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: parentUserID,
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "build",
          agent: "build",
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

        const parentAbort = new AbortController()
        const ctx = {
          sessionID: supervisor.id,
          messageID: anchorAssistantID,
          callID: "call-steer-fallback",
          agent: "build",
          abort: parentAbort.signal,
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const cancelSpy = spyOn(SessionPrompt as any, "cancel")
        let pending = false
        const steerPendingSpy = spyOn(SessionPrompt as any, "isSteerPending").mockImplementation(
          (sessionID: string) => sessionID === supervisor.id && pending,
        )
        try {
          const tool = await TaskTool.init()
          const running = tool.execute(
            {
              action: "start",
              subagent_type: "general",
              description: "foreground worker fallback",
              prompt: "run foreground work",
              wait_for_result: true,
            },
            ctx,
          )

          await Bun.sleep(10)
          parentAbort.abort()
          setTimeout(() => {
            pending = true
          }, 20)

          const result = await running
          const taskID = result.metadata.sessionId as string
          expect(cancelSpy.mock.calls.some((call) => call[0] === taskID)).toBe(false)
        } finally {
          steerPendingSpy.mockRestore()
          cancelSpy.mockRestore()
        }
      },
    })
  })

  test("parent abort cancellation waits briefly for steer pending race", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          await Bun.sleep(80)
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "mocked race-safe reply",
              },
            ],
          }
        })

        const supervisor = await Session.create({})
        const parentUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentUserID,
          sessionID: supervisor.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        const anchorAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: anchorAssistantID,
          sessionID: supervisor.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: parentUserID,
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "build",
          agent: "build",
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

        const parentAbort = new AbortController()
        const ctx = {
          sessionID: supervisor.id,
          messageID: anchorAssistantID,
          callID: "call-steer-race",
          agent: "build",
          abort: parentAbort.signal,
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const cancelSpy = spyOn(SessionPrompt as any, "cancel")
        let pending = false
        const steerPendingSpy = spyOn(SessionPrompt as any, "isSteerPending").mockImplementation(
          (sessionID: string) => sessionID === supervisor.id && pending,
        )
        try {
          const tool = await TaskTool.init()
          const running = tool.execute(
            {
              action: "start",
              subagent_type: "general",
              description: "foreground worker race",
              prompt: "run foreground work",
              wait_for_result: true,
            },
            ctx,
          )

          await Bun.sleep(10)
          parentAbort.abort()
          setTimeout(() => {
            pending = true
          }, 25)

          const result = await running
          const taskID = result.metadata.sessionId as string
          expect(cancelSpy.mock.calls.some((call) => call[0] === taskID)).toBe(false)
        } finally {
          steerPendingSpy.mockRestore()
          cancelSpy.mockRestore()
        }
      },
    })
  })

  test("parent abort marks foreground task as canceled even when prompt rejects on cancel", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const pendingRejects = new Map<string, (reason: Error) => void>()
        const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
        promptSpy.mockImplementation(
          (input: any) =>
            new Promise((resolve, reject) => {
              pendingRejects.set(input.sessionID, reject)
              const timer = setTimeout(() => {
                pendingRejects.delete(input.sessionID)
                pendingTimers.delete(input.sessionID)
                const messageID = Identifier.ascending("message")
                resolve({
                  info: {
                    id: messageID,
                    sessionID: input.sessionID,
                    role: "assistant",
                    time: { created: Date.now(), completed: Date.now() },
                    agent: input.agent ?? "general",
                    model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
                  },
                  parts: [
                    {
                      id: Identifier.ascending("part"),
                      sessionID: input.sessionID,
                      messageID,
                      type: "text",
                      text: "late worker reply",
                    },
                  ],
                })
              }, 400)
              timer.unref?.()
              pendingTimers.set(input.sessionID, timer)
            }),
        )

        const parentAbort = new AbortController()
        let taskID = ""
        const { ctx } = await createSupervisorContext({
          tmpPath: tmp.path,
          callID: "call-parent-abort-canceled",
          abort: parentAbort.signal,
          metadata: (value) => {
            taskID = value?.metadata?.sessionId ?? taskID
          },
        })
        const statusCtx = {
          ...ctx,
          abort: AbortSignal.any([]),
        }

        const cancelSpy = spyOn(SessionPrompt as any, "cancel").mockImplementation(async (sessionID: string) => {
          const timer = pendingTimers.get(sessionID)
          if (timer) {
            clearTimeout(timer)
            pendingTimers.delete(sessionID)
          }
          pendingRejects.get(sessionID)?.(new Error("prompt canceled"))
          pendingRejects.delete(sessionID)
        })
        try {
          const tool = await TaskTool.init()
          const running = tool.execute(
            {
              action: "start",
              subagent_type: "general",
              description: "abortable foreground worker",
              prompt: "run foreground work until canceled",
              wait_for_result: true,
            },
            ctx,
          )

          await Bun.sleep(10)
          parentAbort.abort()

          await expect(running).rejects.toThrow("Subagent task failed: prompt canceled")
          expect(taskID).toBeTruthy()
          expect(cancelSpy.mock.calls.some((call) => call[0] === taskID)).toBe(true)

          const status = await tool.execute(
            {
              action: "status",
              task_id: taskID,
            },
            statusCtx,
          )
          expect(status.metadata.status).toBe("canceled")
          expect(status.output).toContain("status: canceled")

          const waited = await tool.execute(
            {
              action: "wait",
              task_id: taskID,
              timeout_ms: 1_000,
            },
            statusCtx,
          )
          expect(waited.title).toBe("Task canceled")
          expect(waited.metadata.status).toBe("canceled")
        } finally {
          cancelSpy.mockRestore()
        }
      },
    })
  })

  test("suppresses duplicate supervisor inbox updates in short window", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          await Bun.sleep(80)
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "mocked dedupe reply",
              },
            ],
          }
        })

        const supervisor = await Session.create({})
        const parentUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentUserID,
          sessionID: supervisor.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        const anchorAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: anchorAssistantID,
          sessionID: supervisor.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: parentUserID,
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "build",
          agent: "build",
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

        const ctx = {
          sessionID: supervisor.id,
          messageID: anchorAssistantID,
          callID: "call-dedupe",
          agent: "build",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const updates: Array<{ taskID: string; eventKind?: string }> = []
        const unsub = Bus.subscribe(TaskEvent.SupervisorInbox, (event) => {
          updates.push({
            taskID: event.properties.taskID,
            eventKind: event.properties.eventKind,
          })
        })

        try {
          const tool = await TaskTool.init()
          const start = await tool.execute(
            {
              action: "start",
              subagent_type: "general",
              description: "dedupe worker",
              prompt: "phase one",
              wait_for_result: false,
            },
            ctx,
          )
          const taskID = start.metadata.sessionId as string

          await tool.execute({ action: "pause", task_id: taskID }, ctx)
          await tool.execute({ action: "pause", task_id: taskID }, ctx)
          await tool.execute({ action: "resume", task_id: taskID }, ctx)

          await tool.execute(
            {
              action: "wait",
              task_id: taskID,
              timeout_ms: 5_000,
            },
            ctx,
          )

          const paused = updates.filter((x) => x.taskID === taskID && x.eventKind === "paused")
          expect(paused.length).toBe(1)
        } finally {
          unsub()
        }
      },
    })
  })

  test("uses single heartbeat interval for concurrent turns on one task", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            experimental: {
              orchestration: {
                task_scheduler: {
                  enabled: true,
                  max_concurrency: 2,
                  heartbeat_ms: 1_000,
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        promptSpy.mockImplementation(async (input: any) => {
          await Bun.sleep(1_400)
          const messageID = Identifier.ascending("message")
          return {
            info: {
              id: messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              agent: input.agent ?? "general",
              model: input.model ?? { providerID: "openai" as any, modelID: "gpt-5.2" as any },
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID,
                type: "text",
                text: "mocked concurrent heartbeat reply",
              },
            ],
          }
        })

        const supervisor = await Session.create({})
        const parentUserID = Identifier.ascending("message")
        await Session.updateMessage({
          id: parentUserID,
          sessionID: supervisor.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai" as any, modelID: "gpt-5.2" as any },
        })

        const anchorAssistantID = Identifier.ascending("message")
        await Session.updateMessage({
          id: anchorAssistantID,
          sessionID: supervisor.id,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          parentID: parentUserID,
          modelID: "gpt-5.2" as any,
          providerID: "openai" as any,
          mode: "build",
          agent: "build",
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

        const ctx = {
          sessionID: supervisor.id,
          messageID: anchorAssistantID,
          callID: "call-heartbeat",
          agent: "build",
          abort: AbortSignal.any([]),
          extra: { bypassAgentCheck: true },
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }

        const timerSpy = spyOn(globalThis as any, "setInterval")
        try {
          const tool = await TaskTool.init()
          const start = await tool.execute(
            {
              action: "start",
              subagent_type: "general",
              description: "heartbeat worker",
              prompt: "phase one",
              wait_for_result: false,
            },
            ctx,
          )
          const taskID = start.metadata.sessionId as string

          await Bun.sleep(40)
          await tool.execute(
            {
              action: "message",
              task_id: taskID,
              subagent_type: "general",
              description: "heartbeat worker",
              prompt: "phase two",
              wait_for_result: false,
            },
            ctx,
          )

          await Bun.sleep(1_100)
          const liveStatus = await tool.execute(
            {
              action: "status",
              task_id: taskID,
            },
            ctx,
          )
          expect(liveStatus.output).toContain("heartbeat_state: fresh")
          expect(liveStatus.metadata.heartbeatState).toBe("fresh")
          expect(typeof liveStatus.metadata.heartbeatExpectedMS).toBe("number")
          expect(typeof liveStatus.metadata.heartbeatAgeMS).toBe("number")

          await tool.execute(
            {
              action: "wait",
              task_id: taskID,
              timeout_ms: 6_000,
            },
            ctx,
          )

          const heartbeatIntervals = timerSpy.mock.calls.filter((call) => call[1] === 1_000)
          expect(heartbeatIntervals.length).toBe(1)
        } finally {
          timerSpy.mockRestore()
        }
      },
    })
  })

})
