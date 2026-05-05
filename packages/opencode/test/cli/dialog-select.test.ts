import { expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const packageRoot = join(__dirname, "..", "..")
const source = readFileSync(
  join(packageRoot, "src/cli/cmd/tui/ui/dialog-select.tsx"),
  "utf-8",
)

test("dialog select unmounts its interactive subtree as soon as close begins", () => {
  expect(source).toContain('const [isClosing, setIsClosing] = createSignal(false)')
  expect(source).toContain("function beginClose()")
  expect(source).toContain("setIsClosing(true)")
  expect(source).toContain("<Show when={!isClosing()}>")
  expect(source).toContain("function handleSelect(option: DialogSelectOption<T>)")
  expect(source).toContain("if (disposed || closing || isClosing()) return")
  expect(source).toContain("if (isClosing()) return")
  expect(source).toContain("dialog.clear(() => {")
  expect(source).toContain("handleSelect(option)")
  expect(source).toContain("option.onSelect?.(dialog)")
  expect(source).toContain("props.onSelect?.(option)")
})
