import { Instance } from "../project/instance"

const state = Instance.state(() => {
  // Create a shallow copy to isolate environment per instance
  // Prevents parallel tests from interfering with each other's env vars
  return { ...process.env } as Record<string, string | undefined>
})

function get(key: string) {
  const env = state()
  return env[key]
}

function all() {
  return state()
}

function set(key: string, value: string) {
  const env = state()
  env[key] = value
}

function remove(key: string) {
  const env = state()
  delete env[key]
}

export const Env = {
  get,
  all,
  set,
  remove,
}
