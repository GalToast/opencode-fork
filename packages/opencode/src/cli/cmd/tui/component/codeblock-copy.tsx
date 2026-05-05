import { createSignal, Show, createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { Clipboard } from "../util/clipboard"
import type { JSX } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"

export interface CodeblockCopyProps {
  children?: JSX.Element
  content: string
  language?: string
  showBorder?: boolean
  alwaysShowButton?: boolean
}

export function CodeblockCopy(props: CodeblockCopyProps) {
  const { theme } = useTheme()
  const [copied, setCopied] = createSignal(false)
  const [hovered, setHovered] = createSignal(false)

  const showButton = createMemo(() => props.alwaysShowButton || hovered())

  const handleCopy = async () => {
    try {
      await Clipboard.copy(props.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error("Failed to copy codeblock:", error)
    }
  }

  const buttonBg = () => (hovered() ? theme.textMuted : theme.backgroundElement)
  const buttonFg = () => (copied() ? theme.success : theme.text)

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box flexDirection="column">
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={theme.backgroundElement}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        >
        <Show when={props.language}>
          <text fg={theme.textMuted}>{props.language}</text>
        </Show>
        <Show when={!props.language}>
          <text fg={theme.textMuted}>Code</text>
        </Show>
        <Show when={showButton()}>
          <box
            backgroundColor={buttonBg()}
            paddingLeft={2}
            paddingRight={2}
            onMouseUp={handleCopy}
          >
            <text fg={buttonFg()} attributes={hovered() ? TextAttributes.BOLD : undefined}>
              {copied() ? "✓ Copied!" : "Copy"}
            </text>
          </box>
        </Show>
      </box>
      <box
        border={props.showBorder !== false ? ["left", "right", "bottom"] : undefined}
        borderColor={theme.borderSubtle}
      >
        {props.children}
      </box>
    </box>
  )
}
