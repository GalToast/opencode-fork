import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import {
  BlackboardAppendTool,
  BlackboardClearTool,
  BlackboardCompareAndSwapTool,
  BlackboardDeleteTool,
  BlackboardGetTool,
  BlackboardIncrementTool,
  BlackboardSetTool,
} from "./blackboard"
import { ReadTool } from "./read"
import { RecallTool } from "./recall"
import { RetrievalStatusTool } from "./retrieval_status"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import { MultiEditTool } from "./multiedit"
import { ListTool } from "./ls"
import { SearchReplaceTool } from "./search_replace"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { SynthesizeTool } from "./synthesize"
import {
  TrackerAddArtifactTool,
  TrackerAddDependencyTool,
  TrackerCreateTaskTool,
  TrackerDagUnblockTool,
  TrackerDeleteTaskTool,
  TrackerGetTaskTool,
  TrackerListTasksTool,
  TrackerUpdateTaskTool,
  TrackerVisualizeTool,
} from "./tracker"
import { WorkbenchTool } from "./workbench"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "../util/glob"
import { pathToFileURL } from "url"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Env } from "../env"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "../filesystem"
import { Instance } from "../project/instance"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  type State = {
    custom: Tool.Info[]
  }

  export interface Interface {
    readonly ids: () => Effect.Effect<string[]>
    readonly named: {
      task: Tool.Info
      read: Tool.Info
    }
    readonly tools: (
      model: { providerID: ProviderID; modelID: ModelID },
      agent?: Agent.Info,
    ) => Effect.Effect<(Tool.Def & { id: string })[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/ToolRegistry") {}

  export const layer: Layer.Layer<
    Service,
    never,
    | Config.Service
    | Plugin.Service
    | Question.Service
    | Todo.Service
    | LSP.Service
    | typeof FileTime.Service
    | Instruction.Service
    | AppFileSystem.Service
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const plugin = yield* Plugin.Service

      const build = <T extends Tool.Info>(tool: T | Effect.Effect<T, never, any>) =>
        Effect.isEffect(tool) ? tool : Effect.succeed(tool)

      function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
        return {
          id,
          init: async (initCtx) => ({
            parameters: z.object(def.args),
            description: def.description,
            execute: async (args, toolCtx) => {
              const pluginCtx = {
                ...toolCtx,
                directory: Instance.directory,
                worktree: Instance.worktree,
              } as unknown as PluginToolContext
              const result = await def.execute(args as any, pluginCtx)
              const out = await Truncate.output(result, {}, initCtx?.agent)
              return {
                title: "",
                output: out.truncated ? out.content : result,
                metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
              }
            },
          }),
        }
      }

      function fromFile(id: string, file: string): Tool.Info {
        return {
          id,
          init: async (initCtx) => {
            const mod = await import(process.platform === "win32" ? file : pathToFileURL(file).href)
            const def = mod.default as ToolDefinition | undefined
            if (!def) throw new Error(`Custom tool ${file} does not export a default tool definition`)
            return fromPlugin(id, def).init(initCtx)
          },
        }
      }

      const state = yield* InstanceState.make<State>(
        Effect.fn("ToolRegistry.state")(function* () {
          const custom: Tool.Info[] = []

          const dirs = yield* config.directories()
          const matches = dirs.flatMap((dir) =>
            Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
          )
          for (const match of matches) {
            const namespace = path.basename(match, path.extname(match))
            const mod = yield* Effect.tryPromise({
              try: () => import(process.platform === "win32" ? match : pathToFileURL(match).href),
              catch: (err) => err,
            }).pipe(
              Effect.catch(() => {
                custom.push(fromFile(namespace, match))
                return Effect.succeed(undefined)
              }),
            )
            if (!mod) continue
            for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
              custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
            }
          }

          return { custom }
        }),
      )

      const invalid = yield* build(InvalidTool)
      const ask = yield* build(QuestionTool)
      const bash = yield* build(BashTool)
      const read = yield* build(ReadTool)
      const glob = yield* build(GlobTool)
      const grep = yield* build(GrepTool)
      const edit = yield* build(EditTool)
      const write = yield* build(WriteTool)
      const task = yield* build(TaskTool)
      const fetch = yield* build(WebFetchTool)
      const todo = yield* build(TodoWriteTool)
      const search = yield* build(WebSearchTool)
      const code = yield* build(CodeSearchTool)
      const skill = yield* build(SkillTool)
      const patch = yield* build(ApplyPatchTool)
      const lsp = yield* build(LspTool)
      const batch = yield* build(BatchTool)
      const plan = yield* build(PlanExitTool)
      const recall = yield* build(RecallTool)
      const status = yield* build(RetrievalStatusTool)
      const synthesize = yield* build(SynthesizeTool)
      const synthesizeAlias = { ...synthesize, id: "synthesize" }
      const workbench = yield* build(WorkbenchTool)
      const blackboardSet = yield* build(BlackboardSetTool)
      const blackboardGet = yield* build(BlackboardGetTool)
      const blackboardAppend = yield* build(BlackboardAppendTool)
      const blackboardIncrement = yield* build(BlackboardIncrementTool)
      const blackboardCompareAndSwap = yield* build(BlackboardCompareAndSwapTool)
      const blackboardDelete = yield* build(BlackboardDeleteTool)
      const blackboardClear = yield* build(BlackboardClearTool)
      const trackerCreate = yield* build(TrackerCreateTaskTool)
      const trackerUpdate = yield* build(TrackerUpdateTaskTool)
      const trackerArtifact = yield* build(TrackerAddArtifactTool)
      const trackerGet = yield* build(TrackerGetTaskTool)
      const trackerList = yield* build(TrackerListTasksTool)
      const trackerDependency = yield* build(TrackerAddDependencyTool)
      const trackerVisualize = yield* build(TrackerVisualizeTool)
      const trackerDelete = yield* build(TrackerDeleteTaskTool)
      const trackerUnblock = yield* build(TrackerDagUnblockTool)
      const todoread = yield* build(TodoReadTool)
      const multiedit = yield* build(MultiEditTool)
      const listTool = yield* build(ListTool)
      const search_replace = yield* build(SearchReplaceTool)

      const all = Effect.fn("ToolRegistry.all")(function* (custom: Tool.Info[], opts?: { plugins?: boolean }) {
        const cfg = yield* config.get()
        const question = ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) || Flag.OPENCODE_ENABLE_QUESTION_TOOL
        const plugins = opts?.plugins
          ? yield* plugin.list().pipe(
              Effect.map((list) =>
                list.flatMap((p) => Object.entries(p.tool ?? {}).map(([id, def]) => fromPlugin(id, def))),
              ),
              Effect.catch(() => Effect.succeed([] as Tool.Info[])),
            )
          : []

        return [
          invalid,
          ...(question ? [ask] : []),
          bash,
          read,
          glob,
          grep,
          edit,
          write,
          task,
          fetch,
          todo,
          todoread,
          search,
          code,
          skill,
          recall,
          status,
          blackboardSet,
          blackboardGet,
          blackboardAppend,
          blackboardIncrement,
          blackboardCompareAndSwap,
          blackboardDelete,
          blackboardClear,
          trackerCreate,
          trackerUpdate,
          trackerArtifact,
          trackerGet,
          trackerList,
          trackerDependency,
          trackerVisualize,
          trackerDelete,
          trackerUnblock,
          patch,
          multiedit,
          listTool,
          search_replace,
          synthesizeAlias,
          synthesize,
          workbench,
          ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [lsp] : []),
          ...(cfg.experimental?.batch_tool === true ? [batch] : []),
          ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [plan] : []),
          ...plugins,
          ...custom,
        ]
      })

      const ids = Effect.fn("ToolRegistry.ids")(function* () {
        const s = yield* InstanceState.get(state)
        const tools = yield* all(s.custom)
        return tools.map((t) => t.id)
      })

      const tools = Effect.fn("ToolRegistry.tools")(function* (
        model: { providerID: ProviderID; modelID: ModelID },
        agent?: Agent.Info,
      ) {
        const s = yield* InstanceState.get(state)
        const allTools = yield* all(s.custom, { plugins: true })
        const filtered = allTools.filter((tool) => {
          if (tool.id === "codesearch" || tool.id === "websearch") {
            return model.providerID === ProviderID.opencode || Flag.OPENCODE_ENABLE_EXA
          }

          const usePatch =
            !!Env.get("OPENCODE_E2E_LLM_URL") ||
            (model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4"))
          if (tool.id === "apply_patch") return usePatch
          if (tool.id === "edit" || tool.id === "write") return !usePatch

          return true
        })
        return yield* Effect.forEach(
          filtered,
          Effect.fnUntraced(function* (tool: Tool.Info) {
            using _ = log.time(tool.id)
            const next = yield* Effect.promise(() => tool.init({ agent }))
            const output = {
              description: next.description,
              parameters: next.parameters,
            }
            yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
            return {
              id: tool.id,
              description: output.description,
              parameters: output.parameters,
              execute: next.execute,
              formatValidationError: next.formatValidationError,
            }
          }),
          { concurrency: "unbounded" },
        )
      })

      return Service.of({ ids, named: { task, read }, tools })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(
        Layer.provide(Config.defaultLayer),
        Layer.provide(Plugin.defaultLayer),
        Layer.provide(Question.defaultLayer),
        Layer.provide(Todo.defaultLayer),
        Layer.provide(LSP.defaultLayer),
        Layer.provide(FileTime.defaultLayer),
        Layer.provide(Instruction.defaultLayer),
        Layer.provide(AppFileSystem.defaultLayer),
      ),
    ),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function ids() {
    return runPromise((svc) => svc.ids())
  }

  export async function tools(
    model: {
      providerID: ProviderID
      modelID: ModelID
    },
    agent?: Agent.Info,
  ): Promise<(Tool.Def & { id: string })[]> {
    return runPromise((svc) => svc.tools(model, agent))
  }

  export async function catalog() {
    const allTools = await tools({ providerID: "" as ProviderID, modelID: "" as ModelID })
    return allTools.map((tool) => ({
      id: tool.id,
      kind: "tool" as const,
      source: "tool",
      title: tool.id,
      description: tool.description,
      hints: [],
    }))
  }
}
