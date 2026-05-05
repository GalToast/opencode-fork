import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { SessionForeground } from "../../src/session/foreground"

describe("session foreground baton", () => {
  test("tracks accepted, promoted, steering, and settled foreground state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SessionForeground.accept({
          sessionID: "session_child" as any,
          rootSessionID: "session_root",
          messageID: "message_user_1" as any,
          intent: "Keep the main chat responsive while swarm work continues.",
          responder: {
            agent: "glm5",
            providerID: "dashscope" as any,
            modelID: "glm-5" as any,
          },
          acceptedAt: 100,
        })

        expect(SessionForeground.get("session_root")).toMatchObject({
          rootSessionID: "session_root",
          latestSessionID: "session_child",
          latestMessageID: "message_user_1",
          latestUserIntent: "Keep the main chat responsive while swarm work continues.",
          latestResponder: {
            agent: "glm5",
            providerID: "dashscope" as any,
            modelID: "glm-5" as any,
          },
          state: "accepting",
          awaitingPromotion: true,
          acceptedAt: 100,
        })

        await SessionForeground.promote({
          sessionID: "session_child" as any,
          rootSessionID: "session_root",
          turnID: "turn_main",
          promotedAt: 125,
        })

        expect(SessionForeground.get("session_root")).toMatchObject({
          state: "responding",
          awaitingPromotion: false,
          activeSessionID: "session_child",
          activeTurnID: "turn_main",
          activeResponder: {
            agent: "glm5",
            providerID: "dashscope" as any,
            modelID: "glm-5" as any,
          },
          promotedAt: 125,
        })

        await SessionForeground.steer({
          sessionID: "session_child" as any,
          rootSessionID: "session_root",
          stage: "received",
          at: 150,
          pending: 1,
          messageID: "message_user_2" as any,
        })

        expect(SessionForeground.get("session_root")).toMatchObject({
          state: "steering",
          steer: {
            stage: "received",
            at: 150,
            pending: 1,
            messageID: "message_user_2" as any,
          },
        })

        await SessionForeground.steer({
          sessionID: "session_child" as any,
          rootSessionID: "session_root",
          stage: "applied",
          at: 175,
          pending: 0,
          messageID: "message_user_2" as any,
          latencyMS: 25,
        })

        expect(SessionForeground.get("session_root")).toMatchObject({
          state: "responding",
          steer: undefined,
        })

        await SessionForeground.settle({
          sessionID: "session_child" as any,
          rootSessionID: "session_root",
          turnID: "turn_main",
          completedAt: 200,
        })

        expect(SessionForeground.get("session_root")).toMatchObject({
          state: "idle",
          awaitingPromotion: false,
          activeSessionID: undefined,
          activeTurnID: undefined,
          completedAt: 200,
        })
      },
    })
  })
})
