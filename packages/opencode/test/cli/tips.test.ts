import { describe, expect, test } from "bun:test"
import { deriveTipText } from "../../src/cli/cmd/tui/component/tips-state"

describe("tips", () => {
  test("derives deterministic tip text from context and seed", () => {
    const first = deriveTipText("returning", "session-123")
    const second = deriveTipText("returning", "session-123")
    const other = deriveTipText("returning", "session-456")

    expect(first).toBe(second)
    expect(first.length).toBeGreaterThan(0)
    expect(other.length).toBeGreaterThan(0)
  })

  test("uses the first-user pool for ignition context", () => {
    const first = deriveTipText("first", "seed-a")
    const second = deriveTipText("first", "seed-a")

    expect(first).toBe(second)
    expect(first).toContain("{highlight}")
  })
})
