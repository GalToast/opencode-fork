import { createMemo } from "solid-js"
import { Keybind, type KeybindInfo } from "@/util/keybind"
import { pipe, mapValues } from "remeda"
import type { TuiConfigInfo } from "@/config/tui"
import type { ParsedKey, Renderable } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { useTuiConfig } from "./tui-config"

export type KeybindKey = keyof NonNullable<TuiConfigInfo["keybinds"]>

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const config = useTuiConfig()
    const keybinds = createMemo<Record<string, KeybindInfo[]>>(() => {
      return pipe(
        (config.keybinds ?? {}) as Record<string, string>,
        mapValues((value) => Keybind.parse(value)),
      )
    })
    const [store, setStore] = createStore({
      leader: false,
    })
    const renderer = useRenderer()

    let focus: Renderable | null
    let timeout: NodeJS.Timeout
    function leader(active: boolean) {
      if (active) {
        setStore("leader", true)
        focus = renderer.currentFocusedRenderable
        focus?.blur()
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => {
          if (!store.leader) return
          leader(false)
          if (!focus || focus.isDestroyed) return
          focus.focus()
        }, 2000)
        return
      }

      if (!active) {
        if (focus && !renderer.currentFocusedRenderable) {
          focus.focus()
        }
        setStore("leader", false)
      }
    }

    function matchesKey(keyName: KeybindKey, evt: ParsedKey) {
      const bindings = keybinds()[keyName]
      if (!bindings) return false
      const parsed = parseKey(evt)
      for (const binding of bindings) {
        if (Keybind.match(binding, parsed)) {
          return true
        }
      }
      return false
    }

    function parseKey(evt: ParsedKey): KeybindInfo {
      // Handle special case for Ctrl+Underscore (represented as \x1F)
      if (evt.name === "\x1F") {
        return Keybind.fromParsedKey({ ...evt, name: "_", ctrl: true }, store.leader)
      }
      return Keybind.fromParsedKey(evt, store.leader)
    }

    const result = {
      get all() {
        return keybinds()
      },
      get leader() {
        return store.leader
      },
      parse(evt: ParsedKey): KeybindInfo {
        return parseKey(evt)
      },
      match(keyName: KeybindKey, evt: ParsedKey) {
        return matchesKey(keyName, evt)
      },
      print(key: KeybindKey) {
        const first = keybinds()[key]?.at(0)
        if (!first) return ""
        const printed = Keybind.toString(first)
        const leaderBinding = keybinds().leader?.[0]
        return leaderBinding ? printed.replace("<leader>", Keybind.toString(leaderBinding)) : printed
      },
    }

    useKeyboard((evt) => {
      if (!store.leader && matchesKey("leader", evt)) {
        leader(true)
        return
      }

      if (store.leader && evt.name) {
        setImmediate(() => {
          if (focus && renderer.currentFocusedRenderable === focus) {
            focus.focus()
          }
          leader(false)
        })
      }
    })
    return result
  },
})

export type KeybindContext = ReturnType<typeof useKeybind>
