import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session create route", () => {
  test("creates a session when the request body is empty", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await Server.App().request(`/session?directory=${encodeURIComponent(tmp.path)}`, {
      method: "POST",
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.id).toBeDefined()
    expect(body.directory).toBe(tmp.path)
  })
})
