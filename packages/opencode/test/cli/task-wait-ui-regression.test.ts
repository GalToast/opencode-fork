import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

describe("task wait ui regression", () => {
  const packageRoot = join(__dirname, "..", "..")
  const source = readFileSync(
    join(packageRoot, "src/cli/cmd/tui/routes/session/index.tsx"),
    "utf-8",
  )

  test("resolves wait-task cards through task_id-backed child sessions", () => {
    expect(source).toContain("function resolveTaskPartSessionID(")
    expect(source).toContain('getStringField(payload, "task_id")')
    expect(source).toContain('getStringField(payload, "taskID")')
    expect(source).toContain('getStringField(payload, "session_id")')
    expect(source).toContain("resolveTaskPartSessionID({")
  })

  test("derives running task card state from the child transcript before showing launching", () => {
    expect(source).toContain("function deriveResolvedTaskStatus(")
    expect(source).toContain('if (latestAssistant.error) return "error"')
    expect(source).toContain('if (latestAssistant.finish === "stop" || latestAssistant.time.completed) return "completed"')
    const taskComponentIndex = source.indexOf("function Task(props: ToolProps<typeof TaskTool>)")
    const statusIndex = source.indexOf("deriveResolvedTaskStatus({", taskComponentIndex)
    expect(taskComponentIndex).toBeGreaterThan(-1)
    expect(statusIndex).toBeGreaterThan(taskComponentIndex)
    const summaryIndex = source.indexOf("summarizeTaskLanePart(part, {")
    const summaryStatusIndex = source.indexOf("messagesBySession: sync.data.message", summaryIndex)
    expect(summaryIndex).toBeGreaterThan(-1)
    expect(summaryStatusIndex).toBeGreaterThan(summaryIndex)
  })
})
