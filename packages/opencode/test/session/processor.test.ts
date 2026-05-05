import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { LLM } from "../../src/session/llm"
import { SessionSteerInterrupt } from "../../src/session/interrupt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const PROVIDERS = {
  "alibaba-coding-plan": {
    models: {
      "glm-5": {
        name: "GLM 5",
        tool_call: true,
        reasoning: true,
        limit: { context: 202_752, output: 16_384 },
      },
    },
  },
} as const

function pendingStream() {
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return new Promise<never>(() => {})
        },
      }
    },
  }
}

afterEach(() => {
  // @ts-ignore
  SessionProcessor.setFirstEventTimeoutForTest(undefined)
  mock.restore()
})

describe("session.processor first-event guardrails", () => {
  test(
    "marks a pre-first-event timeout as an explicit error",
    async () => {
      await using tmp = await tmpdir({
        git: true,
        config: {
          provider: PROVIDERS,
          agent: {
            build: {
              model: "alibaba-coding-plan/glm-5",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const user = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })
          if (user.info.role !== "user") throw new Error("expected user message")

          // @ts-ignore
          const model = await Provider.getModel("alibaba-coding-plan", "glm-5")
          const agent = await Agent.get("build")
          // @ts-ignore
          const assistant = Session.updateMessage({
            // @ts-ignore
            id: Identifier.ascending("message"),
            parentID: user.info.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            path: {
              cwd: Instance.directory,
              root: Instance.worktree,
            },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: model.id,
            providerID: model.providerID,
            time: {
              created: Date.now(),
            },
            sessionID: session.id,
          }) as MessageV2.Assistant

          // @ts-ignore
          SessionProcessor.setFirstEventTimeoutForTest(20)
          spyOn(LLM, "stream").mockResolvedValue({
            fullStream: pendingStream(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>)

          // @ts-ignore
          const processor = SessionProcessor.create({
            assistantMessage: assistant,
            sessionID: session.id,
            model,
            abort: new AbortController().signal,
          })

          const result = await processor.process({
            user: user.info,
            sessionID: session.id,
            turnID: user.info.id,
            model,
            agent,
            system: [],
            abort: new AbortController().signal,
            messages: [],
            tools: {},
          })

          expect(result).toBe("stop")

          const stored = await MessageV2.get({
            sessionID: session.id,
            messageID: assistant.id,
          })
          if (stored.info.role !== "assistant") throw new Error("expected assistant message")

          expect(stored.parts).toHaveLength(0)
          expect(stored.info.finish).toBe("error")
          expect(stored.info.time.completed).toBeNumber()
          expect(stored.info.error?.name).toBe("UnknownError")
          expect(stored.info.error?.data?.message).toContain("did not produce an initial event")
        },
      })
    },
    20_000,
  )

  test(
    "records an explicit aborted error when steered before first event",
    async () => {
      await using tmp = await tmpdir({
        git: true,
        config: {
          provider: PROVIDERS,
          agent: {
            build: {
              model: "alibaba-coding-plan/glm-5",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const user = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })
          if (user.info.role !== "user") throw new Error("expected user message")

          // @ts-ignore
          const model = await Provider.getModel("alibaba-coding-plan", "glm-5")
          const agent = await Agent.get("build")
          // @ts-ignore
          const assistant = Session.updateMessage({
            // @ts-ignore
            id: Identifier.ascending("message"),
            parentID: user.info.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            path: {
              cwd: Instance.directory,
              root: Instance.worktree,
            },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: model.id,
            providerID: model.providerID,
            time: {
              created: Date.now(),
            },
            sessionID: session.id,
          }) as MessageV2.Assistant

          // @ts-ignore
          SessionProcessor.setFirstEventTimeoutForTest(200)
          spyOn(LLM, "stream").mockResolvedValue({
            fullStream: pendingStream(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>)

          const abort = new AbortController()
          setTimeout(() => abort.abort(new SessionSteerInterrupt(session.id)), 20)

          // @ts-ignore
          const processor = SessionProcessor.create({
            assistantMessage: assistant,
            sessionID: session.id,
            model,
            abort: abort.signal,
          })

          const result = await processor.process({
            user: user.info,
            sessionID: session.id,
            turnID: user.info.id,
            model,
            agent,
            system: [],
            abort: abort.signal,
            messages: [],
            tools: {},
          })

          expect(result).toBe("continue")

          const stored = await MessageV2.get({
            sessionID: session.id,
            messageID: assistant.id,
          })
          if (stored.info.role !== "assistant") throw new Error("expected assistant message")

          expect(stored.parts).toHaveLength(0)
          expect(stored.info.finish).toBe("error")
          expect(stored.info.time.completed).toBeNumber()
          expect(stored.info.error?.name).toBe("MessageAbortedError")
          expect(stored.info.error?.data?.message).toContain("before the model emitted its first stream event")
        },
      })
    },
    20_000,
  )
})
