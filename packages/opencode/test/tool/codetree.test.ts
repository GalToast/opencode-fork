import { describe, test, expect, mock, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { CodeTreeTool } from "../../src/tool/codetree"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test-codetree-session" as any,
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.codetree", () => {
  afterEach(() => {
    mock.restore()
  })

  test("extracts classes, methods, and exports from a file", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "example.ts")
    const code = `
export const MY_CONST = 42;

export function helperFunction(a: string, b: number): boolean {
  return true;
}

class MyClass {
  private internalProperty = 1;

  constructor() {}

  public myMethod(arg: string) {
    console.log(arg);
  }
}
    `
    await fs.writeFile(filepath, code, "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const codetree = await CodeTreeTool.init()
        const result = await codetree.execute(
          {
            filePath: filepath,
          },
          // @ts-ignore
          ctx,
        )

        expect(result.metadata.outline).toBeDefined()
        const outlineStr = result.output
        expect(outlineStr).toContain("export MY_CONST")
        expect(outlineStr).toContain("function helperFunction(a, b): boolean")
        expect(outlineStr).toContain("class MyClass")
        expect(outlineStr).toContain("  method myMethod(arg)")
      },
    })
  })
})
