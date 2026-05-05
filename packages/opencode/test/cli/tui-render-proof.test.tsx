/** @jsxImportSource @opentui/solid */

import { expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const packageRoot = path.resolve(import.meta.dir, "..", "..")
const outDir = path.join(packageRoot, "tmp", "tui-render-proof")

type ProofArtifacts = {
  planFrame: string
  trackerFrame: string
  listFrame: string
  dagFrame: string
  slashWiring: any
  slashDispatchResults: any[]
  slashPlanFrame: string
  slashTrackerFrame: string
  slashTasksAliasFrame: string
}

let proofArtifacts: ProofArtifacts | undefined

function readArtifact(name: string) {
  return readFileSync(path.join(outDir, name), "utf-8")
}

function loadProofArtifacts() {
  if (proofArtifacts) return proofArtifacts

  const result = Bun.spawnSync({
    cmd: ["bun", "run", "script/tui-render-proof.tsx"],
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  const stderr = new TextDecoder().decode(result.stderr).trim()
  expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })

  proofArtifacts = {
    planFrame: readArtifact("dialog-plan-frame.txt"),
    trackerFrame: readArtifact("dialog-tracker-frame.txt"),
    listFrame: readArtifact("dialog-tracker-list-frame.txt"),
    dagFrame: readArtifact("dialog-tracker-dag-frame.txt"),
    slashWiring: JSON.parse(readArtifact("slash-command-wiring.json")),
    slashDispatchResults: JSON.parse(readArtifact("slash-command-dispatch.json")),
    slashPlanFrame: readArtifact("slash-plan-dispatch-frame.txt"),
    slashTrackerFrame: readArtifact("slash-tracker-dispatch-frame.txt"),
    slashTasksAliasFrame: readArtifact("slash-tasks-alias-dispatch-frame.txt"),
  }
  return proofArtifacts
}

test("real DialogPlan module renders with mocked root-session surfaces", () => {
  const { planFrame } = loadProofArtifacts()

  expect(planFrame).toContain("Plan")
  expect(planFrame).toContain("Awaiting Approval")
  expect(planFrame).toContain("Planner:")
  expect(planFrame).toContain("mocked root-session surface")
  expect(planFrame).toContain("Workgraph:")
  expect(planFrame).toContain("Pending Plan")
  expect(planFrame).toContain("Approved Plan")
}, 20_000)

test("real DialogTracker module renders tracker summary and task rows", () => {
  const { trackerFrame } = loadProofArtifacts()

  expect(trackerFrame).toContain("Tracker")
  expect(trackerFrame).toContain("[L]ist")
  expect(trackerFrame).toContain("[D]AG")
  expect(trackerFrame).toContain("Total:")
  expect(trackerFrame).toContain("Blocked:")
  expect(trackerFrame).toContain("Tasks (4)")
  expect(trackerFrame).toContain("Restore TUI proof path")
  expect(trackerFrame).toContain("Capture DialogPlan")
  expect(trackerFrame).toContain("Capture DialogTracker")
})

test("real DialogTracker module switches from list mode to DAG mode via keyboard input", () => {
  const { listFrame, dagFrame } = loadProofArtifacts()

  expect(listFrame).toContain("Tasks (4)")
  expect(listFrame).toContain("[L]ist")
  expect(listFrame).toContain("[D]AG")
  expect(listFrame).toContain("Restore TUI proof path")
  expect(dagFrame).not.toContain("Tasks (4)")
  expect(dagFrame).toContain("Wire screenshot artifact")
  expect(dagFrame).toContain("solid, ?dag")
  expect(dagFrame).toContain("Restore TUI proof path")
  expect(dagFrame).not.toBe(listFrame)
})

test("slash command source wiring opens the real plan and tracker dialogs", () => {
  const { slashWiring } = loadProofArtifacts()

  expect(slashWiring.plan.verified).toBe(true)
  expect(slashWiring.plan.hasSlashName).toBe(true)
  expect(slashWiring.plan.opensDialog).toBe(true)
  expect(slashWiring.tracker.verified).toBe(true)
  expect(slashWiring.tracker.hasSlashName).toBe(true)
  expect(slashWiring.tracker.hasAlias).toBe(true)
  expect(slashWiring.tracker.opensDialog).toBe(true)
})

test("real CommandProvider slash dispatch opens plan, tracker, and tasks alias dialogs", () => {
  const { slashDispatchResults, slashPlanFrame, slashTrackerFrame, slashTasksAliasFrame } = loadProofArtifacts()

  expect(slashDispatchResults).toEqual([
    expect.objectContaining({ slash: "plan", hasPlan: true, hasTracker: true, hasTasksAlias: true, triggered: true, replaced: true }),
    expect.objectContaining({ slash: "tracker", hasPlan: true, hasTracker: true, hasTasksAlias: true, triggered: true, replaced: true }),
    expect.objectContaining({ slash: "tasks", hasPlan: true, hasTracker: true, hasTasksAlias: true, triggered: true, replaced: true }),
  ])
  expect(slashPlanFrame).toContain("slash dispatch probe: /plan")
  expect(slashPlanFrame).toContain("Plan")
  expect(slashPlanFrame).toContain("Awaiting Approval")
  expect(slashTrackerFrame).toContain("slash dispatch probe: /tracker")
  expect(slashTrackerFrame).toContain("Tracker")
  expect(slashTasksAliasFrame).toContain("slash dispatch probe: /tasks")
  expect(slashTasksAliasFrame).toContain("Tracker")
})
