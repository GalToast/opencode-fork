import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

describe("Textarea keybind resolution", () => {
  const packageRoot = join(__dirname, "..", "..")
  const source = readFileSync(join(packageRoot, "src/cli/cmd/tui/component/textarea-keybindings.ts"), "utf-8")

  test("maps return bindings to both return and enter names", () => {
    expect(source).toContain('if (binding.name === "return")')
    expect(source).toContain('{ ...baseBinding, name: "return" }')
    expect(source).toContain('{ ...baseBinding, name: "enter" }')
  })

  test("submit keybinding uses config mapping", () => {
    expect(source).toContain("...TEXTAREA_ACTIONS.flatMap((action) => mapTextareaKeybindings(keybinds, action))")
    expect(source).not.toMatch(/\{\s*name:\s*\"return\"\s*,\s*action:\s*\"submit\"\s*\}/)
  })

  test("keeps newline Command/Meta+Return fallback", () => {
    expect(source).toContain("{ name: \"return\", meta: true, action: \"newline\" }")
  })
})
