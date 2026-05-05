import { createMemo } from "solid-js"
import type { KeyBinding } from "@opentui/core"
import { useKeybind } from "../context/keybind"
import { Keybind, type KeybindInfo } from "@/util/keybind"

type KeybindContext = {
  all: Record<string, KeybindInfo[]>
}

const TEXTAREA_ACTIONS = [
  "submit",
  "newline",
  "move-left",
  "move-right",
  "move-up",
  "move-down",
  "select-left",
  "select-right",
  "select-up",
  "select-down",
  "line-home",
  "line-end",
  "select-line-home",
  "select-line-end",
  "visual-line-home",
  "visual-line-end",
  "select-visual-line-home",
  "select-visual-line-end",
  "buffer-home",
  "buffer-end",
  "select-buffer-home",
  "select-buffer-end",
  "delete-line",
  "delete-to-line-end",
  "delete-to-line-start",
  "backspace",
  "delete",
  "undo",
  "redo",
  "word-forward",
  "word-backward",
  "select-word-forward",
  "select-word-backward",
  "delete-word-forward",
  "delete-word-backward",
] as const

export function mapTextareaKeybindings(
  keybinds: Record<string, KeybindInfo[]>,
  action: (typeof TEXTAREA_ACTIONS)[number],
): KeyBinding[] {
  const configKey = `input_${action.replace(/-/g, "_")}`
  const bindings = keybinds[configKey]
  if (!bindings) return []
  return bindings.flatMap((binding) => {
    const baseBinding = {
      ctrl: binding.ctrl || undefined,
      meta: binding.meta || undefined,
      shift: binding.shift || undefined,
      super: binding.super || undefined,
      action,
    }
    if (binding.name === "return") {
      return [
        { ...baseBinding, name: "return" },
        { ...baseBinding, name: "enter" },
      ]
    }
    return [{ ...baseBinding, name: binding.name }]
  })
}

export function useTextareaKeybindings() {
  const keybind = useKeybind() as unknown as KeybindContext

  return createMemo(() => {
    const keybinds = keybind.all

    return [
      ...TEXTAREA_ACTIONS.flatMap((action) => mapTextareaKeybindings(keybinds, action)),
      // Keep Command/Meta+Return as a newline shortcut regardless of config for platform compatibility.
      { name: "return", meta: true, action: "newline" },
    ] satisfies KeyBinding[]
  })
}
