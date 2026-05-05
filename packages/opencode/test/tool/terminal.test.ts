import { describe, expect, test } from "bun:test"
import type { PermissionNext } from "../../src/permission/next"
import type { Tool } from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { TerminalTool } from "../../src/tool/terminal"
import { tmpdir } from "../fixture/fixture"
import { Shell } from "../../src/shell/shell"

const baseCtx: Tool.Context = {
  sessionID: "test_terminal" as any,
  // @ts-ignore
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.terminal", () => {
  // @ts-ignore
  test("starts the preferred shell when command is omitted", { timeout: 15000 }, async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TerminalTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const ctx: Tool.Context = {
          ...baseCtx,
          ask: async (req) => {
            requests.push(req)
          },
        }

        const start = await tool.execute(
          {
            action: "start",
            title: "preferred shell",
          },
          ctx,
        )

        const terminalID = (start.metadata as any).terminal_id as string
        expect(terminalID).toMatch(/^pty_/)
        expect(start.output).toContain("Managed terminal started.")
        expect(start.output).toContain(`command: ${Shell.preferred()}`)
        expect(requests.some((req) => req.permission === "terminal")).toBe(true)

        try {
          await Bun.sleep(300)
          const status = await tool.execute(
            {
              action: "status",
              terminal_id: terminalID,
            },
            ctx,
          )

          expect(status.output).toContain(`command: ${Shell.preferred()}`)
        } finally {
          await tool.execute(
            {
              action: "stop",
              terminal_id: terminalID,
            },
            ctx,
          )
        }
      },
    })
  })

  // @ts-ignore
  test("starts, reads, writes to, and stops a managed terminal", { timeout: 15000 }, async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TerminalTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const ctx: Tool.Context = {
          ...baseCtx,
          ask: async (req) => {
            requests.push(req)
          },
        }

        const start = await tool.execute(
          {
            action: "start",
            command: process.execPath,
            args: [
              "-e",
              "console.log('ready'); process.stdin.resume(); setTimeout(() => {}, 10000)",
            ],
            title: "managed echo",
          },
          ctx,
        )

        expect(start.output).toContain("Managed terminal started.")
        expect((start.metadata as any).terminal_id).toMatch(/^pty_/)
        expect(requests.some((req) => req.permission === "terminal")).toBe(true)

        const terminalID = (start.metadata as any).terminal_id as string

        try {
          await Bun.sleep(300)

          const firstRead = await tool.execute(
            {
              // @ts-ignore
              action: "read",
              terminal_id: terminalID,
            },
            ctx,
          )

          expect(firstRead.output).toContain("ready")
          const cursor = (firstRead.metadata as any).cursor as number
          expect(typeof cursor).toBe("number")

          await tool.execute(
            {
              action: "write",
              terminal_id: terminalID,
              input: "ping\n",
            },
            ctx,
          )

          await Bun.sleep(300)

          const secondRead = await tool.execute(
            {
              // @ts-ignore
              action: "read",
              terminal_id: terminalID,
              cursor,
            },
            ctx,
          )

          expect(secondRead.output).toContain("ping")
        } finally {
          const stop = await tool.execute(
            {
              action: "stop",
              terminal_id: terminalID,
            },
            ctx,
          )

          expect(stop.output).toContain("Stopped managed terminal")
        }
      },
    })
  })
})
