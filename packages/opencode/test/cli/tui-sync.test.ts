import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packageRoot = path.resolve(import.meta.dir, "..", "..")

async function runSyncHelper(code: string) {
  const scriptPath = path.join(packageRoot, `tmp-sync-helper-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`)
  await Bun.write(scriptPath, code)
  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", scriptPath],
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })

    const stdout = new TextDecoder().decode(result.stdout).trim()
    const stderr = new TextDecoder().decode(result.stderr).trim()

    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
    return JSON.parse(stdout)
  } finally {
    await fs.rm(scriptPath, { force: true }).catch(() => {})
  }
}

describe("tui sync session helpers", () => {
  test(
    "resolves root-scoped session families from any descendant",
    async () => {
    const result = await runSyncHelper(`
      import { getRootSessionID, listRootScopedSessionIDs, listSessionDescendants } from "./src/cli/cmd/tui/context/sync.tsx"

      const sessions = [
        { id: "root" },
        { id: "child-a", parentID: "root" },
        { id: "child-b", parentID: "root" },
        { id: "grandchild", parentID: "child-a" },
        { id: "other-root" },
      ]

      console.log(JSON.stringify({
        root: getRootSessionID(sessions as any, "grandchild"),
        descendants: listSessionDescendants(sessions as any, "child-a"),
        family: listRootScopedSessionIDs(sessions as any, "grandchild"),
      }))
      process.exit(0)
    `)

    expect(result).toEqual({
      root: "root",
      descendants: ["child-a", "grandchild"],
      family: ["child-a", "child-b", "grandchild", "root"],
    })
    },
    { timeout: 15000 },
  )

  test(
    "collects root-scoped requests across the full descendant tree",
    async () => {
    const result = await runSyncHelper(`
      import { collectRootScopedRequests } from "./src/cli/cmd/tui/context/sync.tsx"

      const sessions = [{ id: "root" }, { id: "child", parentID: "root" }, { id: "grandchild", parentID: "child" }]
      const requests = {
        root: [{ id: "perm-root" }],
        child: [{ id: "perm-child" }],
        grandchild: [{ id: "perm-grandchild" }],
      }

      console.log(JSON.stringify(collectRootScopedRequests(sessions as any, requests, "grandchild")))
      process.exit(0)
    `)

    expect(result).toEqual([
      { id: "perm-child" },
      { id: "perm-grandchild" },
      { id: "perm-root" },
    ])
    },
    { timeout: 15000 },
  )

  test(
    "falls back to the highest loaded ancestor when the parent chain is incomplete",
    async () => {
    const result = await runSyncHelper(`
      import { getRootSessionID, listRootScopedSessionIDs } from "./src/cli/cmd/tui/context/sync.tsx"

      const sessions = [
        { id: "child", parentID: "missing-root" },
        { id: "grandchild", parentID: "child" },
        { id: "sibling", parentID: "child" },
      ]

      console.log(JSON.stringify({
        childRoot: getRootSessionID(sessions as any, "child"),
        grandchildRoot: getRootSessionID(sessions as any, "grandchild"),
        family: listRootScopedSessionIDs(sessions as any, "grandchild"),
      }))
      process.exit(0)
    `)

    expect(result).toEqual({
      childRoot: "child",
      grandchildRoot: "child",
      family: ["child", "grandchild", "sibling"],
    })
    },
    { timeout: 15000 },
  )

  test(
    "clears per-session caches, message parts, and invalidates root foreground state",
    async () => {
    const result = await runSyncHelper(`
      import { clearSessionCaches } from "./src/cli/cmd/tui/context/sync.tsx"

      const fullSyncedSessions = new Set(["root", "child"])
      const store = {
        permission: { child: [{ id: "perm-child" }] },
        question: { child: [{ id: "question-child" }] },
        supervisor_inbox: { child: [{ taskID: "task-child" }] },
        steer: { child: { sessionID: "child" as any, stage: "received", at: 1, pending: 1 } },
        foreground: {
          root: {
            rootSessionID: "root",
            latestSessionID: "child",
            latestUserIntent: "Investigate sync drift",
            state: "responding",
            awaitingPromotion: false,
            activeSessionID: "child",
          },
        },
        mission: {
          root: {
            rootSessionID: "root",
            sessionID: "child" as any,
            state: "responding",
            latestUserIntent: "Investigate sync drift",
            todoCount: 1,
            childCount: 1,
            activeChildCount: 1,
            pendingSteer: 1,
            updatedAt: 1,
          },
        },
        operator: {
          root: {
            rootSessionID: "root",
            sessionID: "child" as any,
            state: "blocked",
            latestUserIntent: "Investigate sync drift",
            pendingPermissionCount: 1,
            pendingQuestionCount: 1,
            pendingInboxCount: 2,
            activeChildCount: 1,
            scheduler: { mode: "hybrid", queuedTotal: 1, runningTotal: 1 },
            capabilityCount: 7,
            updatedAt: 1,
          },
        },
        planner_preview: {
          root: {
            rootSessionID: "root",
            sessionID: "child" as any,
            mode: "plan",
            planPath: ".opencode/plans/demo.md",
            exists: true,
            hint: "Plan file ready",
            updatedAt: 1,
          },
        },
        timeline: {
          root: {
            rootSessionID: "root",
            sessionID: "child" as any,
            count: 1,
            events: [{ id: "evt-1", sessionID: "child" as any, phase: "running" }],
          },
        },
        plan_state: {
          root: {
            rootSessionID: "root",
            sessionID: "child" as any,
            mode: "planning",
            updatedAt: 1,
          },
        },
        tracker_summary: {
          root: {
            rootSessionID: "root",
            sessionID: "child" as any,
            taskCount: 1,
            openCount: 1,
            inProgressCount: 0,
            blockedCount: 0,
            closedCount: 0,
            recentCount: 1,
            latestTasks: [],
            tasks: [],
            trackerPath: ".opencode/tracker/demo.json",
            updatedAt: 1,
          },
        },
        workgraph: {
          root: {
            rootSessionID: "root",
            sessionID: "child" as any,
            updatedAt: 1,
            objectiveCount: 1,
            activeObjectiveCount: 1,
            laneCount: 1,
            activeLaneCount: 1,
            artifactCount: 0,
            latestObjective: "Investigate sync drift",
            objectives: [],
            lanes: [],
            artifacts: [],
          },
        },
        session_status: { child: { type: "working" } },
        session_diff: { child: [{ file: "a.ts" }] },
        todo: { child: [{ id: "todo-child" }] },
        message: {
          child: [
            { id: "msg-child-1", sessionID: "child" as any },
            { id: "msg-child-2", sessionID: "child" as any },
          ],
        },
        part: {
          "msg-child-1": [{ id: "part-1" }],
          "msg-child-2": [{ id: "part-2" }],
          unrelated: [{ id: "part-unrelated" }],
        },
      }

      clearSessionCaches(store as any, "child", {
        fullSyncedSessions,
        rootSessionID: "root",
      })

      console.log(
        JSON.stringify({
          store,
          fullSyncedSessions: [...fullSyncedSessions].sort(),
        }),
      )
      process.exit(0)
    `)

    expect(result).toEqual({
      store: {
        foreground: {},
        message: {},
        mission: {},
        operator: {},
        planner_preview: {},
        timeline: {},
        plan_state: {},
        tracker_summary: {},
        workgraph: {},
        part: {
          unrelated: [{ id: "part-unrelated" }],
        },
        permission: {},
        question: {},
        session_diff: {},
        session_status: {},
        steer: {},
        supervisor_inbox: {},
        todo: {},
      },
      fullSyncedSessions: [],
    })
    },
    { timeout: 15000 },
  )

  test(
    "bounds supervisor inbox history while preserving task-keyed updates",
    async () => {
      const result = await runSyncHelper(`
        import { upsertSupervisorInboxItem } from "./src/cli/cmd/tui/context/sync.tsx"

        let items = [
          {
            taskID: "task-a",
            supervisorSessionID: "root",
            subagentType: "worker",
            description: "Oldest task",
            pendingTurns: 1,
            status: "queued",
            time: 10,
          },
          {
            taskID: "task-c",
            supervisorSessionID: "root",
            subagentType: "worker",
            description: "Middle task",
            pendingTurns: 1,
            status: "queued",
            time: 30,
          },
        ]

        items = upsertSupervisorInboxItem(items as any, {
          taskID: "task-b",
          supervisorSessionID: "root",
          subagentType: "worker",
          description: "Inserted by task id",
          pendingTurns: 1,
          status: "started",
          time: 20,
        } as any, 3)

        items = upsertSupervisorInboxItem(items as any, {
          taskID: "task-d",
          supervisorSessionID: "root",
          subagentType: "worker",
          description: "Newest task",
          pendingTurns: 1,
          status: "completed",
          time: 40,
        } as any, 3)

        items = upsertSupervisorInboxItem(items as any, {
          taskID: "task-c",
          supervisorSessionID: "root",
          subagentType: "worker",
          description: "Updated middle task",
          pendingTurns: 0,
          status: "completed",
          time: 50,
        } as any, 3)

        console.log(JSON.stringify(items))
        process.exit(0)
      `)

      expect(result).toEqual([
        {
          taskID: "task-b",
          supervisorSessionID: "root",
          subagentType: "worker",
          description: "Inserted by task id",
          pendingTurns: 1,
          status: "started",
          time: 20,
        },
        {
          taskID: "task-c",
          supervisorSessionID: "root",
          subagentType: "worker",
          description: "Updated middle task",
          pendingTurns: 0,
          status: "completed",
          time: 50,
        },
        {
          taskID: "task-d",
          supervisorSessionID: "root",
          subagentType: "worker",
          description: "Newest task",
          pendingTurns: 1,
          status: "completed",
          time: 40,
        },
      ])
    },
    { timeout: 15000 },
  )

  test(
    "maps live SDK events to root-surface refresh sessions",
    async () => {
      const result = await runSyncHelper(`
        import { getRootSurfaceRefreshSessionID } from "./src/cli/cmd/tui/context/sync.tsx"

        const lookup = (messageID) => (messageID === "msg-known" ? "session-from-message" : undefined)
        const events = [
          { type: "permission.asked", properties: { sessionID: "permission-session" } },
          { type: "question.replied", properties: { sessionID: "question-session" } },
          { type: "todo.updated", properties: { sessionID: "todo-session" } },
          { type: "session.updated", properties: { info: { id: "updated-session" } } },
          { type: "message.updated", properties: { info: { sessionID: "message-session" } } },
          { type: "message.part.updated", properties: { part: { sessionID: "part-session", messageID: "msg-known" } } },
          { type: "message.part.delta", properties: { messageID: "msg-known" } },
          { type: "message.part.removed", properties: { messageID: "msg-missing" } },
          { type: "server.instance.disposed", properties: {} },
        ]

        console.log(JSON.stringify(events.map((event) => getRootSurfaceRefreshSessionID(event, lookup))))
        process.exit(0)
      `)

      expect(result).toEqual([
        "permission-session",
        "question-session",
        "todo-session",
        "updated-session",
        "message-session",
        "part-session",
        "session-from-message",
        null,
        null,
      ])
    },
    { timeout: 15000 },
  )

  test(
    "debounces root-surface refresh scheduling by session",
    async () => {
      const result = await runSyncHelper(`
        import { createRootSurfaceRefreshScheduler } from "./src/cli/cmd/tui/context/sync.tsx"

        const refreshes = []
        const cleared = []
        const timers = []
        const scheduler = createRootSurfaceRefreshScheduler({
          delayMS: 25,
          refresh: (sessionID) => refreshes.push(sessionID),
          setTimeoutFn: (fn, delayMS) => {
            const timer = { id: timers.length + 1, fn, delayMS }
            timers.push(timer)
            return timer
          },
          clearTimeoutFn: (timer) => cleared.push(timer.id),
        })

        scheduler.schedule("root-a")
        scheduler.schedule("root-a")
        scheduler.schedule("root-b")
        const pendingBeforeRun = scheduler.pending()
        timers.at(-2).fn()
        timers.at(-1).fn()
        scheduler.schedule("root-c")
        const pendingBeforeCancel = scheduler.pending()
        scheduler.cancelAll()

        console.log(JSON.stringify({
          cleared,
          pendingBeforeRun,
          pendingBeforeCancel,
          pendingAfterCancel: scheduler.pending(),
          refreshes,
          timerDelays: timers.map((timer) => timer.delayMS),
        }))
        process.exit(0)
      `)

      expect(result).toEqual({
        cleared: [1, 4],
        pendingBeforeRun: ["root-a", "root-b"],
        pendingBeforeCancel: ["root-c"],
        pendingAfterCancel: [],
        refreshes: ["root-a", "root-b"],
        timerDelays: [25, 25, 25, 25],
      })
    },
    { timeout: 15000 },
  )

  test(
    "fetches and applies root-surface payloads without letting one failed surface block the rest",
    async () => {
      const result = await runSyncHelper(`
        import {
          applyRootSurfaceFetchResults,
          createRootSurfaceFetchPlan,
          fetchRootSurfacePayloads,
        } from "./src/cli/cmd/tui/context/sync.tsx"

        const calls = []
        const client = {
          async get(options) {
            calls.push(options)
            if (options.url.endsWith("/operator")) throw new Error("operator unavailable")
            return {
              data: {
                rootSessionID: "root",
                sessionID: "child",
                surface: options.url.split("/").at(-1),
                query: options.query,
              },
            }
          },
        }
        const plan = createRootSurfaceFetchPlan("child/session")
        const results = await fetchRootSurfacePayloads(client, "child/session")
        const store = {
          mission: {},
          operator: {},
          planner_preview: {},
          timeline: {},
          plan_state: {},
          tracker_summary: {},
          workgraph: {},
        }
        applyRootSurfaceFetchResults(store, results)

        console.log(JSON.stringify({ plan, calls, results, store }))
        process.exit(0)
      `)

      expect(result.plan.map((item: { name: string; url: string }) => [item.name, item.url])).toEqual([
        ["mission", "/session/child%2Fsession/mission"],
        ["operator", "/session/child%2Fsession/operator"],
        ["plannerPreview", "/session/child%2Fsession/planner-preview"],
        ["timeline", "/session/child%2Fsession/timeline"],
        ["planState", "/session/child%2Fsession/plan-state"],
        ["tracker", "/session/child%2Fsession/tracker"],
        ["workgraph", "/session/child%2Fsession/workgraph"],
      ])
      expect(result.calls.find((call: { url: string }) => call.url.endsWith("/timeline"))?.query).toEqual({ limit: 20 })
      expect(result.results.map((item: { name: string; ok: boolean }) => [item.name, item.ok])).toEqual([
        ["mission", true],
        ["operator", false],
        ["plannerPreview", true],
        ["timeline", true],
        ["planState", true],
        ["tracker", true],
        ["workgraph", true],
      ])
      expect(Object.keys(result.store.operator)).toEqual([])
      expect(result.store.mission.root.surface).toBe("mission")
      expect(result.store.planner_preview.root.surface).toBe("planner-preview")
      expect(result.store.timeline.root.query).toEqual({ limit: 20 })
      expect(result.store.plan_state.root.surface).toBe("plan-state")
      expect(result.store.tracker_summary.root.surface).toBe("tracker")
      expect(result.store.workgraph.root.surface).toBe("workgraph")
    },
    { timeout: 15000 },
  )

  test(
    "records rolling root-surface refresh diagnostics with slowest-surface tracking",
    async () => {
      const result = await runSyncHelper(`
        import {
          createRootSurfaceRefreshDiagnostics,
          recordRootSurfaceRefreshDiagnostics,
        } from "./src/cli/cmd/tui/context/sync.tsx"

        const diagnostics = createRootSurfaceRefreshDiagnostics()

        recordRootSurfaceRefreshDiagnostics(diagnostics, {
          durationMS: 180,
          completedAt: 1000,
          sessionID: "child" as any,
          rootSessionID: "root",
          surfaces: [
            { name: "mission", durationMS: 20, ok: true },
            { name: "operator", durationMS: 45, ok: true },
            { name: "plannerPreview", durationMS: 15, ok: true },
            { name: "timeline", durationMS: 60, ok: false },
            { name: "planState", durationMS: 10, ok: true },
            { name: "tracker", durationMS: 30, ok: true },
            { name: "workgraph", durationMS: 22, ok: true },
          ],
        })

        recordRootSurfaceRefreshDiagnostics(diagnostics, {
          durationMS: 320,
          completedAt: 1400,
          sessionID: "grandchild" as any,
          rootSessionID: "root",
          surfaces: [
            { name: "mission", durationMS: 25, ok: true },
            { name: "operator", durationMS: 90, ok: true },
            { name: "plannerPreview", durationMS: 20, ok: true },
            { name: "timeline", durationMS: 120, ok: true },
            { name: "planState", durationMS: 12, ok: true },
            { name: "tracker", durationMS: 40, ok: true },
            { name: "workgraph", durationMS: 35, ok: true },
          ],
        })

        console.log(JSON.stringify(diagnostics))
        process.exit(0)
      `)

      expect(result).toEqual({
        refreshCount: 2,
        slowRefreshCount: 1,
        lastDurationMS: 320,
        maxDurationMS: 320,
        averageDurationMS: 250,
        lastCompletedAt: 1400,
        lastSessionID: "grandchild",
        lastRootSessionID: "root",
        lastSlowestSurface: "timeline",
        lastSlowestDurationMS: 120,
        surfaces: {
          controlSnapshot: { count: 0, errorCount: 0, lastDurationMS: 0, maxDurationMS: 0, averageDurationMS: 0 },
          mission: { count: 2, errorCount: 0, lastDurationMS: 25, maxDurationMS: 25, averageDurationMS: 23 },
          operator: { count: 2, errorCount: 0, lastDurationMS: 90, maxDurationMS: 90, averageDurationMS: 68 },
          plannerPreview: { count: 2, errorCount: 0, lastDurationMS: 20, maxDurationMS: 20, averageDurationMS: 18 },
          timeline: { count: 2, errorCount: 1, lastDurationMS: 120, maxDurationMS: 120, averageDurationMS: 90 },
          planState: { count: 2, errorCount: 0, lastDurationMS: 12, maxDurationMS: 12, averageDurationMS: 11 },
          tracker: { count: 2, errorCount: 0, lastDurationMS: 40, maxDurationMS: 40, averageDurationMS: 35 },
          workgraph: { count: 2, errorCount: 0, lastDurationMS: 35, maxDurationMS: 35, averageDurationMS: 29 },
        },
      })
    },
    { timeout: 15000 },
  )
})
