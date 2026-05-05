import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { RGBA } from "@opentui/core"

const BLOCK_FULL = "ᗢ"
const BLOCK_MEDIUM = "✿"
const BLOCK_LIGHT = "❀"

export function ProgressBar(props: {
  progress?: number
  label?: string
  showPercentage?: boolean
  color?: RGBA
  width?: number
}) {
  const { theme } = useTheme()
  const kv = useKV()
  const animationsEnabled = createMemo<boolean>(() => Boolean(kv.get("animations_enabled", true)))

  const color = () => props.color ?? theme.primary

  const normalizedProgress = createMemo(() => {
    if (props.progress == null || props.progress < 0) return null
    if (props.progress > 1) return 1
    return props.progress
  })

  const percentage = createMemo(() => {
    const prog = normalizedProgress()
    if (prog == null) return null
    return Math.round(prog * 100)
  })

  const barWidth = createMemo(() => {
    if (props.width != null) return props.width
    const prog = normalizedProgress()
    if (prog == null) return 10
    return Math.max(1, Math.floor(prog * 10))
  })

  const filledBlocks = createMemo(() => {
    const prog = normalizedProgress()
    if (prog == null) return 0
    return Math.floor(prog * barWidth())
  })

  const showIndeterminate = createMemo(() => props.progress == null || props.progress < 0)
  const determinateBlocks = createMemo(() =>
    Array.from({ length: barWidth() }, (_, index) => ({
      filled: index < filledBlocks(),
      key: index,
    })),
  )

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box flexDirection="row" alignItems="center" gap={1}>
      <Show when={props.label}>
        <text fg={theme.text}>{props.label}</text>
      </Show>
      <Show when={showIndeterminate()}>
        <IndeterminateBar color={color()} animationsEnabled={animationsEnabled()} />
      </Show>
      <Show when={!showIndeterminate()}>
        <box flexDirection="row">
          <box flexDirection="row" width={barWidth()}>
            <For each={determinateBlocks()}>
              {(block) => {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                return <text fg={block.filled ? color() : theme.backgroundElement}>{BLOCK_FULL}</text>
              }}
            </For>
          </box>
          <Show when={props.showPercentage ?? true}>
            <text fg={theme.textMuted} marginLeft={1}>
              {percentage()}%
            </text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

function IndeterminateBar(props: { color: RGBA; animationsEnabled: boolean }) {
  const { theme } = useTheme()

  if (!props.animationsEnabled) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (
      <box flexDirection="row" gap={0}>
        <text fg={props.color}>{BLOCK_MEDIUM}</text>
        <text fg={props.color}>{BLOCK_LIGHT}</text>
        <text fg={props.color}>{BLOCK_LIGHT}</text>
        <text fg={theme.backgroundElement}>{BLOCK_FULL}</text>
        <text fg={theme.backgroundElement}>{BLOCK_FULL}</text>
        <text fg={theme.backgroundElement}>{BLOCK_FULL}</text>
        <text fg={theme.backgroundElement}>{BLOCK_FULL}</text>
      </box>
    )
  }

  const [position, setPosition] = createSignal(0)

  onMount(() => {
    const interval = setInterval(() => {
      setPosition((p) => (p + 1) % 10)
    }, 100)
    onCleanup(() => clearInterval(interval))
  })

  const blocks = createMemo<{ char: string; color: RGBA }[]>(() => {
    const pos = position()
    const result: { char: string; color: RGBA }[] = []
    for (let i = 0; i < 7; i++) {
      const offset = (pos + i) % 10
      if (offset < 2) {
        result.push({ char: BLOCK_FULL, color: props.color })
      } else if (offset < 4) {
        result.push({ char: BLOCK_MEDIUM, color: props.color })
      } else if (offset < 6) {
        result.push({ char: BLOCK_LIGHT, color: props.color })
      } else {
        result.push({ char: BLOCK_FULL, color: theme.backgroundElement })
      }
    }
    return result
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box flexDirection="row" gap={0}>
      <For each={blocks()}>
        {(block) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return <text fg={block.color}>{block.char}</text>
        }}
      </For>
    </box>
  )
}
