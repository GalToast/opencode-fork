import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Tracker } from "../../src/tracker/service"
import { TaskStatus, TaskType } from "../../src/tracker/types"
import { SkillRegistry } from "../../src/skill/registry"
import { tmpdir } from "../fixture/fixture"

describe("skill-unblocking", () => {
  describe("validateDependenciesSatisfied with requiredSkills", () => {
    test("returns false when required skills are missing", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.clear()
          const tracker = await Tracker.get()

          const task = await tracker.createTask({
            title: "Skill-dependent task",
            description: "This task requires a skill to be loaded.",
            type: TaskType.TASK,
            status: TaskStatus.BLOCKED,
            dependencies: [],
            requiredSkills: ["test-skill"],
          })

          const taskMap = new Map([[task.id, task]])
          const isSatisfied = tracker.validateDependenciesSatisfied(task.id, taskMap)

          expect(isSatisfied).toBe(false)
        },
      })
    })

    test("returns true when all required skills are loaded", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.clear()
          const tracker = await Tracker.get()

          SkillRegistry.markLoaded("test-skill")

          const task = await tracker.createTask({
            title: "Skill-dependent task",
            description: "This task requires a skill to be loaded.",
            type: TaskType.TASK,
            status: TaskStatus.BLOCKED,
            dependencies: [],
            requiredSkills: ["test-skill"],
          })

          const taskMap = new Map([[task.id, task]])
          const isSatisfied = tracker.validateDependenciesSatisfied(task.id, taskMap)

          expect(isSatisfied).toBe(true)
        },
      })
    })

    test("returns false when multiple required skills - not all are loaded", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.clear()
          const tracker = await Tracker.get()

          SkillRegistry.markLoaded("skill-one")
          // skill-two is NOT loaded

          const task = await tracker.createTask({
            title: "Multi-skill task",
            description: "This task requires multiple skills.",
            type: TaskType.TASK,
            status: TaskStatus.BLOCKED,
            dependencies: [],
            requiredSkills: ["skill-one", "skill-two", "skill-three"],
          })

          const taskMap = new Map([[task.id, task]])
          const isSatisfied = tracker.validateDependenciesSatisfied(task.id, taskMap)

          expect(isSatisfied).toBe(false)
        },
      })
    })

    test("returns true when all multiple required skills are loaded", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.clear()
          const tracker = await Tracker.get()

          SkillRegistry.markLoaded("skill-one")
          SkillRegistry.markLoaded("skill-two")
          SkillRegistry.markLoaded("skill-three")

          const task = await tracker.createTask({
            title: "Multi-skill task",
            description: "This task requires multiple skills.",
            type: TaskType.TASK,
            status: TaskStatus.BLOCKED,
            dependencies: [],
            requiredSkills: ["skill-one", "skill-two", "skill-three"],
          })

          const taskMap = new Map([[task.id, task]])
          const isSatisfied = tracker.validateDependenciesSatisfied(task.id, taskMap)

          expect(isSatisfied).toBe(true)
        },
      })
    })

    test("returns true when no requiredSkills specified", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.clear()
          const tracker = await Tracker.get()

          const task = await tracker.createTask({
            title: "No-skill task",
            description: "This task has no skill requirements.",
            type: TaskType.TASK,
            status: TaskStatus.OPEN,
            dependencies: [],
          })

          const taskMap = new Map([[task.id, task]])
          const isSatisfied = tracker.validateDependenciesSatisfied(task.id, taskMap)

          expect(isSatisfied).toBe(true)
        },
      })
    })

    test("returns true when requiredSkills array is empty", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.clear()
          const tracker = await Tracker.get()

          const task = await tracker.createTask({
            title: "Empty skills task",
            description: "This task has empty skill requirements.",
            type: TaskType.TASK,
            status: TaskStatus.OPEN,
            dependencies: [],
            requiredSkills: [],
          })

          const taskMap = new Map([[task.id, task]])
          const isSatisfied = tracker.validateDependenciesSatisfied(task.id, taskMap)

          expect(isSatisfied).toBe(true)
        },
      })
    })
  })

  describe("task unblocking flow with skills", () => {
    test("task stays blocked when skill is not loaded", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.clear()
          const tracker = await Tracker.get()

          const prerequisite = await tracker.createTask({
            title: "Prerequisite task",
            description: "This must be completed first.",
            type: TaskType.TASK,
            status: TaskStatus.OPEN,
            dependencies: [],
          })

          const blockedTask = await tracker.createTask({
            title: "Blocked by skill",
            description: "This task is blocked by a skill requirement.",
            type: TaskType.TASK,
            status: TaskStatus.BLOCKED,
            dependencies: [prerequisite.id],
            requiredSkills: ["required-skill"],
          })

          // Close the prerequisite task
          await tracker.updateTask(prerequisite.id, { status: TaskStatus.CLOSED })

          // Re-fetch the blocked task to check its status
          const refreshedTask = await tracker.getTask(blockedTask.id)
          expect(refreshedTask?.status).toBe(TaskStatus.BLOCKED)
        },
      })
    })

    test("task unblocks when skill is loaded after prerequisite closes", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.clear()
          const tracker = await Tracker.get()

          const prerequisite = await tracker.createTask({
            title: "Prerequisite task",
            description: "This must be completed first.",
            type: TaskType.TASK,
            status: TaskStatus.OPEN,
            dependencies: [],
          })

          const blockedTask = await tracker.createTask({
            title: "Blocked by skill",
            description: "This task is blocked by a skill requirement.",
            type: TaskType.TASK,
            status: TaskStatus.BLOCKED,
            dependencies: [prerequisite.id],
            requiredSkills: ["required-skill"],
          })

          // Load the required skill BEFORE closing the prerequisite
          SkillRegistry.markLoaded("required-skill")

          // Close the prerequisite task - this should trigger unblocking
          await tracker.updateTask(prerequisite.id, { status: TaskStatus.CLOSED })

          // Re-fetch the blocked task to check its status
          const refreshedTask = await tracker.getTask(blockedTask.id)
          expect(refreshedTask?.status).toBe(TaskStatus.OPEN)
        },
      })
    })

    test("task unblocks when skill is loaded and validateDependenciesSatisfied is checked", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.clear()
          const tracker = await Tracker.get()

          const prerequisite = await tracker.createTask({
            title: "Prerequisite task",
            description: "This must be completed first.",
            type: TaskType.TASK,
            status: TaskStatus.CLOSED,
            dependencies: [],
          })

          const blockedTask = await tracker.createTask({
            title: "Blocked by skill",
            description: "This task is blocked by a skill requirement.",
            type: TaskType.TASK,
            status: TaskStatus.BLOCKED,
            dependencies: [prerequisite.id],
            requiredSkills: ["required-skill"],
          })

          // Initially should be blocked
          let taskMap = new Map([[prerequisite.id, prerequisite], [blockedTask.id, blockedTask]])
          expect(tracker.validateDependenciesSatisfied(blockedTask.id, taskMap)).toBe(false)

          // Load the required skill
          SkillRegistry.markLoaded("required-skill")

          // Refresh task map
          const refreshedPrereq = await tracker.getTask(prerequisite.id)
          const refreshedBlocked = await tracker.getTask(blockedTask.id)
          taskMap = new Map([[prerequisite.id, refreshedPrereq!], [blockedTask.id, refreshedBlocked!]])

          // Now should be satisfied
          expect(tracker.validateDependenciesSatisfied(blockedTask.id, taskMap)).toBe(true)
        },
      })
    })

    test("multiple skills - all must be loaded to unblock", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.clear()
          const tracker = await Tracker.get()

          const prerequisite = await tracker.createTask({
            title: "Prerequisite task",
            description: "This must be completed first.",
            type: TaskType.TASK,
            status: TaskStatus.CLOSED,
            dependencies: [],
          })

          const blockedTask = await tracker.createTask({
            title: "Blocked by multiple skills",
            description: "This task requires multiple skills.",
            type: TaskType.TASK,
            status: TaskStatus.BLOCKED,
            dependencies: [prerequisite.id],
            requiredSkills: ["skill-alpha", "skill-beta", "skill-gamma"],
          })

          let taskMap = new Map([[prerequisite.id, prerequisite], [blockedTask.id, blockedTask]])

          // No skills loaded - should be blocked
          expect(tracker.validateDependenciesSatisfied(blockedTask.id, taskMap)).toBe(false)

          // Load only one skill - still blocked
          SkillRegistry.markLoaded("skill-alpha")
          const p1 = await tracker.getTask(prerequisite.id)
          const b1 = await tracker.getTask(blockedTask.id)
          taskMap = new Map<string, any>([[prerequisite.id, p1!], [blockedTask.id, b1!]])
          expect(tracker.validateDependenciesSatisfied(blockedTask.id, taskMap)).toBe(false)

          // Load second skill - still blocked
          SkillRegistry.markLoaded("skill-beta")
          const p2 = await tracker.getTask(prerequisite.id)
          const b2 = await tracker.getTask(blockedTask.id)
          taskMap = new Map<string, any>([[prerequisite.id, p2!], [blockedTask.id, b2!]])
          expect(tracker.validateDependenciesSatisfied(blockedTask.id, taskMap)).toBe(false)

          // Load third skill - now unblocked
          SkillRegistry.markLoaded("skill-gamma")
          const p3 = await tracker.getTask(prerequisite.id)
          const b3 = await tracker.getTask(blockedTask.id)
          taskMap = new Map<string, any>([[prerequisite.id, p3!], [blockedTask.id, b3!]])
          expect(tracker.validateDependenciesSatisfied(blockedTask.id, taskMap)).toBe(true)
        },
      })
    })
  })

  describe("SkillRegistry isolation between tests", () => {
    test("SkillRegistry.clear() properly resets state - test 1", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.clear()
          SkillRegistry.markLoaded("test-skill-1")
          expect(SkillRegistry.isLoaded("test-skill-1")).toBe(true)
          expect(SkillRegistry.count()).toBe(1)
        },
      })
    })

    test("SkillRegistry.clear() properly resets state - test 2 (verifies isolation)", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // This test verifies that SkillRegistry state doesn't leak from previous test
          // If isolation works, count should be 0 at start
          expect(SkillRegistry.count()).toBe(0)
          expect(SkillRegistry.isLoaded("test-skill-1")).toBe(false)

          SkillRegistry.markLoaded("test-skill-2")
          expect(SkillRegistry.isLoaded("test-skill-2")).toBe(true)
          expect(SkillRegistry.isLoaded("test-skill-1")).toBe(false)
        },
      })
    })
  })
})
