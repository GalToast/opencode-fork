import { AsyncLocalStorage } from "async_hooks"

class NotFound extends Error {
  constructor(public override readonly name: string) {
    super(`No context found for ${name}`)
  }
}

function create<T>(name: string) {
  const storage = new AsyncLocalStorage<T>()
  return {
    use() {
      const result = storage.getStore()
      if (!result) {
        throw new NotFound(name)
      }
      return result
    },
    provide<R>(value: T, fn: () => R | Promise<R>): R | Promise<R> {
      return storage.run(value, fn)
    },
  }
}

export const Context = {
  NotFound,
  create,
}
