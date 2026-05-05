import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { MessageV2 } from "../../src/session/message-v2"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function userMessage(sessionID: string, id: string): MessageV2.User {
  // @ts-ignore
  return {
    id,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "test" as any, modelID: "test" as any },
    tools: {},
    mode: "",
  } as MessageV2.User
}

describe("session.message route", () => {
  test("returns 404 when the message belongs to a different session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const owner = await Session.create({ title: "owner" })
        const other = await Session.create({ title: "other" })
        const messageID = Identifier.ascending("message")

        await Session.updateMessage(userMessage(owner.id, messageID))
        await Session.updatePart({
          // @ts-ignore
          id: Identifier.ascending("part"),
          sessionID: owner.id,
          // @ts-ignore
          messageID,
          type: "text",
          text: "owned by the first session",
        })

        const success = await Server.App().request(`/session/${owner.id}/message/${messageID}`)
        expect(success.status).toBe(200)

        const denied = await Server.App().request(`/session/${other.id}/message/${messageID}`)
        expect(denied.status).toBe(404)
      },
    })
  })
})
