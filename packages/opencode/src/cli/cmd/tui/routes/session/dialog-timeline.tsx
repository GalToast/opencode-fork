import { createMemo, onMount, For, Show, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { Locale } from "@/util/locale"
import { useDialog } from "../../ui/dialog"
import type { PromptInfo } from "../../component/prompt/history"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { deriveTurnCeremony, deriveTurnSurface } from "@/cli/cmd/tui/util/transcript"

export function DialogTimeline(props: {
  sessionID: string
  onMove: (messageID: string) => void
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [selectedTurn, setSelectedTurn] = createSignal<string | null>(null)

  onMount(() => {
    dialog.setSize("large")
  })

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const timelineTurns = createMemo(() => {
    const msgs = messages()
    const turns: Array<{
      messageID: string
      role: "user" | "assistant"
      turnNumber: number
      timestamp: number
      preview: string
      statusLabel: string
      statusIcon: string
      roleLabel: string
      ceremonyLabel?: string
      ceremonyRoleLabel?: string
      traceLabel: string
      ceremony: boolean
      tokens?: number
      cost?: number
    }> = []
    let turnNumber = 1

    for (const message of msgs) {
      if (message.role !== "user" && message.role !== "assistant") {
        continue
      }

      const turn = deriveTurnSurface(message, sync.data.part[message.id] ?? [], { previewLength: 60 })
      const ceremony = deriveTurnCeremony({
        message,
        parts: sync.data.part[message.id] ?? [],
        messages: msgs,
        partsByMessage: sync.data.part,
      })
      turns.push({
        messageID: message.id,
        role: message.role,
        turnNumber,
        timestamp: message.time.created,
        preview: turn.preview,
        statusLabel: turn.statusLabel,
        statusIcon: turn.statusIcon,
        roleLabel: turn.roleLabel,
        ceremonyLabel: ceremony.label,
        traceLabel: ceremony.detail ?? turn.traceLabel,
        ceremony: Boolean(ceremony.label),
        ceremonyRoleLabel: ceremony.roleLabel,
        tokens: turn.tokens,
        cost: turn.cost,
      })

      if (message.role === "user") {
        turnNumber++
      }
    }

    return turns
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Session Timeline
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
      </box>

      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>
          {timelineTurns().length} turns • mission trace • click to jump
        </text>
      </box>

      <box paddingTop={1} flexDirection="column" gap={0}>
        <For each={timelineTurns()}>
          {(turn) => {
            return (
              <box
                paddingLeft={4}
                paddingRight={4}
                paddingTop={0}
                paddingBottom={0}
                height={4}
                flexDirection="row"
                alignItems="flex-start"
                gap={2}
                onMouseUp={() => {
                  setSelectedTurn(turn.messageID)
                  props.onMove(turn.messageID)
                }}
                backgroundColor={
                  selectedTurn() === turn.messageID
                    ? theme.backgroundElement
                    : turn.ceremony
                      ? theme.backgroundPanel
                      : undefined
                }
              >
                <text
                  fg={turn.role === "user" ? theme.primary : theme.accent}
                  flexShrink={0}
                  width={3}
                >
                  {turn.statusIcon}
                </text>
                <box flexGrow={1} flexDirection="column" gap={0}>
                  <text
                    fg={theme.text}
                    wrapMode="none"
                    attributes={selectedTurn() === turn.messageID ? TextAttributes.BOLD : undefined}
                  >
                    {turn.preview}
                  </text>
                  <text fg={theme.textMuted} wrapMode="none">
                    Turn {turn.turnNumber} • {turn.statusLabel} • {turn.roleLabel}
                    <Show when={turn.ceremony}>
                      {" "}• {turn.ceremonyLabel}
                    </Show>
                  </text>
                  <text fg={turn.role === "user" ? theme.secondary : theme.textMuted} wrapMode="none">
                    {turn.traceLabel} • {Locale.time(turn.timestamp)}
                    <Show when={turn.tokens}>
                      {" "}• {turn.tokens} tok
                    </Show>
                    <Show when={turn.cost}>
                      {" "}• ${turn.cost?.toFixed(4)}
                    </Show>
                  </text>
                </box>
                <text
                  fg={turn.role === "user" ? theme.primary : theme.accent}
                  flexShrink={0}
                  width={10}
                >
                  {turn.role === "user" ? "Intent" : "Organism"}
                </text>
              </box>
            )
          }}
        </For>
      </box>

      <Show when={timelineTurns().length === 0}>
        <box paddingLeft={4} paddingRight={4} paddingTop={2}>
          <text fg={theme.textMuted}>No messages in this session yet.</text>
        </box>
      </Show>
    </box>
  )
}
