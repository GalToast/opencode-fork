export function createDeferredCloseActionRunner(schedule: (fn: () => void) => void = (fn) => setTimeout(fn, 0)) {
  let version = 0

  return {
    schedule(action?: () => void) {
      const current = ++version
      if (!action) return
      schedule(() => {
        if (current !== version) return
        action()
      })
    },
    cancel() {
      version += 1
    },
  }
}
