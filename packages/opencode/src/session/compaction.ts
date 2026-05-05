import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { SessionID, MessageID, PartID } from "./schema"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { Agent } from "@/agent/agent"
import { Plugin, PluginService, defaultLayer as PluginDefaultLayer } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/db"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow } from "./overflow"
import { RetrievalService } from "@/retrieval"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000
  const PRUNE_PROTECTED_TOOLS = ["skill"]
  const SEMANTIC_BATON_LIMIT = 4
  const SEMANTIC_BATON_CHARS = 1_200

  function messageText(message: MessageV2.WithParts) {
    const parts = message.parts
      .map((part) => {
        if (part.type === "text") return part.text
        if (part.type === "tool" && part.state.status === "completed") return `${part.tool}: ${part.state.title ?? ""}\n${part.state.output}`
        if (part.type === "file") return `${part.filename ?? "file"} ${part.mime}`
        return ""
      })
      .filter(Boolean)
      .join("\n")

    return [message.info.role, parts].filter(Boolean).join(": ")
  }

  function semanticQuery(input: { messages: MessageV2.WithParts[]; overflow?: boolean }) {
    const material = input.messages
      .slice(-12)
      .map(messageText)
      .filter(Boolean)
      .join("\n\n")
      .replace(/\s+/g, " ")
      .trim()
      .slice(-4_000)

    return [
      "memory compaction preserve durable technical constraints active task file paths decisions failures custom tools harness restoration semantic embedding reranking",
      input.overflow ? "overflow compaction continuation" : "session compaction continuation",
      material,
    ]
      .filter(Boolean)
      .join("\n")
  }

  async function semanticCompactionBaton(input: {
    sessionID: SessionID
    messages: MessageV2.WithParts[]
    overflow?: boolean
  }): Promise<string[]> {
    try {
      const projectID = Instance.project.id
      await RetrievalService.indexSession({ projectID, sessionID: input.sessionID })
      const result = await RetrievalService.search({
        projectID,
        sessionID: input.sessionID,
        preferredSessionIDs: [input.sessionID],
        query: semanticQuery({ messages: input.messages, overflow: input.overflow }),
        policy: "local",
        limit: SEMANTIC_BATON_LIMIT,
        skipRuntimeConfigure: true,
        sourceTypes: [
          "session_message",
          "session_plan",
          "task_artifact",
          "tool_output",
          "tool_failure",
          "assistant_output",
          "note",
          "doc",
          "code_chunk",
        ],
        metadata: {
          trigger: "session_compaction",
          detail: "memory compaction preserve semantically central facts and technical anchors",
          runtime: "synthetic_compaction_fallback",
        },
      })

      return result.candidates.map((candidate) => {
        const content = candidate.content.replace(/\s+/g, " ").trim().slice(0, SEMANTIC_BATON_CHARS)
        return `- ${candidate.sourceType}${candidate.sessionID ? `:${candidate.sessionID}` : ""}: ${content}`
      })
    } catch (error) {
      log.warn("semantic compaction baton unavailable", { error })
      return []
    }
  }

  export interface Interface {
    readonly isOverflow: (input: {
      tokens: MessageV2.Assistant["tokens"]
      model: Provider.Model
    }) => Effect.Effect<boolean>
    readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
    readonly process: (input: {
      parentID: MessageID
      messages: MessageV2.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) => Effect.Effect<"continue" | "stop", unknown>
    readonly create: (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderID; modelID: ModelID }
      auto: boolean
      overflow?: boolean
    }) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/SessionCompaction") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Service
      const session = yield* Session.Service
      const agents = yield* Agent.Service
      const plugin = yield* PluginService
      const processors = yield* SessionProcessor.Service
      const provider = yield* Provider.Service

      const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
        tokens: MessageV2.Assistant["tokens"]
        model: Provider.Model
      }) {
        return overflow({ cfg: yield* config.get(), tokens: input.tokens, model: input.model })
      })

      // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
      // calls, then erases output of older tool calls to free context space
      const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
        const cfg = yield* config.get()
        if (cfg.compaction?.prune === false) return
        log.info("pruning")

        const msgs = yield* session
          .messages({ sessionID: input.sessionID })
          .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
        if (!msgs) return

        let total = 0
        let pruned = 0
        const toPrune: MessageV2.ToolPart[] = []
        let turns = 0

        loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
          const msg = msgs[msgIndex]
          if (msg.info.role === "user") turns++
          if (turns < 2) continue
          if (msg.info.role === "assistant" && msg.info.summary) break loop
          for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
            const part = msg.parts[partIndex]
            if (part.type === "tool")
              if (part.state.status === "completed") {
                if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
                if (part.state.time.compacted) break loop
                const estimate = Token.estimate(part.state.output)
                total += estimate
                if (total > PRUNE_PROTECT) {
                  pruned += estimate
                  toPrune.push(part)
                }
              }
          }
        }

        log.info("found", { pruned, total })
        if (pruned > PRUNE_MINIMUM) {
          for (const part of toPrune) {
            if (part.state.status === "completed") {
              part.state.time.compacted = Date.now()
              yield* session.updatePart(part)
            }
          }
          log.info("pruned", { count: toPrune.length })
        }
      })

      const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
        parentID: MessageID
        messages: MessageV2.WithParts[]
        sessionID: SessionID
        auto: boolean
        overflow?: boolean
      }) {
        const parent = input.messages.findLast((m) => m.info.id === input.parentID)
        if (!parent || parent.info.role !== "user") {
          throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
        }
        const userMessage = parent.info

        let messages = input.messages
        let replay:
          | {
              info: MessageV2.User
              parts: MessageV2.Part[]
            }
          | undefined
        if (input.overflow) {
          const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
          for (let i = idx - 1; i >= 0; i--) {
            const msg = input.messages[i]
            if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
              replay = { info: msg.info, parts: msg.parts }
              messages = input.messages.slice(0, i)
              break
            }
          }
          const hasContent =
            replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
          if (!hasContent) {
            replay = undefined
            messages = input.messages
          }
        }

        const agent = yield* agents.get("compaction")
        const model = agent.model
          ? yield* provider.getModel(agent.model.providerID, agent.model.modelID)
          : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
        // Allow plugins to inject context or replace compaction prompt.
        const compacting = (yield* Effect.promise(() =>
          plugin.trigger("experimental.session.compacting", { sessionID: input.sessionID }, { context: [], prompt: undefined }),
        )) as { context: string[]; prompt?: string }
        const defaultPrompt = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.
