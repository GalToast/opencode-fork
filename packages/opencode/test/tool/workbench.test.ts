import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { WorkbenchTool } from "../../src/tool/workbench"
import { resetNodeReplSessionsForTest } from "../../src/tool/node_repl"
import { tmpdir } from "../fixture/fixture"

const makeCtx = (sessionID: string) => ({
  sessionID,
  messageID: "msg-workbench-test" as any,
  callID: "call-workbench-test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
})

describe("tool.workbench", () => {
  test(
    "exec persists runtime state and reset_runtime clears it",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          try {
            const tool = await WorkbenchTool.init()
            const ctx = makeCtx("session-workbench-runtime")

            // @ts-ignore
            const first = await tool.execute({ action: "exec", code: "const workbenchValue = 12; workbenchValue" }, ctx)
            expect(first.title).toBe("Workbench Runtime")
            expect(first.output).toContain("12")

            // @ts-ignore
            const second = await tool.execute({ action: "exec", code: "workbenchValue + 5" }, ctx)
            expect(second.output).toContain("17")

            // @ts-ignore
            const reset = await tool.execute({ action: "reset_runtime" }, ctx)
            expect(reset.title).toBe("Workbench Runtime Reset")

            // @ts-ignore
            const afterReset = await tool.execute({ action: "exec", code: "globalThis.workbenchValue === undefined" }, ctx)
            expect(afterReset.output).toContain("true")
          } finally {
            resetNodeReplSessionsForTest()
          }
        },
      })
    },
    20_000,
  )

  test("create inspect replace delete manages ephemeral helpers", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WorkbenchTool.init()
        const ctx = makeCtx("session-workbench-tools")

        const created = await tool.execute(
          {
            action: "create",
            name: "parse_table",
            code: `export default { description: "Parse table", args: {}, async execute() { return "v1"; } }`,
          },
          // @ts-ignore
          ctx,
        )

        expect(created.title).toContain("parse_table")

        // @ts-ignore
        const listed = await tool.execute({ action: "list" }, ctx)
        expect(listed.output).toContain("parse_table")

        // @ts-ignore
        const inspected = await tool.execute({ action: "inspect", name: "parse_table" }, ctx)
        expect(inspected.output).toContain('return "v1"')

        const replaced = await tool.execute(
          {
            action: "replace",
            name: "parse_table",
            code: `export default { description: "Parse table", args: {}, async execute() { return "v2"; } }`,
          },
          // @ts-ignore
          ctx,
        )

        expect(replaced.title).toContain("parse_table")

        // @ts-ignore
        const inspectedAgain = await tool.execute({ action: "inspect", name: "parse_table" }, ctx)
        expect(inspectedAgain.output).toContain('return "v2"')

        // @ts-ignore
        const deleted = await tool.execute({ action: "delete", name: "parse_table" }, ctx)
        expect(deleted.output).toContain("Deleted 1 helper file")

        // @ts-ignore
        const listedAfterDelete = await tool.execute({ action: "list" }, ctx)
        expect(listedAfterDelete.output).not.toContain("parse_table")
      },
    })
  })

  test(
    "registry exposes workbench and synthesize alias",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).toContain("workbench")
          expect(ids).toContain("synthesize")
          expect(ids).toContain("synthesize_tool")
        },
      })
    },
    15_000,
  )

  test("create writes helper into the ephemeral tools directory", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WorkbenchTool.init()
        const ctx = makeCtx("session-workbench-path")

        const created = await tool.execute(
          {
            action: "create",
            name: "csv_helper",
            code: `export default { description: "CSV helper", args: {}, async execute() { return "ok"; } }`,
          },
          // @ts-ignore
          ctx,
        )

        expect(created.metadata.filePath).toBeDefined()
        const filePath = created.metadata.filePath!
        expect(filePath.startsWith(path.join(tmp.path, ".opencode", "tools"))).toBe(true)
        const content = await fs.readFile(filePath, "utf8")
        expect(content).toContain("CSV helper")
      },
    })
  })
})
