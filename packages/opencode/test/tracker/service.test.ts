import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Tracker } from "../../src/tracker/service"
import { TaskStatus, TaskType } from "../../src/tracker/types"
import { tmpdir } from "../fixture/fixture"

describe("tracker.service", () => {
  test("creates and lists tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tracker = await Tracker.get()
        const task = await tracker.createTask({
          title: "Investigate bug",
          description: "Look into the failing route.",
          type: TaskType.BUG,
          status: TaskStatus.OPEN,
          dependencies: [],
        })

        expect(task.id).toHaveLength(6)

        const tasks = await tracker.listTasks()
        expect(tasks.map((item) => item.id)).toContain(task.id)
      },
    })
  })

  test("prevents closing tasks with open dependencies", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tracker = await Tracker.get()
        const dep = await tracker.createTask({
          title: "Prep",
          description: "Prepare the implementation.",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: [],
        })
        const task = await tracker.createTask({
          title: "Build",
          description: "Build the feature.",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: [dep.id],
        })

        await expect(tracker.updateTask(task.id, { status: TaskStatus.CLOSED })).rejects.toThrow(
          `Cannot close task ${task.id} because dependency ${dep.id} is still open.`,
        )
      },
    })
  })

  test("rejects circular dependencies", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tracker = await Tracker.get()
        const first = await tracker.createTask({
          title: "First",
          description: "First task.",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: [],
        })
        const second = await tracker.createTask({
          title: "Second",
          description: "Second task.",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: [first.id],
        })

        await expect(tracker.updateTask(first.id, { dependencies: [second.id] })).rejects.toThrow(
          "Circular dependency detected",
        )
      },
    })
  })
})