Do not call any tools. Respond only with the summary text.
Respond in the same language as the user's messages in the conversation.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`

        const semanticBaton = yield* Effect.promise(() =>
          semanticCompactionBaton({
            sessionID: input.sessionID,
            messages,
            overflow: input.overflow,
          }),
        ).pipe(Effect.catch(() => Effect.succeed([])))
        const semanticContext =
          semanticBaton.length > 0
            ? [
                "Semantic compaction baton:",
                "These retrieval-ranked facts were selected with the semantic embedding/reranking substrate. Preserve them when they are relevant to the continuation.",
                ...semanticBaton,
              ].join("\n")
            : undefined
        const prompt = compacting.prompt ?? [defaultPrompt, ...compacting.context, semanticContext].filter(Boolean).join("\n\n")
        const msgs = structuredClone(messages)
        yield* Effect.promise(() => plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs }))
        const modelMessages = yield* MessageV2.toModelMessagesEffect(msgs, model, { stripMedia: true })
        const ctx = yield* InstanceState.context
        const msg: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          parentID: input.parentID,
          sessionID: input.sessionID,
          mode: "compaction",
          agent: "compaction",
          variant: userMessage.variant,
          summary: true,
          path: {
            cwd: ctx.directory,
            root: ctx.worktree,
          },
          cost: 0,
          tokens: {
            output: 0,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
        }
        yield* session.updateMessage(msg)
        const processor = yield* processors.create({
          assistantMessage: msg,
          sessionID: input.sessionID,
          model,
        })
        const result = yield* processor
          .process({
            user: userMessage,
            agent,
            sessionID: input.sessionID,
            tools: {},
            system: [],
            messages: [
              ...modelMessages,
              {
                role: "user",
                content: [{ type: "text", text: prompt }],
              },
            ],
            model,
          })
          .pipe(Effect.onInterrupt(() => processor.abort()))

        if (result === "compact") {
          processor.message.error = new MessageV2.ContextOverflowError({
            message: replay
              ? "Conversation history too large to compact - exceeds model context limit"
              : "Session too large to compact - context exceeds model limit even after stripping media",
          }).toObject()
          processor.message.finish = "error"
          yield* session.updateMessage(processor.message)
          return "stop"
        }

        if (result === "continue" && input.auto) {
          if (replay) {
            const original = replay.info
            const replayMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: original.agent,
              model: original.model,
              format: original.format,
              tools: original.tools,
              system: original.system,
              variant: original.variant,
            })
            for (const part of replay.parts) {
              if (part.type === "compaction") continue
              const replayPart =
                part.type === "file" && MessageV2.isMedia(part.mime)
                  ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                  : part
              yield* session.updatePart({
                ...replayPart,
                id: PartID.ascending(),
                messageID: replayMsg.id,
                sessionID: input.sessionID,
              })
            }
          }

          if (!replay) {
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: userMessage.agent,
              model: userMessage.model,
            })
            const text =
              (input.overflow
                ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
                : "") +
              "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text,
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }

        if (processor.message.error) return "stop"
        if (result === "continue") yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
        return result
      })

      const create = Effect.fn("SessionCompaction.create")(function* (input: {
        sessionID: SessionID
        agent: string
        model: { providerID: ProviderID; modelID: ModelID }
        auto: boolean
        overflow?: boolean
      }) {
        const msg = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          model: input.model,
          sessionID: input.sessionID,
          agent: input.agent,
          time: { created: Date.now() },
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: msg.sessionID,
          type: "compaction",
          auto: input.auto,
          overflow: input.overflow,
        })
      })

      return Service.of({
        isOverflow,
        prune,
        process: processCompaction as Interface["process"],
        create,
      })
    }),
  )

  export const defaultLayer: Layer.Layer<Service, unknown> = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(
        Layer.provide(Provider.defaultLayer),
        Layer.provide(Session.defaultLayer),
        Layer.provide(SessionProcessor.defaultLayer),
        Layer.provide(Agent.defaultLayer),
        Layer.provide(PluginDefaultLayer),
        Layer.provide(Bus.layer),
        Layer.provide(Config.defaultLayer),
      ),
    ),
  ) as Layer.Layer<Service, unknown>

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    return runPromise((svc) => svc.isOverflow(input))
  }

  export async function prune(input: { sessionID: SessionID }) {
    return runPromise((svc) => svc.prune(input))
  }

  export const process = fn(
    z.object({
      parentID: MessageID.zod,
      messages: z.custom<MessageV2.WithParts[]>(),
      sessionID: SessionID.zod,
      auto: z.boolean(),
      overflow: z.boolean().optional(),
    }),
    (input) => runPromise((svc) => svc.process(input)),
  )

  export const create = fn(
    z.object({
      sessionID: SessionID.zod,
      agent: z.string(),
      model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }),
      auto: z.boolean(),
      overflow: z.boolean().optional(),
    }),
    (input) => runPromise((svc) => svc.create(input)),
  )
}
