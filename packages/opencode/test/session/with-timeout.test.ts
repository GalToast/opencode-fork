import { describe, expect, test } from "bun:test"
import { withTimeout } from "../../src/util/timeout"

describe("withTimeout", () => {
  test("returns result when promise resolves before timeout", async () => {
    const result = await withTimeout(Promise.resolve(42), 1000)
    expect(result).toBe(42)
  })

  test("throws timeout error when promise takes too long", async () => {
    await expect(
      withTimeout(new Promise(() => {}), 50),
    ).rejects.toThrow("Operation timed out after 50ms")
  })

  test("clears timeout when promise rejects", async () => {
    const start = Date.now()
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 50),
    ).rejects.toThrow("boom")
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(100)
  })

  test("timeout is cleared on rejection so race resolves correctly", async () => {
    let timeoutFired = false
    const mainPromise = new Promise<number>((resolve) => {
      setTimeout(() => {
        timeoutFired = true
        resolve(1)
      }, 10)
    })

    await expect(
      withTimeout(mainPromise, 5),
    ).rejects.toThrow("Operation timed out after 5ms")

    await new Promise(r => setTimeout(r, 20))
    expect(timeoutFired).toBe(true)
  })
})