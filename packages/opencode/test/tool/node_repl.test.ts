import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { NodeReplTool, resetNodeReplSessionsForTest } from "../../src/tool/node_repl"
import { tmpdir } from "../fixture/fixture"

const baseCtx = {
  messageID: "msg-node-repl-test" as any,
  callID: "call-node-repl-test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  async ask() {},
}

const makeCtx = (sessionID: string) => ({
  ...baseCtx,
  sessionID,
})

describe("tool.node_repl", () => {
  test(
    "persists bindings across calls and supports top-level await",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          try {
            const tool = await NodeReplTool.init()
            const ctx = makeCtx("session-node-repl-persist")

            const first = await tool.execute(
              {
                code: "const shared = 41; shared",
                timeout_ms: 5_000,
              },
              // @ts-ignore
              ctx,
            )

            expect(first.title).toBe("Node REPL")
            expect(first.metadata.ok).toBe(true)
            expect(first.metadata.reset).toBe(false)
            expect(first.metadata.timeout).toBe(false)
            expect(first.output).toContain("41")

            const second = await tool.execute(
              {
                code: "await Promise.resolve(shared + 1)",
                timeout_ms: 5_000,
              },
              // @ts-ignore
              ctx,
            )

            expect(second.title).toBe("Node REPL")
            expect(second.metadata.ok).toBe(true)
            expect(second.metadata.reset).toBe(false)
            expect(second.metadata.timeout).toBe(false)
            expect(second.output).toContain("42")
          } finally {
            resetNodeReplSessionsForTest()
          }
        },
      })
    },
    20_000,
  )

  test(
    "returns the last top-level expression for multi-statement await snippets",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          try {
            const tool = await NodeReplTool.init()
            const ctx = makeCtx("session-node-repl-multistatement-await")

            const result = await tool.execute(
              {
                code: ["const shared = await Promise.resolve(41)", "shared + 1"].join("\n"),
                timeout_ms: 5_000,
              },
              // @ts-ignore
              ctx,
            )

            expect(result.title).toBe("Node REPL")
            expect(result.metadata.ok).toBe(true)
            expect(result.metadata.timeout).toBe(false)
            expect(result.output).toContain("42")
          } finally {
            resetNodeReplSessionsForTest()
          }
        },
      })
    },
    20_000,
  )

  test(
    "does not treat nested async await as top-level await",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          try {
            const tool = await NodeReplTool.init()
            const ctx = makeCtx("session-node-repl-nested-await")

            const first = await tool.execute(
              {
                code: [
                  "const helper = async () => await Promise.resolve(1)",
                  "const nested = 41",
                  "nested + 1",
                ].join("\n"),
                timeout_ms: 5_000,
              },
              // @ts-ignore
              ctx,
            )

            expect(first.title).toBe("Node REPL")
            expect(first.metadata.ok).toBe(true)
            expect(first.output).toContain("42")

            const second = await tool.execute(
              {
                code: "nested",
                timeout_ms: 5_000,
              },
              // @ts-ignore
              ctx,
            )

            expect(second.title).toBe("Node REPL")
            expect(second.metadata.ok).toBe(true)
            expect(second.output).toContain("41")
          } finally {
            resetNodeReplSessionsForTest()
          }
        },
      })
    },
    20_000,
  )

  test("captures runtime errors as structured failures", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          const tool = await NodeReplTool.init()
          const result = await tool.execute(
            {
              code: "throw new Error('boom')",
              timeout_ms: 5_000,
            },
            // @ts-ignore
            makeCtx("session-node-repl-error"),
          )

          expect(result.title).toBe("Node REPL Error")
          expect(result.metadata.ok).toBe(false)
          expect(result.metadata.timeout).toBe(false)
          expect(result.output).toContain("Error: boom")
        } finally {
          resetNodeReplSessionsForTest()
        }
      },
    })
  })

  test(
    "times out long-running evaluations and restarts the worker",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          try {
            const tool = await NodeReplTool.init()
            const ctx = makeCtx("session-node-repl-timeout")

            const timedOut = await tool.execute(
              {
                code: "globalThis.marker = 7; await new Promise(() => {})",
                timeout_ms: 150,
              },
              // @ts-ignore
              ctx,
            )

            expect(timedOut.title).toBe("Node REPL Timeout")
            expect(timedOut.metadata.ok).toBe(false)
            expect(timedOut.metadata.timeout).toBe(true)
            expect(timedOut.output).toContain("timed out")

            const restarted = await tool.execute(
              {
                code: "globalThis.marker === undefined",
                timeout_ms: 5_000,
              },
              // @ts-ignore
              ctx,
            )

            expect(restarted.title).toBe("Node REPL")
            expect(restarted.metadata.ok).toBe(true)
            expect(restarted.metadata.timeout).toBe(false)
            expect(restarted.output).toContain("true")
          } finally {
            resetNodeReplSessionsForTest()
          }
        },
      })
    },
    10_000,
  )
})
