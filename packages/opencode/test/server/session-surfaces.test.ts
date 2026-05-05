import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { SessionPlanState } from "../../src/session/plan-state"
import { Tracker } from "../../src/tracker/service"
import { tmpdir } from "../fixture/fixture"
import { TaskStatus, TaskType } from "../../src/tracker/types"

Log.init({ print: false })

function sessionSurfacePath(tmpPath: string, sessionID: string, surface: "plan-state" | "tracker") {
  return `/session/${sessionID}/${surface}?directory=${encodeURIComponent(tmpPath)}`
}

describe("session surfaces", () => {
  describe("plan-state surface", () => {
    test("returns default planning mode when no state exists", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "test-session" })

          const response = await Server.App().request(sessionSurfacePath(tmp.path, session.id, "plan-state"))
          expect(response.status).toBe(200)

          const body = await response.json()
          expect(body.rootSessionID).toBe(session.id)
          expect(body.sessionID).toBe(session.id)
          expect(body.mode).toBe("planning")
          expect(body.pendingPlanPath).toBeUndefined()
          expect(body.approvedPlanPath).toBeUndefined()
          expect(body.feedback).toBeUndefined()
          expect(body.updatedAt).toBeDefined()
        },
      })
    })

    test("returns stored plan state when exists", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "test-session" })

          await SessionPlanState.set(session.id, {
            mode: "approved",
            approvedPlanPath: "/path/to/plan.md",
            feedback: "Looks good",
          })

          const response = await Server.App().request(sessionSurfacePath(tmp.path, session.id, "plan-state"))
          expect(response.status).toBe(200)

          const body = await response.json()
          expect(body.mode).toBe("approved")
          expect(body.approvedPlanPath).toBe("/path/to/plan.md")
          expect(body.feedback).toBe("Looks good")
        },
      })
    })

    test("returns awaiting_approval mode", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "test-session" })

          await SessionPlanState.set(session.id, {
            mode: "awaiting_approval",
            pendingPlanPath: "/path/to/pending.md",
          })

          const response = await Server.App().request(sessionSurfacePath(tmp.path, session.id, "plan-state"))
          expect(response.status).toBe(200)

          const body = await response.json()
          expect(body.mode).toBe("awaiting_approval")
          expect(body.pendingPlanPath).toBe("/path/to/pending.md")
        },
      })
    })
  })

  describe("tracker summary surface", () => {
    test("returns empty counts when no tasks exist", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "test-session" })

          const response = await Server.App().request(sessionSurfacePath(tmp.path, session.id, "tracker"))
          expect(response.status).toBe(200)

          const body = await response.json()
          expect(body.rootSessionID).toBe(session.id)
          expect(body.sessionID).toBe(session.id)
          expect(body.taskCount).toBe(0)
          expect(body.openCount).toBe(0)
          expect(body.inProgressCount).toBe(0)
          expect(body.blockedCount).toBe(0)
          expect(body.closedCount).toBe(0)
          expect(body.latestTasks).toEqual([])
          expect(body.trackerPath).toBeDefined()
          expect(body.updatedAt).toBeDefined()
        },
      })
    })

    test("returns correct task counts", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "test-session" })
          const tracker = await Tracker.get()

          await tracker.createTask({
            title: "Open task",
            description: "An open task",
            type: TaskType.TASK,
            status: TaskStatus.OPEN,
            dependencies: [],
            metadata: { createdAt: Date.now() },
          })
          await tracker.createTask({
            title: "In progress task",
            description: "An in-progress task",
            type: TaskType.TASK,
            status: TaskStatus.IN_PROGRESS,
            dependencies: [],
            metadata: { createdAt: Date.now() },
          })
          await tracker.createTask({
            title: "Blocked task",
            description: "A blocked task",
            type: TaskType.TASK,
            status: TaskStatus.BLOCKED,
            dependencies: [],
            metadata: { createdAt: Date.now() },
          })
          await tracker.createTask({
            title: "Closed task",
            description: "A closed task",
            type: TaskType.TASK,
            status: TaskStatus.CLOSED,
            dependencies: [],
            metadata: { createdAt: Date.now() },
          })

          const response = await Server.App().request(sessionSurfacePath(tmp.path, session.id, "tracker"))
          expect(response.status).toBe(200)

          const body = await response.json()
          expect(body.taskCount).toBe(4)
          expect(body.openCount).toBe(1)
          expect(body.inProgressCount).toBe(1)
          expect(body.blockedCount).toBe(1)
          expect(body.closedCount).toBe(1)
          expect(body.latestTasks).toHaveLength(4)
        },
      })
    })

    test("returns latest tasks limited to 10", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "test-session" })
          const tracker = await Tracker.get()

          for (let i = 0; i < 15; i++) {
            await tracker.createTask({
              title: `Task ${i}`,
              description: `Task ${i} description`,
              type: TaskType.TASK,
              status: TaskStatus.OPEN,
              dependencies: [],
              metadata: { createdAt: Date.now() },
            })
          }

          const response = await Server.App().request(sessionSurfacePath(tmp.path, session.id, "tracker"))
          expect(response.status).toBe(200)

          const body = await response.json()
          expect(body.taskCount).toBe(15)
          expect(body.latestTasks).toHaveLength(10)
        },
      })
    })
  })
})
