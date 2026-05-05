import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

describe("Dialog theme regression", () => {
  const packageRoot = join(__dirname, "..", "..")
  const source = readFileSync(
    join(packageRoot, "src/cli/cmd/tui/component/dialog-theme-list.tsx"),
    "utf-8",
  )

  test("theme preview defers store mutation until after dialog mouse handlers return", () => {
    expect(source).toContain("function apply(value: string, close = false)")
    expect(source).toContain("timer = setTimeout(() => {")
    expect(source).toContain("theme.set(value)")
    expect(source).toContain("if (close) {")
    expect(source).toContain("dialog.clear()")
    expect(source).toContain("onMove={(opt) => {")
    expect(source).toContain("apply(opt.value)")
    expect(source).toContain("apply(opt.value, true)")
  })
})
