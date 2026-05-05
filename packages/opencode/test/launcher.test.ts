import path from "path"
import { describe, expect, test } from "bun:test"
import { localSourceRoot, prepareLaunchContext, resolveLaunchTarget } from "../src/launcher"
import { Filesystem } from "../src/util/filesystem"
import { tmpdir } from "./fixture/fixture"

async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const original = new Map<string, string | undefined>()
  const originalCwd = process.cwd()
  for (const key of Object.keys(env)) {
    original.set(key, process.env[key])
    const value = env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  try {
    await fn()
  } finally {
    process.chdir(originalCwd)
    for (const [key, value] of original.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe("launcher", () => {
  test("localSourceRoot resolves to the repo root", async () => {
    expect(await Filesystem.exists(path.join(localSourceRoot(), "packages", "opencode", "src", "index.ts"))).toBe(true)
  })

  test("prepareLaunchContext tolerates empty input", () => {
    const originalCwd = process.cwd()
    const result = prepareLaunchContext()

    expect(result.localRoot).toBeTruthy()
    expect(process.cwd()).toBe(originalCwd)
  })

  test("prepares default launch as the TUI supervisor", async () => {
    await withEnv(
      {
        OPENCODE_RUNTIME_ROLE: undefined,
      },
      async () => {
        prepareLaunchContext({ cliArgs: [] })
        expect(process.env.OPENCODE_RUNTIME_ROLE).toBe("tui_supervisor")
      },
    )
  })

  test("resolveLaunchTarget stays on the local source root", async () => {
    const localRoot = path.join("C:\\", "stable-opencode")
    const result = await resolveLaunchTarget({
      localRoot,
      requestedRoot: path.join(localRoot, "missing-worker"),
    })

    expect(result).toEqual({
      sourceRoot: localRoot,
      entryPath: path.join(localRoot, "packages", "opencode", "src", "index.ts"),
      delegated: false,
    })
  })

  test("prepares launch context from an arbitrary cwd without extra legacy env", async () => {
    await using tmp = await tmpdir({ git: true })

    await withEnv(
      {
        OPENCODE_CALLER_CWD: tmp.path,
        OPENCODE_SUPERVISOR_ROOT: undefined,
      },
      async () => {
        const ctx = prepareLaunchContext({
          localRoot: path.join(tmp.path, "supervisor-root"),
        })
        expect(process.cwd()).toBe(tmp.path)
        expect("harnessRoot" in ctx).toBe(false)
        expect(process.env.OPENCODE_SUPERVISOR_ROOT).toBe(path.join(tmp.path, "supervisor-root"))
      },
    )
  })
})
