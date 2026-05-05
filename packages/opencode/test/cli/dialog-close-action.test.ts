import { expect, test } from "bun:test"
import { createDeferredCloseActionRunner } from "../../src/cli/cmd/tui/util/dialog-close-action"

test("deferred close actions run after the scheduled close completes", () => {
  const pending: (() => void)[] = []
  const calls: string[] = []
  const runner = createDeferredCloseActionRunner((fn) => pending.push(fn))

  runner.schedule(() => {
    calls.push("ran")
  })

  expect(calls).toEqual([])
  expect(pending).toHaveLength(1)

  pending.shift()?.()

  expect(calls).toEqual(["ran"])
})

test("replacing or re-closing cancels stale deferred close actions", () => {
  const pending: (() => void)[] = []
  const calls: string[] = []
  const runner = createDeferredCloseActionRunner((fn) => pending.push(fn))

  runner.schedule(() => {
    calls.push("stale")
  })
  runner.cancel()

  pending.shift()?.()

  expect(calls).toEqual([])
})

test("a newer close action supersedes an older one", () => {
  const pending: (() => void)[] = []
  const calls: string[] = []
  const runner = createDeferredCloseActionRunner((fn) => pending.push(fn))

  runner.schedule(() => {
    calls.push("first")
  })
  runner.schedule(() => {
    calls.push("second")
  })

  pending.shift()?.()
  pending.shift()?.()

  expect(calls).toEqual(["second"])
})
