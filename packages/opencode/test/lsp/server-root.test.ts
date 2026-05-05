import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { LSPServer } from "../../src/lsp/server"

describe("lsp server roots", () => {
  test("pyright does not fall back to the whole instance without python project markers", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "src", "bot.py")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "print('hi')\n", "utf8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(LSPServer.Pyright.root(file)).resolves.toBeUndefined()
      },
    })
  })

  test("pyright resolves to the nearest python project marker when one exists", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "python-app")
    const file = path.join(root, "src", "bot.py")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(path.join(root, "pyproject.toml"), "[project]\nname='python-app'\n", "utf8")
    await fs.writeFile(file, "print('hi')\n", "utf8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(LSPServer.Pyright.root(file)).resolves.toBe(root)
      },
    })
  })
})
