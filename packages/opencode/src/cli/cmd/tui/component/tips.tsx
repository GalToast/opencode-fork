import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { deriveTipText } from "./tips-state"

type TipPart = { text: string; highlight: boolean }
type TipsProps = {
  context?: "first" | "returning"
  seed?: string
}

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}

export function Tips(props: TipsProps = {}) {
  const theme = useTheme().theme
  const parts = parse(deriveTipText(props.context, props.seed))
  const label = props.context === "first" ? "Ignition" : "Return vector"
  const tone = props.context === "first" ? theme.primary : theme.warning

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: tone }}>
        ● {label}{" "}
      </text>
      <text flexShrink={1}>
        <For each={parts}>
          {/* eslint-disable-next-line @typescript-eslint/no-unsafe-return */}
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}
