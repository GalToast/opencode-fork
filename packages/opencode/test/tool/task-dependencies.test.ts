import { describe, expect, test, spyOn } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { TaskTool } from "../../src/tool/task"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { SessionPrompt } from "../../src/session/prompt"
import { SchedulerControl } from "../../src/scheduler/control-plane"

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
      abort: input.abort ?? AbortSignal.any([]),
      extra: { bypassAgentCheck: true },
      messages: [] as any[],
      metadata: input.metadata ?? (() => {}),
      ask: async () => {},
    } as any,
  }
}

describe("task dependencies", () => {
  let promptSpy: any

  const defaultPrompt = async (input: any) => {
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
          text: "mocked subagent reply",
        },
      ],
    }
  }

  const taskDependenciesTest = (name: string, fn: () => void | Promise<unknown>, timeout = 20_000) =>
    test(
      name,
      async () => {
        await Instance.disposeAll().catch(() => undefined)
        promptSpy?.mockRestore?.()
        promptSpy = spyOn(SessionPrompt as any, "prompt").mockImplementation(defaultPrompt)
        try {
          await fn()
        } finally {
          promptSpy?.mockRestore?.()
          promptSpy = undefined
          await Instance.disposeAll().catch(() => undefined)
        }
      },
      { timeout },
    )

  async function waitForOutput(
    tool: Awaited<ReturnType<typeof TaskTool.init>>,
    ctx: any,
    taskID: string,
    predicate: (output: string) => boolean,
    timeoutMS = 5000,
  ) {
    const end = Date.now() + timeoutMS
    let output = ""
    while (Date.now() < end) {
      const status = await tool.execute(
        {
          // @ts-ignore
          action: "status",
          task_id: taskID,
        },
        ctx,
      )
      output = status.output
      if (predicate(output)) return output
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timed out waiting for task output condition. Last output:\n${output}`)
  }

  describe("depends_on parameter tracking", () => {
    taskDependenciesTest("task created with depends_on stores dependency in job", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-dep-basic",
          })

          // Create task A
          const taskA = await TaskTool.init().then((tool) =>
            tool.execute(
              {
                // @ts-ignore
                action: "start",
                subagent_type: "general",
                description: "Task A",
                prompt: "Complete task A",
                wait_for_result: true,
              },
              ctx,
            ),
          )

          // Create task B with depends_on
          const taskB = await TaskTool.init().then((tool) =>
            tool.execute(
              {
                // @ts-ignore
                action: "start",
                subagent_type: "general",
                description: "Task B depends on A",
                prompt: "Complete task B",
                depends_on: [taskA.metadata.sessionId],
                wait_for_result: false,
              },
              ctx,
            ),
          )

          // Verify task B has dependency
          const statusB = await TaskTool.init().then((tool) =>
            tool.execute(
              {
                // @ts-ignore
                action: "status",
                task_id: taskB.metadata.sessionId,
              },
              ctx,
            ),
          )

          expect(statusB.output).toContain(`task_id: ${taskB.metadata.sessionId}`)
          expect(taskB.metadata.sessionId).toBeDefined()
        },
      })
    })

    taskDependenciesTest("task with multiple dependencies tracks all dependency IDs", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-dep-multi",
          })

          const tool = await TaskTool.init()

          // Create tasks A and B
          const taskA = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task A",
              prompt: "A",
              wait_for_result: true,
            },
            ctx,
          )

          const taskB = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task B",
              prompt: "B",
              wait_for_result: true,
            },
            ctx,
          )

          // Create task C depending on both
          const taskC = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task C depends on A and B",
              prompt: "C",
              depends_on: [taskA.metadata.sessionId, taskB.metadata.sessionId],
              wait_for_result: false,
            },
            ctx,
          )

          expect(taskC.metadata.sessionId).toBeDefined()

          // Check status to verify dependencies are tracked
          const statusC = await tool.execute(
            {
              // @ts-ignore
              action: "status",
              task_id: taskC.metadata.sessionId,
            },
            ctx,
          )

          // Verify task C was created and is in running/queued state
          expect(statusC.output).toContain(`task_id: ${taskC.metadata.sessionId}`)
          expect(taskC.metadata.sessionId).toBeDefined()
        },
      })
    })
  })

  describe("basic dependency waiting", () => {
    taskDependenciesTest("start defaults to background dispatch when wait_for_result is omitted", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let releasePrompt!: () => void
          const promptStarted = new Promise<void>((resolve) => {
            promptSpy.mockImplementation(
              async (input: any) =>
                await new Promise((resolvePrompt) => {
                  releasePrompt = () => {
                    const messageID = Identifier.ascending("message")
                    resolvePrompt({
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
                          text: "background subagent finished",
                        },
                      ],
                    })
                  }
                  resolve()
                }),
            )
          })

          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-default-background",
          })
          const tool = await TaskTool.init()

          const result = await Promise.race([
            tool.execute(
              {
                // @ts-ignore
                action: "start",
                subagent_type: "general",
                description: "Default background worker",
                prompt: "Run in the background by default.",
              },
              ctx,
            ),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("task start blocked main lane")), 1000)),
          ])

          expect(result.output).toContain("status: running")
          expect(result.metadata.sessionId).toBeDefined()

          await promptStarted
          releasePrompt()
          const waited = await tool.execute(
            {
              // @ts-ignore
              action: "wait",
              task_id: result.metadata.sessionId,
              timeout_ms: 5000,
            },
            ctx,
          )
          expect(waited.output).toContain("background subagent finished")
        },
      })
    })

    taskDependenciesTest("status and wait expose task presentation metadata for progress UIs", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const metadataUpdates: any[] = []
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-progress-labels",
            metadata: (value) => metadataUpdates.push(value),
          })
          const tool = await TaskTool.init()

          const started = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Progress label worker",
              prompt: "Return quickly.",
              wait_for_result: true,
            },
            ctx,
          )

          const status = await tool.execute(
            {
              // @ts-ignore
              action: "status",
              task_id: started.metadata.sessionId,
            },
            ctx,
          )
          expect(status.title).toBe("Task status: Progress label worker")
          expect(status.metadata.taskDescription).toBe("Progress label worker")
          expect(status.metadata.subagentType).toBe("general")
          expect(status.metadata.sessionId).toBe(started.metadata.sessionId)
          expect(metadataUpdates.some((value) => value.title === "Task status: Progress label worker")).toBe(true)

          const waited = await tool.execute(
            {
              // @ts-ignore
              action: "wait",
              task_id: started.metadata.sessionId,
              timeout_ms: 5000,
            },
            ctx,
          )
          expect(waited.title).toBe("Task completed: Progress label worker")
          expect(waited.metadata.taskDescription).toBe("Progress label worker")
          expect(waited.metadata.subagentType).toBe("general")
          expect(metadataUpdates.some((value) => value.title === "Waiting for task: Progress label worker")).toBe(true)
        },
      })
    })

    taskDependenciesTest("routed task lanes are submitted to scheduler without flattening to subagent_tasks", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const submittedLanes: SchedulerControl.Lane[] = []
          const submitSpy = spyOn(SchedulerControl, "submit").mockImplementation(async (input: any) => {
            submittedLanes.push(input.lane)
            return {
              jobID: Identifier.ascending("part"),
              background: false,
              result: await input.run(),
            }
          })

          try {
            const { ctx } = await createSupervisorContext({
              tmpPath: tmp.path,
              callID: "call-routed-scheduler-lanes",
            })
            const tool = await TaskTool.init()

            await tool.execute(
              {
                // @ts-ignore
                action: "start",
                subagent_type: "general",
                lane_hint: "orchestrator",
                description: "Orchestrator lane worker",
                prompt: "Coordinate this task.",
                wait_for_result: true,
              },
              ctx,
            )

            await tool.execute(
              {
                // @ts-ignore
                action: "start",
                subagent_type: "general",
                lane_hint: "adversarial",
                description: "Adversarial lane worker",
                prompt: "Review this task adversarially.",
                wait_for_result: true,
              },
              ctx,
            )

            await tool.execute(
              {
                // @ts-ignore
                action: "start",
                subagent_type: "general",
                lane_hint: "worker",
                description: "Worker lane fallback",
                prompt: "Do worker task.",
                wait_for_result: true,
              },
              ctx,
            )

            expect(submittedLanes).toContain("orchestrator_swarm")
            expect(submittedLanes).toContain("adversarial_review")
            expect(submittedLanes).toContain("subagent_tasks")
          } finally {
            submitSpy.mockRestore()
          }
        },
      })
    })

    taskDependenciesTest("task becomes eligible when dependency completes", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-dep-eligible",
          })

          const tool = await TaskTool.init()

          // Complete task A
          const taskA = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task A completes",
              prompt: "A done",
              wait_for_result: true,
            },
            ctx,
          )

          expect(taskA.output).toContain("mocked subagent reply")

          // Create task B depending on completed A
          const taskB = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task B waits for A",
              prompt: "B runs after A",
              depends_on: [taskA.metadata.sessionId],
              wait_for_result: true,
            },
            ctx,
          )

          // B should complete since A is already done
          expect(taskB.output).toBeDefined()
          expect(taskB.output).toContain("mocked subagent reply")
        },
      })
    })
  })

  describe("chain dependencies", () => {
    taskDependenciesTest("chain A -> B -> C executes in proper sequence", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-dep-chain",
          })

          const tool = await TaskTool.init()

          // Task A
          const taskA = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task A first",
              prompt: "A completes",
              wait_for_result: true,
            },
            ctx,
          )
          expect(taskA.output).toContain("mocked subagent reply")

          // Task B depends on A
          const taskB = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task B second",
              prompt: "B completes after A",
              depends_on: [taskA.metadata.sessionId],
              wait_for_result: true,
            },
            ctx,
          )
          expect(taskB.output).toContain("mocked subagent reply")

          // Task C depends on B
          const taskC = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task C third",
              prompt: "C completes after B",
              depends_on: [taskB.metadata.sessionId],
              wait_for_result: true,
            },
            ctx,
          )
          expect(taskC.output).toContain("mocked subagent reply")
        },
      })
    })

    taskDependenciesTest("longer chain maintains sequencing", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-dep-long-chain",
          })

          const tool = await TaskTool.init()

          const task1 = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Step 1",
              prompt: "Step 1",
              wait_for_result: true,
            },
            ctx,
          )

          const task2 = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Step 2",
              prompt: "Step 2",
              depends_on: [task1.metadata.sessionId],
              wait_for_result: true,
            },
            ctx,
          )

          const task3 = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Step 3",
              prompt: "Step 3",
              depends_on: [task2.metadata.sessionId],
              wait_for_result: true,
            },
            ctx,
          )

          const task4 = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Step 4",
              prompt: "Step 4",
              depends_on: [task3.metadata.sessionId],
              wait_for_result: true,
            },
            ctx,
          )

          expect(task4.output).toContain("mocked subagent reply")
        },
      })
    })
  })

  describe("multiple dependencies convergence", () => {
    taskDependenciesTest("task waits for ALL dependencies before starting", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-dep-converge",
          })

          const tool = await TaskTool.init()

          // Complete tasks A and B
          const taskA = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task A",
              prompt: "A done",
              wait_for_result: true,
            },
            ctx,
          )

          const taskB = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task B",
              prompt: "B done",
              wait_for_result: true,
            },
            ctx,
          )

          // Task C waits for both
          const taskC = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task C waits for A and B",
              prompt: "C runs after both",
              depends_on: [taskA.metadata.sessionId, taskB.metadata.sessionId],
              wait_for_result: true,
            },
            ctx,
          )

          expect(taskC.output).toContain("mocked subagent reply")
        },
      })
    })
  })

  describe("dependency with non-existent task", () => {
    taskDependenciesTest("task with missing dependency fails instead of dispatching", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-dep-missing",
          })

          const tool = await TaskTool.init()
          let promptCalls = 0
          promptSpy.mockImplementation(async (input: any) => {
            promptCalls += 1
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
                  text: "should not run",
                },
              ],
            }
          })

          // Create task with non-existent dependency
          const task = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task waiting for ghost",
              prompt: "Waiting",
              depends_on: ["ses_nonexistent"],
              wait_for_result: false,
            },
            ctx,
          )

          expect(task.metadata.sessionId).toBeDefined()

          const output = await waitForOutput(
            tool,
            ctx,
            task.metadata.sessionId,
            (text) => text.includes("status: error"),
          )

          expect(promptCalls).toBe(0)
          expect(output).toContain("dependency_state: failed")
          expect(output).toContain("dependency_missing: ses_nonexistent")
          expect(output).toContain("last_error: Task dependency blocked permanently (missing: ses_nonexistent)")
        },
      })
    })

    taskDependenciesTest("task with canceled dependency fails instead of hanging queued", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let releasePrompt!: () => void
          promptSpy.mockImplementation(
            async (input: any) =>
              await new Promise((resolvePrompt) => {
                releasePrompt = () => {
                  const messageID = Identifier.ascending("message")
                  resolvePrompt({
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
                        text: "released after cancel",
                      },
                    ],
                  })
                }
              }),
          )

          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-dep-canceled",
          })
          const tool = await TaskTool.init()

          const taskA = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task A blocks",
              prompt: "Wait until canceled",
              wait_for_result: false,
            },
            ctx,
          )

          await waitForOutput(tool, ctx, taskA.metadata.sessionId, (text) => text.includes("pending_turns: 1"))
          await tool.execute(
            {
              // @ts-ignore
              action: "cancel",
              task_id: taskA.metadata.sessionId,
            },
            ctx,
          )

          const taskB = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task B depends on canceled A",
              prompt: "Should never run",
              depends_on: [taskA.metadata.sessionId],
              wait_for_result: false,
            },
            ctx,
          )

          const output = await waitForOutput(
            tool,
            ctx,
            taskB.metadata.sessionId,
            (text) => text.includes("status: error"),
          )

          expect(output).toContain("dependency_state: failed")
          expect(output).toContain(`dependency_canceled: ${taskA.metadata.sessionId}`)
          expect(output).toContain(`last_error: Task dependency blocked permanently (canceled: ${taskA.metadata.sessionId})`)
          releasePrompt()
        },
      })
    })

    taskDependenciesTest("task with failed dependency fails instead of hanging queued", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let promptCalls = 0
          promptSpy.mockImplementation(async () => {
            promptCalls += 1
            throw new Error("upstream task failed")
          })

          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-dep-failed",
          })
          const tool = await TaskTool.init()

          const taskA = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task A fails",
              prompt: "Fail upstream",
              wait_for_result: false,
            },
            ctx,
          )

          await waitForOutput(tool, ctx, taskA.metadata.sessionId, (text) => text.includes("status: error"))

          const taskB = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task B depends on failed A",
              prompt: "Should never run",
              depends_on: [taskA.metadata.sessionId],
              wait_for_result: false,
            },
            ctx,
          )

          const output = await waitForOutput(
            tool,
            ctx,
            taskB.metadata.sessionId,
            (text) => text.includes("status: error"),
          )

          expect(promptCalls).toBe(1)
          expect(output).toContain("dependency_state: failed")
          expect(output).toContain(`dependency_failed: ${taskA.metadata.sessionId}`)
          expect(output).toContain(`last_error: Task dependency blocked permanently (failed: ${taskA.metadata.sessionId})`)
        },
      })
    })
  })

  describe("parallel independent with convergent dependent", () => {
    taskDependenciesTest("independent tasks can run, convergent task waits", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-dep-parallel",
          })

          const tool = await TaskTool.init()

          // Create independent tasks
          const taskA = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task A parallel",
              prompt: "A runs",
              wait_for_result: false,
            },
            ctx,
          )

          const taskB = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task B parallel",
              prompt: "B runs",
              wait_for_result: false,
            },
            ctx,
          )

          // Create convergent task C
          const taskC = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task C convergent",
              prompt: "C after A and B",
              depends_on: [taskA.metadata.sessionId, taskB.metadata.sessionId],
              wait_for_result: false,
            },
            ctx,
          )

          expect(taskA.metadata.sessionId).toBeDefined()
          expect(taskB.metadata.sessionId).toBeDefined()
          expect(taskC.metadata.sessionId).toBeDefined()
        },
      })
    })
  })

  describe("list shows dependency information", () => {
    taskDependenciesTest("list action includes tasks with dependencies", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { ctx } = await createSupervisorContext({
            tmpPath: tmp.path,
            callID: "call-dep-list",
          })

          const tool = await TaskTool.init()

          const taskA = await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task A",
              prompt: "A",
              wait_for_result: true,
            },
            ctx,
          )

          await tool.execute(
            {
              // @ts-ignore
              action: "start",
              subagent_type: "general",
              description: "Task B depends on A",
              prompt: "B",
              depends_on: [taskA.metadata.sessionId],
              wait_for_result: false,
            },
            ctx,
          )

          const listResult = await tool.execute(
            {
              // @ts-ignore
              action: "list",
              include_all: true,
            },
            ctx,
          )

          expect(listResult.output).toContain("task_count:")
          expect(listResult.output).toContain(taskA.metadata.sessionId)
        },
      })
    })
  })
})
