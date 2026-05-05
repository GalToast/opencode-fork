import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { coerceRGBA, scaleRGBAAlpha } from "../../src/cli/cmd/tui/util/rgba"

describe("tui rgba utils", () => {
  test("coerceRGBA preserves real RGBA instances and upgrades plain rgba-like objects", () => {
    const instance = RGBA.fromInts(10, 20, 30, 40)
    expect(coerceRGBA(instance)).toBe(instance)

    const coerced = coerceRGBA({ r: 11, g: 22, b: 33, a: 44 })
    expect(coerced).toBeInstanceOf(RGBA)
    expect(coerced?.r).toBeCloseTo(11 / 255, 4)
    expect(coerced?.g).toBeCloseTo(22 / 255, 4)
    expect(coerced?.b).toBeCloseTo(33 / 255, 4)
    expect(coerced?.a).toBeCloseTo(44 / 255, 4)
  })

  test("scaleRGBAAlpha safely scales rgba-like objects and falls back for invalid values", () => {
    const scaled = scaleRGBAAlpha({ r: 20, g: 40, b: 60, a: 100 }, 0.5)
    expect(scaled).toBeInstanceOf(RGBA)
    expect(scaled?.r).toBeCloseTo(20 / 255, 4)
    expect(scaled?.g).toBeCloseTo(40 / 255, 4)
    expect(scaled?.b).toBeCloseTo(60 / 255, 4)
    expect(scaled?.a).toBeCloseTo(50 / 255, 4)

    const fallback = RGBA.fromInts(1, 2, 3, 4)
    expect(scaleRGBAAlpha({ nope: true }, 0.5, fallback)).toBe(fallback)
  })
})
