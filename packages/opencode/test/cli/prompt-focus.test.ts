import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

describe("Prompt focus regression", () => {
  const packageRoot = join(__dirname, "..", "..")
  const promptSource = readFileSync(
    join(packageRoot, "src/cli/cmd/tui/component/prompt/index.tsx"),
    "utf-8",
  )

  test("prompt ref callback schedules focus on mount", () => {
    expect(promptSource).toMatch(
      /ref=\{\(r:\s*TextareaRenderable\) => \{[\s\S]*?props\.ref\?\.\(ref\)[\s\S]*?if \(props\.visible !== false && !props\.disabled\)[\s\S]*?input\.focus\(\)/,
    )
  })

  test("home route prompts do not pass visible=false", () => {
    const homeSource = readFileSync(join(packageRoot, "src/cli/cmd/tui/routes/home.tsx"), "utf-8")
    const promptMatch = homeSource.match(/<Prompt[\s\S]*?\/>/)
    expect(promptMatch).not.toBeNull()
    expect(promptMatch?.[0]).not.toContain("visible=")
  })

  test("child session prompts still honor session_parent keybind", () => {
    expect(promptSource).toContain('keybind.match("session_parent", e)')
    expect(promptSource).toContain('navigate({ type: "session", sessionID: sessionRecord()!.parentID! })')
  })
})
