import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Format } from "../../src/format"
import * as FormatterModule from "../../src/format/formatter"

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer))

describe("Format", () => {
  it.live("status() returns built-in formatters when no config overrides", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const statuses = yield* Effect.promise(() => Format.status())
        expect(Array.isArray(statuses)).toBe(true)
        expect(statuses.length).toBeGreaterThan(0)

        for (const item of statuses) {
          expect(typeof item.name).toBe("string")
          expect(Array.isArray(item.extensions)).toBe(true)
          expect(typeof item.enabled).toBe("boolean")
        }

        const gofmt = statuses.find((item) => item.name === "gofmt")
        expect(gofmt).toBeDefined()
        expect(gofmt!.extensions).toContain(".go")
      }),
    ),
  )

  it.live("status() returns empty list when formatter is disabled", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const statuses = yield* Effect.promise(() => Format.status())
          expect(statuses).toEqual([])
        }),
      { config: { formatter: false } },
    ),
  )

  it.live("status() excludes formatters marked as disabled in config", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const statuses = yield* Effect.promise(() => Format.status())
          const gofmt = statuses.find((item) => item.name === "gofmt")
          expect(gofmt).toBeUndefined()
        }),
      {
        config: {
          formatter: {
            gofmt: { disabled: true },
          },
        },
      },
    ),
  )

  it.live("service initializes without error", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        Format.init()
        yield* Effect.void
      }),
    ),
  )

  it.live("status() initializes formatter state per directory", () =>
    Effect.gen(function* () {
      const a = yield* provideTmpdirInstance(() => Effect.promise(() => Format.status()), {
        config: { formatter: false },
      })
      const b = yield* provideTmpdirInstance(() => Effect.promise(() => Format.status()))

      expect(a).toEqual([])
      expect(b.length).toBeGreaterThan(0)
    }),
  )

  it.live("runs enabled checks for matching formatters in parallel", () =>
    provideTmpdirInstance((path) =>
      Effect.gen(function* () {
        const file = `${path}/test.parallel`
        yield* Effect.promise(() => Bun.write(file, "x"))

        const one = {
          extensions: [...FormatterModule.gofmt.extensions],
          enabled: FormatterModule.gofmt.enabled,
        }
        const two = {
          extensions: [...FormatterModule.mix.extensions],
          enabled: FormatterModule.mix.enabled,
        }

        let active = 0
        let max = 0

        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            FormatterModule.gofmt.extensions = [".parallel"]
            FormatterModule.mix.extensions = [".parallel"]
            FormatterModule.gofmt.enabled = async () => {
              active++
              max = Math.max(max, active)
              await Bun.sleep(20)
              active--
              return true
            }
            FormatterModule.mix.enabled = async () => {
              active++
              max = Math.max(max, active)
              await Bun.sleep(20)
              active--
              return true
            }
          }),
          () =>
            Effect.gen(function* () {
              yield* Effect.promise(() => Format.file(file))
            }),
          () =>
            Effect.sync(() => {
              FormatterModule.gofmt.extensions = one.extensions
              FormatterModule.gofmt.enabled = one.enabled
              FormatterModule.mix.extensions = two.extensions
              FormatterModule.mix.enabled = two.enabled
            }),
        )

        expect(max).toBe(2)
      }),
    ),
  )

  it.live("runs matching formatters sequentially for the same file", () =>
    provideTmpdirInstance(
      (path) =>
        Effect.gen(function* () {
          const file = `${path}/test.seq`
          yield* Effect.promise(() => Bun.write(file, "x"))

          yield* Effect.promise(() => Format.file(file))

          expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("xAB")
        }),
      {
        config: {
          formatter: {
            first: {
              command: [
                process.execPath,
                "-e",
                "const fs=require('fs'); const file=process.argv.at(-1); fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + 'A')",
                "$FILE",
              ],
              extensions: [".seq"],
            },
            second: {
              command: [
                process.execPath,
                "-e",
                "const fs=require('fs'); const file=process.argv.at(-1); fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + 'B')",
                "$FILE",
              ],
              extensions: [".seq"],
            },
          },
        },
      },
    ),
  )
})
