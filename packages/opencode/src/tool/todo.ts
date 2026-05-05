import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION_READ from "./todoread.txt"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

const readParameters = z.object({})

const writeParameters = z.object({
  todos: z.array(z.object(Todo.Info.shape)).describe("The updated todo list"),
})

type ReadMetadata = {
  todos: Todo.Info[]
}

type WriteMetadata = {
  todos: Todo.Info[]
}

export const TodoReadTool = Tool.defineEffect<typeof readParameters, ReadMetadata, Todo.Service>(
  "todoread",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_READ,
      parameters: readParameters,
      async execute(_params: z.infer<typeof readParameters>, ctx: Tool.Context<ReadMetadata>) {
        await ctx.ask({
          permission: "todoread",
          patterns: ["*"],
          always: ["*"],
          metadata: {},
        })

        const todos = await Todo.get(ctx.sessionID)

        return {
          title: `${todos.length} todos`,
          output: JSON.stringify(todos, null, 2),
          metadata: {
            todos,
          },
        }
      },
    } satisfies Tool.Def<typeof readParameters, ReadMetadata>
  }),
)

export const TodoWriteTool = Tool.defineEffect<typeof writeParameters, WriteMetadata, Todo.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters: writeParameters,
      async execute(params: z.infer<typeof writeParameters>, ctx: Tool.Context<WriteMetadata>) {
        await ctx.ask({
          permission: "todowrite",
          patterns: ["*"],
          always: ["*"],
          metadata: {},
        })

        await todo
          .update({
            sessionID: ctx.sessionID,
            todos: params.todos,
          })
          .pipe(Effect.runPromise)

        return {
          title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
          output: JSON.stringify(params.todos, null, 2),
          metadata: {
            todos: params.todos,
          },
        }
      },
    } satisfies Tool.Def<typeof writeParameters, WriteMetadata>
  }),
)
