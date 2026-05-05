import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

describe("spinner regression", () => {
  const packageRoot = join(__dirname, "..", "..")
  const source = readFileSync(
    join(packageRoot, "src/cli/cmd/tui/component/spinner.tsx"),
    "utf-8",
  )

  test("spinner keeps animated glyph children stable across frames", () => {
    expect(source).toContain('import { createEffect, createMemo, createSignal, Index, onCleanup, Show } from "solid-js"')
    expect(source).toContain("<Index each={coloredSignal()}>")
    expect(source).toContain('{(part) => <span style={{ fg: part().fg }}>{part().char}</span>}')
    expect(source).not.toContain("coloredSignal().map((part) => (")
  })

  test("spinner flattens labels into plain text before rendering", () => {
    expect(source).toContain("function flattenTextChildren(value: unknown): string")
    expect(source).toContain("const label = createMemo(() => flattenTextChildren(props.children))")
    expect(source).toContain('<Show when={label()}>')
  })
})
