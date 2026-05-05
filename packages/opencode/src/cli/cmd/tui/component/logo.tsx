import { TextAttributes, type RGBA } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme, tint } from "@tui/context/theme"
import { logo, marks } from "@/cli/logo"

// Shadow markers (rendered chars in parens):
// _ = full shadow cell (space with bg=shadow)
// ^ = letter top, shadow bottom (▀ with fg=letter, bg=shadow)
// ~ = shadow top only (▀ with fg=shadow)
const SHADOW_MARKER = new RegExp(`[${marks}]`)

export function Logo(): JSX.Element {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const gap = 6
  const leftWidth = Math.max(...logo.left.map((line) => line.length))
  const rightWidth = Math.max(...logo.right.map((line) => line.length))
  const stacked = () => dimensions().width < leftWidth + gap + rightWidth

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    const elements: JSX.Element[] = []
    let i = 0

    while (i < line.length) {
      const rest = line.slice(i)
      const markerIndex = rest.search(SHADOW_MARKER)

      if (markerIndex === -1) {
        elements.push(
          (<text fg={fg} attributes={attrs} selectable={false}>
            {rest}
          </text>) as unknown as JSX.Element,
        )
        break
      }

      if (markerIndex > 0) {
        elements.push(
          (<text fg={fg} attributes={attrs} selectable={false}>
            {rest.slice(0, markerIndex)}
          </text>) as unknown as JSX.Element,
        )
      }

      const marker = rest[markerIndex]
      switch (marker) {
        case "_":
          elements.push(
            (<text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
              {" "}
            </text>) as unknown as JSX.Element,
          )
          break
        case "^":
          elements.push(
            (<text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
              ▀
            </text>) as unknown as JSX.Element,
          )
          break
        case "~":
          elements.push(
            (<text fg={shadow} attributes={attrs} selectable={false}>
              ▀
            </text>) as unknown as JSX.Element,
          )
          break
      }

      i += markerIndex + 1
    }

    return elements
  }

  return (
    <box>
      {stacked() ? (
        <>
          <For each={logo.left}>
            {(line) => (<box flexDirection="row">{renderLine(line, theme.textMuted, false)}</box>) as unknown as JSX.Element}
          </For>
          <box height={1} />
          <For each={logo.right}>
            {(line) => (<box flexDirection="row">{renderLine(line, theme.text, true)}</box>) as unknown as JSX.Element}
          </For>
        </>
      ) : (
        <For each={logo.left}>
          {(line, index) => (
            (<box flexDirection="row" gap={gap}>
              <box flexDirection="row">{renderLine(line, theme.textMuted, false)}</box>
              <box flexDirection="row">{renderLine(logo.right[index()] ?? "", theme.text, true)}</box>
            </box>) as unknown as JSX.Element
          )}
        </For>
      )}
    </box>
  ) as unknown as JSX.Element
}
