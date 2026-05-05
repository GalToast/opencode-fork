import { describe, test, expect, mock, afterEach, spyOn } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { DependencyExplorerTool } from "../../src/tool/dependency_explorer"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { LSP } from "../../src/lsp"

const ctx = {
  sessionID: "test-dependency-explorer" as any,
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.dependency_explorer", () => {
  afterEach(() => {
    mock.restore()
  })

  test("returns workspace symbols", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "file.ts")
    await fs.writeFile(filepath, "class MyClass {}", "utf-8")

    spyOn(LSP, "workspaceSymbol").mockResolvedValue([
      {
        name: "MyClass",
        kind: 5,
        location: {
          uri: "file://" + filepath.replace(/\\/g, "/"),
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        },
      },
    ] as any)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const de = await DependencyExplorerTool.init()
        const result = await de.execute(
          {
            action: "workspace_symbol",
            query: "MyClass"
          },
          // @ts-ignore
          ctx,
        )

        expect(result.output).toContain("[MyClass]")
      },
    })
  })
})
