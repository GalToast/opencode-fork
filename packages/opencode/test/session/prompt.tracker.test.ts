import { describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPlanState } from "../../src/session/plan-state"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionProcessor } from "../../src/session/processor"
import { CapabilityRuntime } from "../../src/capability/runtime"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function flattenContent(messages: any[]) {
  return messages
    .map((message) => {
      if (typeof message.content === "string") return message.content
      if (!Array.isArray(message.content)) return JSON.stringify(message.content)
      return message.content
        .map((part: any) => {
          if (typeof part === "string") return part
          if (part?.type === "text") return part.text
          return JSON.stringify(part)
        })
        .join("\n")
    })
    .join("\n\n")
}

function mockProcessor(captured: { value: string }) {
  // @ts-ignore
  // @ts-ignore
  // @ts-ignore
  return spyOn(SessionProcessor, "create").mockImplementation(({ assistantMessage }) => {
    return {
      message: assistantMessage,
      partFromToolCall() {
        return undefined
      },
      async process(input: any) {
        captured.value = flattenContent(input.messages)
        assistantMessage.finish = "stop"
        assistantMessage.time.completed = Date.now()
        await Session.updateMessage(assistantMessage)
        return "stop" as const
      },
    } as any
  })
}

describe("session.prompt tracker protocol", () => {
  test(
    "injects tracker reminder for build mode when tracker tools are enabled",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const captured = { value: "" }
          const processorSpy = mockProcessor(captured)
          CapabilityRuntime.enable(session.id, ["tracker_create_task"], { scope: "session" })

          try {
            await SessionPrompt.prompt({
              sessionID: session.id,
              agent: "build",
              parts: [{ type: "text", text: "Implement a complex feature with dependencies" }],
            })
          } finally {
            processorSpy.mockRestore()
          }

          expect(captured.value).toContain("Tracker Protocol")
          expect(captured.value).toContain(".tracker/tasks/")
          expect(captured.value).toContain("tracker_create_task")
          expect(captured.value).toContain("tracker_update_task")
          expect(captured.value).toContain("tracker_add_dependency")
          expect(captured.value).toContain("tracker_visualize")
          expect(captured.value).toContain("TodoWrite")
          expect(captured.value).toContain("do not treat it as the tracker itself")

          await Session.remove(session.id)
        },
      })
    },
    20_000,
  )

  test(
    "includes tracker guidance in plan mode reminder when entering plan mode",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const captured = { value: "" }
          const processorSpy = mockProcessor(captured)

          try {
            await SessionPrompt.prompt({
              sessionID: session.id,
              agent: "plan",
              parts: [{ type: "text", text: "Plan a complex refactoring" }],
            })
          } finally {
            processorSpy.mockRestore()
          }

          expect(captured.value).toContain("Tracker for Complex Planning")
          expect(captured.value).toContain("tracker_create_task")
          expect(captured.value).toContain("tracker_update_task")
          expect(captured.value).toContain("tracker_add_dependency")
          expect(captured.value).toContain(".tracker/tasks/")
          expect(captured.value).toContain("tracker_visualize")
          expect(captured.value).toContain("temporary scratch")

          await Session.remove(session.id)
        },
      })
    },
    20_000,
  )

  test(
    "injects approved plan reminder for build mode when a plan is approved",
    async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          await SessionPlanState.set(session.id, {
            mode: "approved",
            pendingPlanPath: ".opencode/plans/example.md",
            approvedPlanPath: ".opencode/plans/example.md",
          })

          const captured = { value: "" }
          const processorSpy = mockProcessor(captured)

          try {
            await SessionPrompt.prompt({
              sessionID: session.id,
              agent: "build",
              parts: [{ type: "text", text: "Implement from the approved plan" }],
            })
          } finally {
            processorSpy.mockRestore()
          }

          expect(captured.value).toContain("An approved plan is active")
          expect(captured.value).toContain(".opencode/plans/example.md")

          await Session.remove(session.id)
        },
      })
    },
    20_000,
  )
})
