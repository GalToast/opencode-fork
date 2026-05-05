import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Tracker } from "../../src/tracker/service"
import { TaskStatus, TaskType } from "../../src/tracker/types"
import { tmpdir } from "../fixture/fixture"

describe("DAG Task Scheduler", () => {
  test("unblockDependentTasks promotes BLOCKED tasks when dependency closes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tracker = await Tracker.get()
        
        // Create parent task
        const parent = await tracker.createTask({
          title: "Parent Task",
          description: "Upstream task",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: []
        })
        expect(parent.status).toBe(TaskStatus.OPEN)
        
        // Create child task depending on parent
        const child = await tracker.createTask({
          title: "Child Task",
          description: "Depends on parent",
          type: TaskType.TASK,
          status: TaskStatus.BLOCKED,
          dependencies: [parent.id]
        })
        expect(child.status).toBe(TaskStatus.BLOCKED)
        expect(child.dependencies).toContain(parent.id)
        
        // Close parent - should unblock child
        await tracker.updateTask(parent.id, { status: TaskStatus.CLOSED })
        
        // Verify child was automatically promoted to OPEN
        const updatedChild = await tracker.getTask(child.id)
        expect(updatedChild?.status).toBe(TaskStatus.OPEN)
        
        // Cleanup
        await tracker.deleteTask(parent.id)
        await tracker.deleteTask(child.id)
      },
    })
  })

  test("unblockDependentTasks handles multiple dependencies correctly", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tracker = await Tracker.get()
        
        // Create two parent tasks
        const parent1 = await tracker.createTask({
          title: "Parent 1",
          description: "First upstream task",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: []
        })
        
        const parent2 = await tracker.createTask({
          title: "Parent 2",
          description: "Second upstream task",
          type: TaskType.TASK,
          status: TaskStatus.OPEN,
          dependencies: []
        })
        
        // Create child depending on both parents
        const child = await tracker.createTask({
          title: "Child Task",
          description: "Depends on both parents",
          type: TaskType.TASK,
          status: TaskStatus.BLOCKED,
          dependencies: [parent1.id, parent2.id]
        })
        expect(child.status).toBe(TaskStatus.BLOCKED)
        
        // Close first parent - child should still be blocked
        await tracker.updateTask(parent1.id, { status: TaskStatus.CLOSED })
        const afterFirst = await tracker.getTask(child.id)
        expect(afterFirst?.status).toBe(TaskStatus.BLOCKED)
        
        // Close second parent - child should now be unblocked
        await tracker.updateTask(parent2.id, { status: TaskStatus.CLOSED })
        const afterSecond = await tracker.getTask(child.id)
        expect(afterSecond?.status).toBe(TaskStatus.OPEN)
        
        // Cleanup
        await tracker.deleteTask(parent1.id)
        await tracker.deleteTask(parent2.id)
        await tracker.deleteTask(child.id)
      },
    })
  })
})
