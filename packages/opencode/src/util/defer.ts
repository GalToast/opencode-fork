type SyncDeferred = { [Symbol.dispose]: () => void }
type AsyncDeferred = { [Symbol.asyncDispose]: () => Promise<void> }

export function defer(fn: () => void): SyncDeferred
export function defer(fn: () => Promise<void>): AsyncDeferred
export function defer(fn: () => void | Promise<void>): SyncDeferred | AsyncDeferred {
  return {
    [Symbol.dispose]() {
      void fn()
    },
    async [Symbol.asyncDispose]() {
      await fn()
    },
  }
}
