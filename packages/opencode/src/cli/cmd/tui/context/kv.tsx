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
      signal<T>(name: string, defaultValue: T): readonly [() => T, (next: Setter<T>) => void] {
        if (store[name] === undefined) setStore(name, defaultValue)
        return [
          function getValue() {
            return result.get(name, defaultValue)
          },
          function setter(next: Setter<T>) {
            result.set(name, next)
          },
        ] as const
      },
      get: (<T,>(key: string, defaultValue?: T): T | undefined => {
        return (store[key] as T | undefined) ?? defaultValue
      }) as {
        <T,>(key: string): T | undefined
        <T,>(key: string, defaultValue: T): T
      },
      set<T>(key: string, value: T | ((prev: T | undefined) => T)) {
        const current = store[key] as T | undefined
        const next = typeof value === "function" ? (value as (prev: T | undefined) => T)(current) : value
        setStore(key, next)
        void Filesystem.writeJson(filePath, { ...store, [key]: next }).catch(() => {})
      },
    }
    return result
  },
})
