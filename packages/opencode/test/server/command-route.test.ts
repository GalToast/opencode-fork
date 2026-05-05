import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Command } from "../../src/command"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("command route", () => {
  test("uses lightweight command listing for startup surfaces", async () => {
    const list = spyOn(Command, "list").mockResolvedValue([])

    try {
      const response = await Server.App().request("/command")
      expect(response.status).toBe(200)
      expect(list).toHaveBeenCalledTimes(1)
      // @ts-ignore
      // @ts-ignore
      expect(list.mock.calls[0]?.[0]).toEqual({ includeMcpPrompts: false })
    } finally {
      list.mockRestore()
    }
  }, 15000)
})
