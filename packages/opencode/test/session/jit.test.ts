import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { JitHydrator } from "../../src/session/jit"
import { Session } from "../../src/session/index"
import { tmpdir } from "../fixture/fixture"

describe("session.jit", () => {
  test("skips short or non-code task context", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const short = await JitHydrator.hydrate({
          sessionID: "ses_short_ctx" as any,
          taskContext: "quick note",
        })
        expect(short).toBeUndefined()

        const raw = await JitHydrator.hydrate({
          sessionID: "ses_non_code_ctx" as any,
          taskContext: "I love coding and can fix this issue carefully with no obvious urgency and no file list.",
        })
        expect(raw).toBeUndefined()
      },
    })
  }, 60_000)

  test("hydrates matched module and avoids re-paging in the same session", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(path.join(tmp.path, "src", "jit_target.ts"), "export const quantum_orchestrator = true\n", {
          createPath: true,
        })

        const ctx = "Need to update this module for quantum_orchestrator integration and routing."
        const got = await JitHydrator.hydrate({ sessionID: "ses_jit" as any, taskContext: ctx })

        expect(got).not.toBeUndefined()
        expect(got).toContain("Memory MMU: Just-in-Time Context")
        expect(got).toContain("jit_target.ts")

        const again = await JitHydrator.hydrate({ sessionID: "ses_jit" as any, taskContext: ctx })
        expect(again).toBeUndefined()
      },
    })
  }, 60_000)

  test("skips active files and respects maxFiles budget", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(
          path.join(tmp.path, "src", "jit_top.ts"),
          "module route planner\nmodule route planner\nmodule route planner\n",
          { createPath: true },
        )
        await Bun.write(path.join(tmp.path, "src", "jit_extra.ts"), "module: route planner\n", { createPath: true })

        const ctx = "Please fix the module route planner in this session and keep it stable."

        const skipped = await JitHydrator.hydrate({
          sessionID: "ses_active" as any,
          taskContext: ctx,
          activeFiles: ["src/jit_top.ts"],
        })
        expect(skipped).not.toBeUndefined()
        expect(skipped).toContain("jit_extra.ts")

        const capped = await JitHydrator.hydrate({
          sessionID: "ses_top_only" as any,
          taskContext: ctx,
          maxFiles: 1,
        })
        expect(capped).not.toBeUndefined()
        expect(capped).toContain("jit_top.ts")
        expect(capped).not.toContain("jit_extra.ts")
      },
    })
  }, 60_000)

  test("skips chat-like non-coding input without code keywords", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const chatInputs = [
          "Hey, how are you doing today? I hope you're having a great day!",
          "Can you explain what quantum computing is in simple terms?",
          "What's the weather like? I need to go outside soon.",
          "Tell me a joke about programmers and debugging.",
        ]

        for (const input of chatInputs) {
          const result = await JitHydrator.hydrate({
            sessionID: "ses_chat_skip" as any,
            taskContext: input,
          })
          expect(result).toBeUndefined()
        }
      },
    })
  }, 60_000)

  test("classifies code intent correctly", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a test file with content that will be found
        await Bun.write(path.join(tmp.path, "src", "intent_test.ts"), "export const intent_test = true\n", { createPath: true })

        // Code intent - should hydrate
        const codeIntent = await JitHydrator.hydrate({
          sessionID: "ses_intent_code" as any,
          taskContext: "Fix the intent_test module for integration and routing.",
        })
        expect(codeIntent).not.toBeUndefined()
        expect(codeIntent).toContain("intent_test.ts")

        // Chat-like should be skipped
        const chatLike = await JitHydrator.hydrate({
          sessionID: "ses_intent_chat" as any,
          taskContext: "Hey, how are you doing today? I hope you're having a great day!",
        })
        expect(chatLike).toBeUndefined()
      },
    })
  }, 60_000)

  test("returns undefined when no matching files found", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Don't create any files - empty directory

        const ctx = "Fix the src/nonexistent_module.ts integration carefully."

        const result = await JitHydrator.hydrate({
          sessionID: "ses_no_files" as any,
          taskContext: ctx,
        })

        expect(result).toBeUndefined()
      },
    })
  }, 60_000)

  test("respects maxFiles limit even when many relevant files exist", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create files with paths that will match the search
        for (let i = 0; i < 10; i++) {
          await Bun.write(
            path.join(tmp.path, "src", `limit_${i}.ts`),
            `export const limit_${i} = true\nlimit_${i} limit_${i}\n`,
            { createPath: true },
          )
        }

        // Query that references the path patterns
        const ctx = "Update src/limit_0.ts and src/limit_1.ts through src/limit_9.ts for routing integration."

        const limited = await JitHydrator.hydrate({
          sessionID: "ses_maxfiles" as any,
          taskContext: ctx,
          maxFiles: 2,
        })

        expect(limited).not.toBeUndefined()
        const matchCount = (limited!.match(/limit_\d+\.ts/g) ?? []).length
        expect(matchCount).toBeLessThanOrEqual(2)
      },
    })
  }, 60_000)

  test("enforces per-session JIT file cache limit", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "ses_jit_cache_cap"

        for (let i = 0; i < JitHydrator.cacheLimit() + 6; i++) {
          await Bun.write(
            path.join(tmp.path, "src", `cache_${i}.ts`),
            `export const cache_value_${i} = true\n`,
            { createPath: true },
          )
          const result = await JitHydrator.hydrate({
            sessionID,
            taskContext: `Inspect src/cache_${i}.ts for cache_value_${i} routing behavior and planning integration details.`,
            maxFiles: 1,
            maxTokens: 400,
          })
          expect(result).not.toBeUndefined()
        }

        const stats = JitHydrator.cacheStats(sessionID)
        expect(stats.files).toBeLessThanOrEqual(JitHydrator.cacheLimit())
      },
    })
  }, 60_000)

  test("clears jit cache and paged history when session is removed", async () => {
    await using tmp = await tmpdir()
    const sessionID = "ses_jit_remove_cleanup"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Session.createNext({
          id: sessionID,
          directory: tmp.path,
        })

        await Bun.write(path.join(tmp.path, "src", "cleanup.ts"), "export const cleanup = true\n", { createPath: true })
        const ctx = "Update src/cleanup.ts cleanup integration and routing behavior."

        const first = await JitHydrator.hydrate({
          sessionID,
          taskContext: ctx,
          maxFiles: 1,
        })
        expect(first).not.toBeUndefined()
        expect(JitHydrator.cacheStats(sessionID).files).toBe(1)

        await Session.remove(sessionID)

        const after = await JitHydrator.hydrate({
          sessionID,
          taskContext: ctx,
          maxFiles: 1,
        })
        expect(after).not.toBeUndefined()
        expect(JitHydrator.cacheStats(sessionID).files).toBe(1)
      },
    })
  }, 60_000)
})
