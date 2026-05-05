import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { TodoReadTool, TodoWriteTool } from "../../src/tool/todo"
import { resetDatabase } from "../fixture/db"

async function createToolContext(input: {
  tmpPath: string
  callID: string
  parentID?: string
  ask?: (value: any) => Promise<void>
}) {
  // @ts-ignore
  const session = await Session.create(input.parentID ? { parentID: input.parentID } : {})
  return {
    session,
    ctx: {
      sessionID: session.id,
      messageID: Identifier.ascending("message"),
      callID: input.callID,
      agent: "build",
      abort: AbortSignal.any([]),
      extra: {},
      messages: [],
      metadata: () => {},
      ask: input.ask ?? (async () => {}),
      path: {
        cwd: input.tmpPath,
        root: input.tmpPath,
      },
    },
  }
}

describe("todo tools", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("todoread returns an empty list for a fresh session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asks: any[] = []
        const { ctx } = await createToolContext({
          tmpPath: tmp.path,
          callID: "todo-read-empty",
          ask: async (value) => {
            asks.push(value)
          },
        })

        // @ts-ignore
        // @ts-ignore
        const result = await TodoReadTool.init().then((tool) => tool.execute({}, ctx))

        expect(result.title).toBe("0 todos")
        expect(result.output).toBe("[]")
        expect(result.metadata.todos).toEqual([])
        expect(asks).toEqual([
          {
            permission: "todoread",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          },
        ])
      },
    })
  })

  test("todowrite persists todos and todoread returns them in order", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asks: any[] = []
        const { ctx } = await createToolContext({
          tmpPath: tmp.path,
          callID: "todo-roundtrip",
          ask: async (value) => {
            asks.push(value)
          },
        })
        const todos = [
          { content: "Inspect task runtime", status: "in_progress", priority: "high" },
          { content: "Add todo tests", status: "pending", priority: "medium" },
        ]

        // @ts-ignore
        // @ts-ignore
        const writeResult = await TodoWriteTool.init().then((tool) =>
          tool.execute(
            {
              todos,
            },
            ctx,
          ),
        )
        // @ts-ignore
        // @ts-ignore
        const readResult = await TodoReadTool.init().then((tool) => tool.execute({}, ctx))

        expect(writeResult.title).toBe("2 todos")
        expect(writeResult.metadata.todos).toEqual(todos)
        expect(readResult.metadata.todos).toEqual(todos)
        expect(JSON.parse(readResult.output)).toEqual(todos)
        expect(asks).toEqual([
          {
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          },
          {
            permission: "todoread",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          },
        ])
      },
    })
  })

  test("todowrite scopes todos to the root session across child sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session: root, ctx: rootCtx } = await createToolContext({
          tmpPath: tmp.path,
          callID: "todo-root",
        })
        const { ctx: childCtx } = await createToolContext({
          tmpPath: tmp.path,
          callID: "todo-child",
          parentID: root.id,
        })
        const todos = [
          { content: "Shared root todo", status: "pending", priority: "medium" },
        ]

        // @ts-ignore
        // @ts-ignore
        await TodoWriteTool.init().then((tool) =>
          tool.execute(
            {
              todos,
            },
            childCtx,
          ),
        )

        // @ts-ignore
        // @ts-ignore
        const rootRead = await TodoReadTool.init().then((tool) => tool.execute({}, rootCtx))
        // @ts-ignore
        // @ts-ignore
        const childRead = await TodoReadTool.init().then((tool) => tool.execute({}, childCtx))

        expect(rootRead.metadata.todos).toEqual(todos)
        expect(childRead.metadata.todos).toEqual(todos)
      },
    })
  })

  test("todowrite with an empty list clears previously stored todos", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await createToolContext({
          tmpPath: tmp.path,
          callID: "todo-clear",
        })

        // @ts-ignore
        // @ts-ignore
        await TodoWriteTool.init().then((tool) =>
          tool.execute(
            {
              todos: [{ content: "Temporary item", status: "pending", priority: "low" }],
            },
            ctx,
          ),
        )
        // @ts-ignore
        // @ts-ignore
        await TodoWriteTool.init().then((tool) =>
          tool.execute(
            {
              todos: [],
            },
            ctx,
          ),
        )

        // @ts-ignore
        // @ts-ignore
        const readResult = await TodoReadTool.init().then((tool) => tool.execute({}, ctx))

        expect(readResult.title).toBe("0 todos")
        expect(readResult.metadata.todos).toEqual([])
      },
    })
  })
})
