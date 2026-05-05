import { isDeepEqual } from "remeda"
import type { ParsedKey } from "@opentui/core"

/**
 * Keybind info derived from OpenTUI's ParsedKey with our custom `leader` field.
 * This ensures type compatibility and catches missing fields at compile time.
 */
export type KeybindInfo = Pick<ParsedKey, "name" | "ctrl" | "meta" | "shift" | "super"> & {
  leader: boolean // our custom field
}

function match(a: KeybindInfo | undefined, b: KeybindInfo): boolean {
  if (!a) return false
  const normalizedA = { ...a, super: a.super ?? false }
  const normalizedB = { ...b, super: b.super ?? false }
  return isDeepEqual(normalizedA, normalizedB)
}

/**
 * Convert OpenTUI's ParsedKey to our keybind info format.
 * This helper ensures all required fields are present and avoids manual object creation.
 */
function fromParsedKey(key: ParsedKey, leader = false): KeybindInfo {
  return {
    name: key.name === "enter" ? "return" : key.name,
    ctrl: key.ctrl,
    meta: key.meta,
    shift: key.shift,
    super: key.super ?? false,
    leader,
  }
}

function toString(info: KeybindInfo | undefined): string {
  if (!info) return ""
  const parts: string[] = []

  if (info.ctrl) parts.push("ctrl")
  if (info.meta) parts.push("alt")
  if (info.super) parts.push("super")
  if (info.shift) parts.push("shift")
  if (info.name) {
    if (info.name === "delete") parts.push("del")
    else parts.push(info.name)
  }

  let result = parts.join("+")

  if (info.leader) {
    result = result ? `<leader> ${result}` : `<leader>`
  }

  return result
}

function parse(key: string): KeybindInfo[] {
  if (key === "none") return []

  return key.split(",").map((combo) => {
    // Handle <leader> syntax by replacing with leader+
    const normalized = combo.replace(/<leader>/g, "leader+")
    const parts = normalized.toLowerCase().split("+")
    const info: KeybindInfo = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "",
    }

    for (const part of parts) {
      switch (part) {
        case "ctrl":
          info.ctrl = true
          break
        case "alt":
        case "meta":
        case "option":
          info.meta = true
          break
        case "super":
          info.super = true
          break
        case "shift":
          info.shift = true
          break
        case "leader":
          info.leader = true
          break
        case "esc":
          info.name = "escape"
          break
        case "enter":
          info.name = "return"
          break
        default:
          info.name = part
          break
      }
    }

    return info
  })
}

export const Keybind = {
  match,
  fromParsedKey,
  toString,
  parse,
}
