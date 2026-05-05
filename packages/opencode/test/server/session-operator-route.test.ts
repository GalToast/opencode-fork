import { describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Agent } from "../../src/agent/agent"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionForeground } from "../../src/session/foreground"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { SessionWorkGraph } from "../../src/session/workgraph"
import { SessionPlanState } from "../../src/session/plan-state"
import { SessionMission } from "../../src/session/mission"
import { ExecutionLedger } from "../../src/execution/ledger"
import { Log } from "../../src/util/log"
import { Tracker } from "../../src/tracker/service"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const routeTest = (name: string, fn: () => void | Promise<unknown>) => test(name, fn, 20_000)

describe("session operator and mission routes", () => {
  routeTest("returns root-scoped mission and operator surfaces for descendant sessions", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "root session" })
        const child = await Session.create({ title: "child session", parentID: root.id })

        const missionResponse = await Server.App().request(`/session/${child.id}/mission`)
        expect(missionResponse.status).toBe(200)
        const mission = (await missionResponse.json()) as {
          rootSessionID: string
          sessionID: string
          childCount: number
          state: string
        }
        expect(mission.rootSessionID).toBe(root.id)
        expect(mission.sessionID).toBe(child.id)
        expect(mission.childCount).toBeGreaterThanOrEqual(0)
        expect(typeof mission.state).toBe("string")

        const operatorResponse = await Server.App().request(`/session/${child.id}/operator`)
        expect(operatorResponse.status).toBe(200)
        const operator = (await operatorResponse.json()) as {
          rootSessionID: string
          sessionID: string
          pendingInboxCount: number
          capabilityCount: number
        }
        expect(operator.rootSessionID).toBe(root.id)
        expect(operator.sessionID).toBe(child.id)
        expect(operator.pendingInboxCount).toBe(0)
        expect(operator.capabilityCount).toBeGreaterThanOrEqual(0)
      },
    })
  })

  routeTest("reuses the root family walk across mission and operator requests for the same root", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "root session" })
        const child = await Session.create({ title: "child session", parentID: root.id })

        const childrenSpy = spyOn(Session, "children")
        try {
          const missionResponse = await Server.App().request(`/session/${child.id}/mission`)
          const operatorResponse = await Server.App().request(`/session/${child.id}/operator`)

          expect(missionResponse.status).toBe(200)
          expect(operatorResponse.status).toBe(200)
          expect(childrenSpy).toHaveBeenCalledTimes(1)
        } finally {
          childrenSpy.mockRestore()
        }
      },
    })
  })

  routeTest("lists a lightweight experimental capability catalog", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/experimental/capability")
        expect(response.status).toBe(200)

        const payload = (await response.json()) as {
          counts: { total: number; tools: number; commands: number }
          items: Array<{ id: string; kind: string }>
        }

        expect(payload.counts.total).toBeGreaterThan(0)
        expect(payload.counts.tools).toBeGreaterThan(0)
        expect(payload.counts.commands).toBeGreaterThan(0)
        expect(payload.items.some((item) => item.kind === "tool")).toBe(true)
        expect(payload.items.some((item) => item.kind === "command")).toBe(true)
      },
    })
  })

  routeTest("returns planner preview and recent execution timeline when available", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "planner root" })
        const child = await Session.create({ title: "planner child", parentID: root.id })
        const planPath = Session.plan(root)

        // @ts-ignore
        await SessionMission.recordIngress({
          sessionID: child.id,
          rootSessionID: root.id,
          intent: "Keep the planner focused on the operator rail and avoid route churn.",
          constraintsSummary: "Keep the planner focused on the operator rail and avoid route churn.",
        })

        await fs.mkdir(path.dirname(planPath), { recursive: true })
        await Bun.write(planPath, "# plan\n")

        await ExecutionLedger.append({
          jobID: "job-1",
          sessionID: child.id,
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          phase: "running",
          status: "running",
          description: "Run planner follow-up",
          time: Date.now(),
          source: "scheduler",
        })

        const plannerResponse = await Server.App().request(`/session/${child.id}/planner-preview`)
        expect(plannerResponse.status).toBe(200)
        const planner = (await plannerResponse.json()) as {
          rootSessionID: string
          sessionID: string
          mode: string
          exists: boolean
          planPath: string
          hint: string
        }
        expect(planner.rootSessionID).toBe(root.id)
        expect(planner.sessionID).toBe(child.id)
        expect(planner.mode).toBe("plan")
        expect(typeof planner.exists).toBe("boolean")
        expect(planner.planPath).toContain(".opencode")
        expect(planner.hint).toContain("Focus: Keep the planner focused on the operator rail")
        expect(planner.hint).toContain("Constraints: Keep the planner focused on the operator rail")
        expect(planner.hint).toContain("Recent planning activity is happening in a child session.")

        const timelineResponse = await Server.App().request(`/session/${child.id}/timeline`)
        expect(timelineResponse.status).toBe(200)
        const timeline = (await timelineResponse.json()) as {
          rootSessionID: string
          sessionID: string
          count: number
          events: Array<{ sessionID: string; phase: string; description: string }>
        }
        expect(timeline.rootSessionID).toBe(root.id)
        expect(timeline.sessionID).toBe(child.id)
        expect(timeline.count).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(timeline.events)).toBe(true)
      },
    })
  })

  routeTest("dedupes concurrent planner preview requests for the same session", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "planner root" })
        const child = await Session.create({ title: "planner child", parentID: root.id })
        const planPath = Session.plan(root)

        await SessionMission.recordIngress({
          sessionID: child.id,
          rootSessionID: root.id,
          intent: "Keep the planner focused on the operator rail and avoid route churn.",
          constraintsSummary: "Keep the planner focused on the operator rail and avoid route churn.",
        })

        await fs.mkdir(path.dirname(planPath), { recursive: true })
        await Bun.write(planPath, "# plan\n")

        const messagesSpy = spyOn(Session, "messages")
        try {
          const [first, second] = await Promise.all([
            Server.App().request(`/session/${child.id}/planner-preview`),
            Server.App().request(`/session/${child.id}/planner-preview`),
          ])

          expect(first.status).toBe(200)
          expect(second.status).toBe(200)
          expect(messagesSpy).not.toHaveBeenCalled()
        } finally {
          messagesSpy.mockRestore()
        }
      },
    })
  })

  routeTest("dedupes concurrent operator requests for the same session", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "root session" })
        const child = await Session.create({ title: "child session", parentID: root.id })

        const permissionSpy = spyOn(SessionStatus, "list")
        try {
          const [first, second] = await Promise.all([
            Server.App().request(`/session/${child.id}/operator`),
            Server.App().request(`/session/${child.id}/operator`),
          ])

          expect(first.status).toBe(200)
          expect(second.status).toBe(200)
          expect(permissionSpy).toHaveBeenCalledTimes(1)
        } finally {
          permissionSpy.mockRestore()
        }
      },
    })
  })

  routeTest("dedupes concurrent timeline requests for the same session", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "timeline root" })
        const child = await Session.create({ title: "timeline child", parentID: root.id })

        await ExecutionLedger.append({
          jobID: "job-timeline",
          sessionID: child.id,
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          phase: "running",
          status: "running",
          description: "Timeline entry for dedupe check",
          time: Date.now(),
          source: "scheduler",
        })

        const listSpy = spyOn(ExecutionLedger, "list")
        try {
          const [first, second] = await Promise.all([
            Server.App().request(`/session/${child.id}/timeline?limit=10`),
            Server.App().request(`/session/${child.id}/timeline?limit=10`),
          ])

          expect(first.status).toBe(200)
          expect(second.status).toBe(200)
          expect(listSpy).toHaveBeenCalledTimes(1)
        } finally {
          listSpy.mockRestore()
        }
      },
    })
  })

  routeTest("dedupes concurrent plan-state requests for the same session", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "plan-state root" })
        const child = await Session.create({ title: "plan-state child", parentID: root.id })

        await SessionPlanState.set(root.id, { mode: "planning" })
        await SessionPlanState.set(child.id, { mode: "awaiting_approval", approvedPlanPath: "approved" })

        const planStateSpy = spyOn(SessionPlanState, "get")
        try {
          const [first, second] = await Promise.all([
            Server.App().request(`/session/${child.id}/plan-state`),
            Server.App().request(`/session/${child.id}/plan-state`),
          ])

          expect(first.status).toBe(200)
          expect(second.status).toBe(200)
          expect(planStateSpy).toHaveBeenCalledTimes(1)
        } finally {
          planStateSpy.mockRestore()
        }
      },
    })
  })

  routeTest("dedupes concurrent tracker requests for the same session", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "tracker root" })
        const child = await Session.create({ title: "tracker child", parentID: root.id })

        const trackerSpy = spyOn(Tracker, "get")
        try {
          const [first, second] = await Promise.all([
            Server.App().request(`/session/${child.id}/tracker`),
            Server.App().request(`/session/${child.id}/tracker`),
          ])

          expect(first.status).toBe(200)
          expect(second.status).toBe(200)
          expect(trackerSpy).toHaveBeenCalledTimes(1)
        } finally {
          trackerSpy.mockRestore()
        }
      },
    })
  })

  routeTest("dedupes concurrent workgraph requests for the same session", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "workgraph root" })
        const child = await Session.create({ title: "workgraph child", parentID: root.id })

        await SessionWorkGraph.recordObjective({
          rootSessionID: root.id,
          sessionID: child.id,
          title: "Graph objective for dedupe check",
        })

        const workGraphSpy = spyOn(SessionWorkGraph, "get")
        try {
          const [first, second] = await Promise.all([
            Server.App().request(`/session/${child.id}/workgraph`),
            Server.App().request(`/session/${child.id}/workgraph`),
          ])

          expect(first.status).toBe(200)
          expect(second.status).toBe(200)
          expect(workGraphSpy).toHaveBeenCalledTimes(1)
        } finally {
          workGraphSpy.mockRestore()
        }
      },
    })
  })

  routeTest("returns a root-scoped work graph surface for descendant sessions", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "workgraph root" })
        const child = await Session.create({ title: "workgraph child", parentID: root.id })

        await SessionWorkGraph.recordObjective({
          rootSessionID: root.id,
          sessionID: child.id,
          title: "Build the first Octospine slice",
          constraintsSummary: "Keep the surface lightweight and root-scoped.",
        })
        await SessionWorkGraph.recordLane({
          rootSessionID: root.id,
          sessionID: child.id,
          laneID: child.id,
          title: "Worker lane for the route slice",
          status: "running",
          schedulerLane: "subagent_tasks",
          discipline: "worker",
          subagentType: "general",
        })
        await SessionWorkGraph.recordArtifact({
          rootSessionID: root.id,
          sessionID: child.id,
          taskID: child.id,
          type: "summary",
          summary: "Root-scoped work graph route ready for review.",
        })

        const response = await Server.App().request(`/session/${child.id}/workgraph`)
        expect(response.status).toBe(200)

        const graph = (await response.json()) as {
          rootSessionID: string
          sessionID: string
          objectiveCount: number
          activeObjectiveCount: number
          laneCount: number
          activeLaneCount: number
          artifactCount: number
          latestObjective?: string
          objectives: Array<{ title: string; status: string }>
          lanes: Array<{ title: string; status: string; schedulerLane?: string }>
          artifacts: Array<{ type: string; summary: string }>
          digest?: { text: string }
        }

        expect(graph.rootSessionID).toBe(root.id)
        expect(graph.sessionID).toBe(child.id)
        expect(graph.objectiveCount).toBe(1)
        expect(graph.activeObjectiveCount).toBe(1)
        expect(graph.laneCount).toBe(1)
        expect(graph.activeLaneCount).toBe(1)
        expect(graph.artifactCount).toBe(1)
        expect(graph.latestObjective).toContain("Octospine")
        expect(graph.objectives[0]?.title).toContain("Octospine")
        expect(graph.lanes[0]?.schedulerLane).toBe("subagent_tasks")
        expect(graph.artifacts[0]?.type).toBe("summary")
        expect(graph.digest?.text).toContain("Objective focus")
        expect(graph.digest?.text).toContain("Active lanes")
      },
    })
  })

  routeTest("keeps root-family timeline events even when the global ledger is noisy", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "timeline root" })
        const child = await Session.create({ title: "timeline child", parentID: root.id })
        const unrelated = await Session.create({ title: "unrelated session" })
        const baseTime = Date.now()

        await ExecutionLedger.append({
          jobID: "job-family",
          sessionID: root.id,
          kind: "prompt",
          lane: "main_turns",
          priority: "normal",
          phase: "running",
          status: "running",
          description: "Family event that should survive truncation",
          time: baseTime,
          source: "scheduler",
        })

        for (let index = 0; index < 40; index++) {
          await ExecutionLedger.append({
            jobID: `job-noise-${index}`,
            sessionID: unrelated.id,
            kind: "prompt",
            lane: "main_turns",
            priority: "background",
            phase: "running",
            status: "running",
            description: `Noise event ${index}`,
            time: baseTime + index + 1,
            source: "scheduler",
          })
        }

        const response = await Server.App().request(`/session/${child.id}/timeline?limit=5`)
        expect(response.status).toBe(200)

        const timeline = (await response.json()) as {
          rootSessionID: string
          sessionID: string
          count: number
          events: Array<{ sessionID: string; description: string }>
        }

        expect(timeline.rootSessionID).toBe(root.id)
        expect(timeline.sessionID).toBe(child.id)
        expect(timeline.count).toBe(1)
        expect(timeline.events).toHaveLength(1)
        expect(timeline.events[0]?.sessionID).toBe(root.id)
        expect(timeline.events[0]?.description).toContain("should survive truncation")
      },
    })
  })

  routeTest("manual compaction cancels only the targeted session even when a sibling is foreground", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "root session" })
        const targetChild = await Session.create({ title: "target child", parentID: root.id })
        const siblingChild = await Session.create({ title: "sibling child", parentID: root.id })

        await SessionForeground.accept({
          sessionID: siblingChild.id,
          rootSessionID: root.id,
          messageID: "msg_foreground_sibling",
          intent: "Sibling lane is foreground",
          responder: { agent: "build" },
        })
        await SessionForeground.promote({
          sessionID: siblingChild.id,
          rootSessionID: root.id,
          turnID: "turn_foreground_sibling",
        })

        const cancelSpy = spyOn(SessionPrompt, "cancel").mockResolvedValue()
        const loopSpy = spyOn(SessionPrompt, "loop").mockResolvedValue({} as any)
        const compactionSpy = spyOn(SessionCompaction, "create").mockResolvedValue({ id: "msg_compaction" } as any)

        try {
          const response = await Server.App().request(`/session/${targetChild.id}/summarize`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              providerID: "alibaba-coding-plan",
              modelID: "qwen3.5-plus",
              auto: false,
            }),
          })

          expect(response.status).toBe(200)
          expect(cancelSpy).toHaveBeenCalledTimes(1)
          expect(cancelSpy).toHaveBeenCalledWith(targetChild.id)
          expect(cancelSpy.mock.calls.some((call) => call[0] === siblingChild.id)).toBe(false)
          expect(compactionSpy).toHaveBeenCalledTimes(1)
          expect(loopSpy).toHaveBeenCalledTimes(1)
        } finally {
          cancelSpy.mockRestore()
          loopSpy.mockRestore()
          compactionSpy.mockRestore()
        }
      },
    })
  })

  routeTest("manual compaction defaults to the configured compaction agent model when no explicit model is supplied", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "root session" })
        await Session.updateMessage({
          id: "msg_manual_compaction_user" as any,
          sessionID: root.id,
          role: "user",
          agent: "build",
          model: {
            providerID: "alibaba-coding-plan",
            modelID: "glm-5",
          },
          time: {
            created: Date.now(),
          },
        } as any)

        const loopSpy = spyOn(SessionPrompt, "loop").mockResolvedValue({} as any)
        const compactionSpy = spyOn(SessionCompaction, "create").mockResolvedValue({ id: "msg_compaction" } as any)
        const originalGet = Agent.get.bind(Agent)
        const agentSpy = spyOn(Agent, "get").mockImplementation(async (name: string) => {
          if (name === "compaction") {
            return {
              name: "compaction",
              model: {
                providerID: "alibaba-coding-plan",
                modelID: "qwen3.5-plus",
              },
            } as any
          }
          return originalGet(name)
        })

        try {
          const response = await Server.App().request(`/session/${root.id}/summarize`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              auto: false,
            }),
          })

          expect(response.status).toBe(200)
          expect(compactionSpy).toHaveBeenCalledTimes(1)
          expect(compactionSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              sessionID: root.id,
              model: {
                providerID: "alibaba-coding-plan",
                modelID: "qwen3.5-plus",
              },
            }),
          )
          expect(loopSpy).toHaveBeenCalledTimes(1)
        } finally {
          agentSpy.mockRestore()
          loopSpy.mockRestore()
          compactionSpy.mockRestore()
        }
      },
    })
  })
})
