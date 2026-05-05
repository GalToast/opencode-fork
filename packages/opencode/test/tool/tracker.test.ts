import { describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Tracker } from "../../src/tracker/service"
import { TaskStatus, TaskType } from "../../src/tracker/types"
import { Todo } from "../../src/session/todo"
import { Session } from "../../src/session"
import {
  TrackerAddDependencyTool,
  TrackerCreateTaskTool,
  TrackerListTasksTool,
  TrackerUpdateTaskTool,
  TrackerVisualizeTool,
} from "../../src/tool/tracker"
import { tmpdir } from "../fixture/fixture"

const baseCtx = {
  sessionID: "ses_test" as any,
  messageID: "msg_test" as any,
  callID: "call_test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

async function ensureSession(directory: string) {
  try {
    // @ts-ignore
    await Session.createNext({
      id: baseCtx.sessionID,
      directory,
    })
  } catch (error: any) {
    if (error?.message?.includes("UNIQUE constraint failed: session.id")) {
      return
    }
    throw error
  }
}

describe("tool.tracker", () => {
  test("tracker_create_task creates a task and returns result", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureSession(tmp.path)
        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const tool = await TrackerCreateTaskTool.init()
        const result = await tool.execute(
          {
            title: "Test task",
            description: "A test task description",
            type: TaskType.TASK,
          },
          baseCtx,
        )

        expect(result.title).toContain("Created")
        expect(result.output).toContain("Test task")
        expect(result.metadata.task).toBeDefined()
        expect(result.metadata.task.title).toBe("Test task")
        ask.mockRestore()
      },
    })
  })

  test("tracker_create_task syncs with legacy todo list", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureSession(tmp.path)
        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const tool = await TrackerCreateTaskTool.init()
        await tool.execute(
          {
            title: "Sync task",
            description: "Should appear in todo list",
            type: TaskType.TASK,
          },
          baseCtx,
        )

        const todos = await Todo.get(baseCtx.sessionID)
        expect(todos.length).toBe(1)
        expect(todos[0].content).toContain("Sync task")
        expect(todos[0].status).toBe("pending")

        ask.mockRestore()
      },
    })
  })

  test("tracker_create_task syncs todos at the root session so child branches share the same scratch list", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "root" })
        const child = await Session.create({ parentID: root.id, title: "child" })
        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const tool = await TrackerCreateTaskTool.init()
        await tool.execute(
          {
            title: "Shared tracker task",
            description: "Should appear in both root and child todo views",
            type: TaskType.TASK,
          },
          { ...baseCtx, sessionID: child.id, messageID: "msg_child", callID: "call_child" },
        )

        const rootTodos = await Todo.get(root.id)
        const childTodos = await Todo.get(child.id)

        expect(rootTodos.length).toBe(1)
        expect(childTodos).toEqual(rootTodos)
        expect(rootTodos[0].content).toContain("Shared tracker task")

        ask.mockRestore()
      },
    })
  })

  test("tracker tools preserve recommended skill references in metadata", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureSession(tmp.path)
        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const createTool = await TrackerCreateTaskTool.init()
        const created = await createTool.execute(
          {
            title: "Build UI shell",
            description: "Polish the shell and interaction model",
            type: TaskType.TASK,
            recommendedSkills: ["frontend-design"],
          },
          baseCtx,
        )

        expect(created.metadata.task?.metadata?.recommendedSkills).toEqual(["frontend-design"])

        const updateTool = await TrackerUpdateTaskTool.init()
        const updated = await updateTool.execute(
          {
            id: created.metadata.task.id,
            recommendedSkills: ["frontend-design", "webapp-testing"],
          },
          baseCtx,
        )

        expect(updated.metadata.task?.metadata?.recommendedSkills).toEqual([
          "frontend-design",
          "webapp-testing",
        ])
        ask.mockRestore()
      },
    })
  })

  test("tracker_list_tasks returns empty list when no tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const tool = await TrackerListTasksTool.init()
        const result = await tool.execute({}, baseCtx)

        expect(result.title).toBe("0 tasks")
        expect(result.output).toContain("No tasks found")
        ask.mockRestore()
      },
    })
  })

  test("tracker_list_tasks returns tasks when they exist", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tracker = await Tracker.get()
        const task = await tracker.createTask({
          title: "Listed task",
          description: "Should be listed",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: [],
        })

        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const tool = await TrackerListTasksTool.init()
        const result = await tool.execute({}, baseCtx)

        expect(result.title).toBe("1 task")
        expect(result.output).toContain(task.id)
        expect(result.output).toContain("Listed task")
        ask.mockRestore()
      },
    })
  })

  test("tracker_list_tasks filters by status", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tracker = await Tracker.get()
        await tracker.createTask({
          title: "Open task",
          description: "Open",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: [],
        })
        const closed = await tracker.createTask({
          title: "Closed task",
          description: "Closed",
          type: TaskType.TASK,
          status: TaskStatus.CLOSED,
          dependencies: [],
        })

        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const tool = await TrackerListTasksTool.init()
        const result = await tool.execute({ status: TaskStatus.CLOSED }, baseCtx)

        expect(result.title).toBe("1 task")
        expect(result.output).toContain(closed.id)
        expect(result.output).not.toContain("Open task")
        ask.mockRestore()
      },
    })
  })

  test("tracker_add_dependency adds dependency between tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tracker = await Tracker.get()
        const dep = await tracker.createTask({
          title: "Dependency task",
          description: "First",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: [],
        })
        const task = await tracker.createTask({
          title: "Main task",
          description: "Second",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: [],
        })

        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const tool = await TrackerAddDependencyTool.init()
        const result = await tool.execute(
          { taskId: task.id, dependencyId: dep.id },
          baseCtx,
        )

        expect(result.output).toContain("Linked")
        expect(result.output).toContain(dep.id)
        ask.mockRestore()
      },
    })
  })

  test("tracker_add_dependency rejects self-dependency", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tracker = await Tracker.get()
        const task = await tracker.createTask({
          title: "Solo task",
          description: "Alone",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: [],
        })

        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const tool = await TrackerAddDependencyTool.init()
        await expect(
          tool.execute({ taskId: task.id, dependencyId: task.id }, baseCtx),
        ).rejects.toThrow("Task cannot depend on itself.")
        ask.mockRestore()
      },
    })
  })

  test("tracker_visualize returns empty message when no tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const tool = await TrackerVisualizeTool.init()
        const result = await tool.execute({}, baseCtx)

        expect(result.title).toBe("Empty tracker")
        expect(result.output).toContain("No tasks to visualize")
        ask.mockRestore()
      },
    })
  })

  test("tracker_visualize renders task graph", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tracker = await Tracker.get()
        const task = await tracker.createTask({
          title: "Root task",
          description: "Top level",
          type: TaskType.EPIC,
          status: TaskStatus.OPEN,
          dependencies: [],
        })

        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const tool = await TrackerVisualizeTool.init()
        const result = await tool.execute({}, baseCtx)

        expect(result.title).toBe("Task graph")
        expect(result.output).toContain("Task Tracker Graph")
        expect(result.output).toContain(task.id)
        expect(result.output).toContain("Root task")
        ask.mockRestore()
      },
    })
  })

  test("tracker_visualize shows skill loading hints for blocked tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tracker = await Tracker.get()
        const blockedTask = await tracker.createTask({
          title: "Test skill dag - jupyter",
          description: "Task blocked by missing skill",
          type: TaskType.TASK,
          status: TaskStatus.BLOCKED,
          dependencies: [],
          requiredSkills: ["jupyter-notebook"],
        })

        const ask = spyOn({ ask: baseCtx.ask }, "ask")
        ask.mockResolvedValue(undefined)

        const tool = await TrackerVisualizeTool.init()
        const result = await tool.execute({}, baseCtx)

        expect(result.title).toBe("Task graph")
        expect(result.output).toContain("[blocked]")
        expect(result.output).toContain("Test skill dag - jupyter")
        expect(result.output).toContain("blocked by:")
        expect(result.output).toContain("missing skills: jupyter-notebook")
        expect(result.output).toContain("→ Load skills: skill(name=\"jupyter-notebook\")")
        ask.mockRestore()
      },
    })
  })
})
