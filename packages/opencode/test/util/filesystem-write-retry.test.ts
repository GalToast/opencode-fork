import { afterEach, describe, expect, spyOn, test } from "bun:test"
import os from "os"
import path from "path"
import * as fsPromises from "fs/promises"
import { Filesystem } from "../../src/util/filesystem"

describe("filesystem write retry", () => {
  afterEach(() => {
    // @ts-ignore
    spyOn.restoreAll?.()
  })

  test("retries atomic rename when Windows-style file locks cause a transient EPERM", async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "oc-filesystem-retry-"))
    const file = path.join(dir, "package.json")
    const realRename = fsPromises.rename
    let renameFailures = 1

    // @ts-ignore
    spyOn(fsPromises, "rename").mockImplementation(async (from: string, to: string) => {
      if (renameFailures > 0) {
        renameFailures -= 1
        const error = Object.assign(new Error("transient rename failure"), { code: "EPERM" })
        throw error
      }
      return realRename(from, to)
    })
    await Filesystem.writeJson(file, { ok: true })

    expect(JSON.parse(await fsPromises.readFile(file, "utf-8"))).toEqual({ ok: true })
    await fsPromises.rm(dir, { recursive: true, force: true })
  })
})
