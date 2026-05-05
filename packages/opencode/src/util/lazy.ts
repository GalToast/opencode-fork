export function lazy<T>(fn: () => T) {
  let value: T | undefined
  let loaded = false

  const result = (): T => {
    if (loaded) return value
    try {
      value = fn()
      loaded = true
      return value
    } catch (e) {
      // Don't mark as loaded if initialization failed
      throw e
    }
  }

  result.reset = () => {
    loaded = false
    value = undefined
  }

  return result
}
