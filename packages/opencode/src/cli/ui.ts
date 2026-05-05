import z from "zod"
import { EOL } from "os"
import { NamedError } from "@opencode-ai/util/error"
import { logo as glyphs } from "./logo"
import { createInterface } from "readline"

const CancelledError = NamedError.create("UICancelledError", z.void())

const Style = {
  TEXT_HIGHLIGHT: "\x1b[96m",
  TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
  TEXT_DIM: "\x1b[90m",
  TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
  TEXT_NORMAL: "\x1b[0m",
  TEXT_NORMAL_BOLD: "\x1b[1m",
  TEXT_WARNING: "\x1b[93m",
  TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
  TEXT_DANGER: "\x1b[91m",
  TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
  TEXT_SUCCESS: "\x1b[92m",
  TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
  TEXT_INFO: "\x1b[94m",
  TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
}

let blank = false

function print(...message: string[]) {
  blank = false
  void Bun.stderr.write(message.join(" "))
}

function println(...message: string[]) {
  print(...message)
  void Bun.stderr.write(EOL)
}

function empty() {
  if (blank) return
  println("" + Style.TEXT_NORMAL)
  blank = true
}

function logo(pad?: string) {
  const result: string[] = []
  const reset = "\x1b[0m"
  const left = {
    fg: Bun.color("gray", "ansi") ?? "",
    shadow: "\x1b[38;5;235m",
    bg: "\x1b[48;5;235m",
  }
  const right = {
    fg: reset,
    shadow: "\x1b[38;5;238m",
    bg: "\x1b[48;5;238m",
  }
  const gap = "      "
  const padWidth = pad?.length ?? 0
  const leftWidth = Math.max(...glyphs.left.map((line) => line.length))
  const rightWidth = Math.max(...glyphs.right.map((line) => line.length))
  const terminalWidth = process.stdout.columns || Number.POSITIVE_INFINITY
  const stacked = terminalWidth < padWidth + leftWidth + gap.length + rightWidth
  const draw = (line: string, fg: string, shadow: string, bg: string) => {
    const parts: string[] = []
    for (const char of line) {
      if (char === "_") {
        parts.push(bg, " ", reset)
        continue
      }
      if (char === "^") {
        parts.push(fg, bg, "▀", reset)
        continue
      }
      if (char === "~") {
        parts.push(shadow, "▀", reset)
        continue
      }
      if (char === " ") {
        parts.push(" ")
        continue
      }
      parts.push(fg, char, reset)
    }
    return parts.join("")
  }
  if (stacked) {
    glyphs.left.forEach((row) => {
      if (pad) result.push(pad)
      result.push(draw(row, left.fg, left.shadow, left.bg), EOL)
    })
    result.push(EOL)
    glyphs.right.forEach((row) => {
      if (pad) result.push(pad)
      result.push(draw(row, right.fg, right.shadow, right.bg), EOL)
    })
  } else {
    glyphs.left.forEach((row, index) => {
      if (pad) result.push(pad)
      result.push(draw(row, left.fg, left.shadow, left.bg))
      result.push(gap)
      const other = glyphs.right[index] ?? ""
      result.push(draw(other, right.fg, right.shadow, right.bg))
      result.push(EOL)
    })
  }
  return result.join("").trimEnd()
}

async function input(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function error(message: string) {
  if (message.startsWith("Error: ")) {
    message = message.slice("Error: ".length)
  }
  println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
}

function markdown(text: string): string {
  return text
}

export const UI = {
  CancelledError,
  Style,
  println,
  print,
  empty,
  logo,
  input,
  error,
  markdown,
}
