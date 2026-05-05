import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { createSignal, type Setter } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import path from "path"

type KVStore = Record<string, unknown>

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore<KVStore>({})
    const filePath = path.join(Global.Path.state, "kv.json")

    Filesystem.readJson(filePath)
      .then((x) => {
        if (!x || typeof x !== "object" || Array.isArray(x)) return
        setStore(x as KVStore)
      })
      .catch(() => {})
      .finally(() => {
        setReady(true)
      })

    const result = {
      get ready() {
        return ready()
      },
      get store() {
        return store
      },
      signal<T>(name: string, defaultValue: T) {
        if (store[name] === undefined) setStore(name, defaultValue)
        return [
          function getValue() {
            return result.get(name)
          },
          function setter(next: Setter<T | undefined>) {
            result.set(name, next)
          },
        ] as const
      },
      get<T>(key: string, defaultValue?: T) {
        return (store[key] as T | undefined) ?? defaultValue
      },
      set<T>(key: string, value: Setter<T | undefined>) {
        const current = store[key] as T | undefined
        const next = typeof value === "function" ? (value as (prev: T | undefined) => T | undefined)(current) : value
        setStore(key, next)
        void Filesystem.writeJson(filePath, { ...store, [key]: next }).catch(() => {})
      },
    }
    return result
  },
})
