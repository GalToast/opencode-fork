import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import { tmpdir } from "../fixture/fixture"

describe("pty lifecycle", () => {
  // @ts-ignore
  test("keeps exited sessions inspectable until explicitly removed", { timeout: 15000 }, async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const info = await Pty.create({
          command: process.execPath,
          args: ["-e", "console.log('done')"],
          title: "short-lived",
        })

        // @ts-ignore
        let snapshot = Pty.snapshot(info.id)
        for (let attempt = 0; attempt < 50 && snapshot?.info.status !== "exited"; attempt++) {
          await Bun.sleep(100)
          // @ts-ignore
          snapshot = Pty.snapshot(info.id)
        }
        expect(snapshot).toBeDefined()
        expect(snapshot?.info.status).toBe("exited")
        expect(snapshot?.info.exitCode).toBe(0)
        expect(snapshot?.output).toContain("done")

        Pty.remove(info.id)
        expect(Pty.get(info.id)).toBeUndefined()
      },
    })
  })
})
