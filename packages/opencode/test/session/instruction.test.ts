import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instruction } from "../../src/session/instruction"
import type { MessageV2 } from "../../src/session/message-v2"
import { Instance } from "../../src/project/instance"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Global } from "../../src/global"
import { tmpdir } from "../fixture/fixture"

const InstructionPrompt = Instruction
const instructionTest = (name: string, fn: () => void | Promise<unknown>) => test(name, fn, 20_000)

function loaded(filepath: string): MessageV2.WithParts[] {
  const sessionID = SessionID.make("session-loaded-1")
  const messageID = MessageID.make("message-loaded-1")

  return [
    {
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 0 },
        agent: "build",
        model: {
          providerID: ProviderID.make("anthropic"),
          modelID: ModelID.make("claude-sonnet-4-20250514"),
        },
      },
      parts: [
        {
          id: PartID.make("part-loaded-1"),
          messageID,
          sessionID,
          type: "tool",
          callID: "call-loaded-1",
          tool: "read",
          state: {
            status: "completed",
            input: {},
            output: "done",
            title: "Read",
            metadata: { loaded: [filepath] },
            time: { start: 0, end: 1 },
          },
        },
      ],
    },
  ]
}

describe("Instruction.resolve", () => {
  instructionTest("returns empty when AGENTS.md is at project root (already in systemPaths)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Root Instructions")
        await Bun.write(path.join(dir, "src", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await Instruction.systemPaths()
        expect(system.has(path.join(tmp.path, "AGENTS.md"))).toBe(true)

        const results = await Instruction.resolve(
          [],
          path.join(tmp.path, "src", "file.ts"),
          MessageID.make("message-test-1"),
        )
        expect(results).toEqual([])
      },
    })
  })

  instructionTest("returns AGENTS.md from subdirectory (not in systemPaths)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await Instruction.systemPaths()
        expect(system.has(path.join(tmp.path, "subdir", "AGENTS.md"))).toBe(false)

        const results = await Instruction.resolve(
          [],
          path.join(tmp.path, "subdir", "nested", "file.ts"),
          MessageID.make("message-test-2"),
        )
        expect(results.length).toBe(1)
        expect(results[0].filepath).toBe(path.join(tmp.path, "subdir", "AGENTS.md"))
      },
    })
  })

  instructionTest("doesn't reload AGENTS.md when reading it directly", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filepath = path.join(tmp.path, "subdir", "AGENTS.md")
        const system = await Instruction.systemPaths()
        expect(system.has(filepath)).toBe(false)

        const results = await Instruction.resolve([], filepath, MessageID.make("message-test-3"))
        expect(results).toEqual([])
      },
    })
  })

  instructionTest("does not reattach the same nearby instructions twice for one message", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filepath = path.join(tmp.path, "subdir", "nested", "file.ts")
        const id = MessageID.make("message-claim-1")

        const first = await Instruction.resolve([], filepath, id)
        const second = await Instruction.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(first[0].filepath).toBe(path.join(tmp.path, "subdir", "AGENTS.md"))
        expect(second).toEqual([])
      },
    })
  })

  instructionTest("clear allows nearby instructions to be attached again for the same message", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filepath = path.join(tmp.path, "subdir", "nested", "file.ts")
        const id = MessageID.make("message-claim-2")

        const first = await Instruction.resolve([], filepath, id)
        await Instruction.clear(id)
        const second = await Instruction.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(second).toHaveLength(1)
        expect(second[0].filepath).toBe(path.join(tmp.path, "subdir", "AGENTS.md"))
      },
    })
  })

  instructionTest("skips instructions already reported by prior read metadata", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await Bun.write(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agents = path.join(tmp.path, "subdir", "AGENTS.md")
        const filepath = path.join(tmp.path, "subdir", "nested", "file.ts")
        const id = MessageID.make("message-claim-3")

        const results = await Instruction.resolve(loaded(agents), filepath, id)

        expect(results).toEqual([])
      },
    })
  })

  test.todo("fetches remote instructions from config URLs", () => {})
})

describe("Instruction.systemPaths OPENCODE_CONFIG_DIR", () => {
  function restoreConfigDir(originalConfigDir: string | undefined) {
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }
  }

  instructionTest("prefers OPENCODE_CONFIG_DIR AGENTS.md over global when both exist", async () => {
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    await using profileTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Profile Instructions")
      },
    })
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    process.env.OPENCODE_CONFIG_DIR = profileTmp.path
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await Instruction.systemPaths()
          expect(paths.has(path.join(profileTmp.path, "AGENTS.md"))).toBe(true)
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(false)
        },
      })
    } finally {
      restoreConfigDir(originalConfigDir)
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })

  instructionTest("falls back to global AGENTS.md when OPENCODE_CONFIG_DIR has no AGENTS.md", async () => {
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    await using profileTmp = await tmpdir()
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    process.env.OPENCODE_CONFIG_DIR = profileTmp.path
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await Instruction.systemPaths()
          expect(paths.has(path.join(profileTmp.path, "AGENTS.md"))).toBe(false)
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(true)
        },
      })
    } finally {
      restoreConfigDir(originalConfigDir)
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })

  instructionTest("uses global AGENTS.md when OPENCODE_CONFIG_DIR is not set", async () => {
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    delete process.env.OPENCODE_CONFIG_DIR
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await Instruction.systemPaths()
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(true)
        },
      })
    } finally {
      restoreConfigDir(originalConfigDir)
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })
})

describe("InstructionPrompt.system", () => {
  instructionTest("prepends a truthful capability-surface notice when instructions are loaded", async () => {
    await using projectTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "# Project Instructions")
      },
    })
    await using configTmp = await tmpdir()

    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = configTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const blocks = await InstructionPrompt.system()
          expect(blocks[0]).toBe(
            "Instruction blocks are local guidance only. They do not add tools or capabilities beyond the actual live tool list for this turn.",
          )
          expect(blocks.some((block) => block.includes("# Project Instructions"))).toBe(true)
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })

  instructionTest("dedupes and sorts remote instructions while normalizing line endings", async () => {
    await using projectTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "AGENTS.md"), "Project line 1\r\nProject line 2\r\n")
      },
    })
    await using configTmp = await tmpdir()

    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = configTmp.path

    const originalConfigContent = process.env.OPENCODE_CONFIG_CONTENT
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      instructions: [
        "https://b.example/guide",
        "https://a.example/guide",
        "https://a.example/guide",
      ],
    })
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => "Remote line 1\r\nRemote line 2\r\n",
    } as any)

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const blocks = await InstructionPrompt.system()
          const remoteBlocks = blocks.filter((block) => block.startsWith("Instructions from: https://"))

          expect(fetchSpy).toHaveBeenCalledTimes(2)
          expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual([
            "https://a.example/guide",
            "https://b.example/guide",
          ])
          expect(remoteBlocks).toHaveLength(2)
          expect(remoteBlocks[0]).toContain("Instructions from: https://a.example/guide")
          expect(remoteBlocks[1]).toContain("Instructions from: https://b.example/guide")
          expect(blocks.some((block) => block.includes("\r"))).toBe(false)
          expect(blocks.some((block) => block.includes("Project line 1\nProject line 2\n"))).toBe(true)
          expect(blocks.some((block) => block.includes("Remote line 1\nRemote line 2\n"))).toBe(true)
        },
      })
    } finally {
      fetchSpy.mockRestore()
      if (originalConfigContent === undefined) {
        delete process.env.OPENCODE_CONFIG_CONTENT
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = originalConfigContent
      }
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })
})
