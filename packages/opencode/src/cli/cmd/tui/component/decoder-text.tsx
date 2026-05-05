import { createSignal, createEffect, onCleanup } from "solid-js"
import { useTheme } from "../context/theme"
import type { RGBA } from "@opentui/core"

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%" // Cyber Hex Chars

export function DecodeText(props: {
  text: string
  speed?: number
  delay?: number
  fg?: RGBA
  bg?: RGBA
  attributes?: number
  wrapMode?: "none" | "char" | "word" | "truncate-end" | "truncate-middle" | "truncate-start" | undefined
  width?: number | "auto" | `${number}%` | undefined
}) {
  const [display, setDisplay] = createSignal(props.text)
  const [animating, setAnimating] = createSignal(true)
  const { theme } = useTheme()

  createEffect(() => {
    // Reset when text changes
    setAnimating(true)
    let interval: ReturnType<typeof setInterval> | undefined

    const timeout = setTimeout(() => {
      let iteration = 0
      const target = props.text
      const len = target.length
      
      interval = setInterval(() => {
        let current = ""
        for (let i = 0; i < len; i++) {
          if (target[i] === " " || target[i] === undefined) {
            current += " "
            continue
          }
          if (i < iteration) {
            current += target[i]
          } else {
            current += CHARS[Math.floor(Math.random() * CHARS.length)]
          }
        }
        setDisplay(current)
        if (iteration >= len) {
          clearInterval(interval)
          setAnimating(false)
        }
        // Snappy glitch: finish in ~6-12 frames so we don't annoy the operator
        iteration += Math.max(1, len / 8) 
      }, props.speed ?? 20)
    }, props.delay ?? 0)

    onCleanup(() => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    })
  })

  const color = () => {
    if (props.fg) return props.fg
    return animating() ? theme.primary : theme.text
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <text 
      fg={color()} 
      bg={props.bg} 
      attributes={props.attributes} 
      selectable={false}
      wrapMode={props.wrapMode === "truncate-end" || props.wrapMode === "truncate-middle" || props.wrapMode === "truncate-start" ? "char" : props.wrapMode}
      width={typeof props.width === "number" ? props.width : undefined}
    >
      {display()}
    </text>
  )
}
