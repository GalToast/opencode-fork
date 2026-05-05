import { createMemo, For, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { Locale } from "@/util/locale"
import { useRenderer } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import {
  deriveTurnCeremony,
  deriveTurnSurface,
  type TranscriptTurnStatus,
  type TranscriptTurnSurface,
} from "@/cli/cmd/tui/util/transcript"

export function SessionTimeline(props: { sessionID: string; onJump: (messageID: string) => void }) {
  const sync = useSync()
  const { theme } = useTheme()
  const renderer = useRenderer()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  
  const timelineTurns = createMemo(() => {
    const msgs = messages()
    const turns: Array<
      TranscriptTurnSurface & {
        ceremonyLabel?: string
        ceremonyDetail?: string
        ceremonyRoleLabel?: string
        ceremony: boolean
      },
    > = []

    for (const message of msgs) {
      if (message.role !== "user" && message.role !== "assistant") {
        continue
      }
      const parts = sync.data.part[message.id] ?? []
      const ceremony = deriveTurnCeremony({
        message,
        parts,
        messages: msgs,
        partsByMessage: sync.data.part,
      })
      turns.push({
        ...deriveTurnSurface(message, parts, { previewLength: 60 }),
        ceremonyLabel: ceremony.label,
        ceremonyDetail: ceremony.detail,
        ceremonyRoleLabel: ceremony.roleLabel,
        ceremony: Boolean(ceremony.label),
      })
    }

    return turns
  })

  const statusColor = (status: TranscriptTurnStatus, role: "user" | "assistant"): RGBA | undefined => {
    if (role === "user") {
      return theme.secondary
    }

    if (status === "error") {
      return theme.error
    }

    if (status === "truncated") {
      return theme.warning
    }

    if (status === "complete") return theme.textMuted

    return theme.primary
  }

  const traceColor = (turn: TranscriptTurnSurface): RGBA | undefined => {
    if (turn.role === "user") return theme.secondary
    if (turn.status === "error") return theme.error
    if (turn.status === "truncated") return theme.warning
    if (turn.status === "tooling" || turn.status === "waiting") return theme.primary
    if (turn.status === "complete") return theme.textMuted
    return theme.textMuted
  }

  function setTimelineHoverBackground(value: unknown, color: RGBA | undefined) {
    if (!value || typeof value !== "object" || !("setBackgroundColor" in value)) return
    const renderable = value as { setBackgroundColor: (next: RGBA | undefined) => void }
    renderable.setBackgroundColor(color)
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box
      border={["top", "bottom"]}
      borderColor={theme.border}
      marginTop={1}
      marginBottom={1}
    >
      <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          <span style={{ fg: theme.primary }}>◈ </span>Session Timeline
        </text>
      </box>
      
      <box flexDirection="column" gap={0}>
        <For each={timelineTurns()}>
          {(turn) => {
            const timestamp = Locale.todayTimeOrDateTime(turn.timestamp)
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return (
              <box
                backgroundColor={turn.ceremony ? theme.backgroundElement : theme.backgroundPanel}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  props.onJump(turn.messageID)
                }}
                onMouseOver={(event) => {
                  setTimelineHoverBackground(event.currentTarget, turn.ceremony ? theme.backgroundMenu : theme.backgroundElement)
                }}
                onMouseOut={(event) => {
                  setTimelineHoverBackground(event.currentTarget, turn.ceremony ? theme.backgroundElement : theme.backgroundPanel)
                }}
                paddingLeft={2}
                paddingRight={2}
                paddingTop={0}
                paddingBottom={0}
                height={4}
              >
                <box flexDirection="column" justifyContent="center" flexGrow={1}>
                <box flexDirection="row" gap={2} alignItems="center">
                    <text
                      fg={turn.role === "user" ? theme.secondary : theme.primary}
                      attributes={TextAttributes.BOLD}
                    >
                      {turn.statusIcon}
                    </text>
                    <text fg={theme.text} flexGrow={1}>
                      {turn.preview}
                    </text>
                    <text
                      fg={statusColor(turn.status, turn.role)}
                      attributes={TextAttributes.BOLD}
                    >
                      [{turn.statusLabel}]
                    </text>
                    <Show when={turn.ceremony}>
                      <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                        · {turn.ceremonyLabel}
                      </text>
                    </Show>
                    <text fg={theme.textMuted}>
                      {timestamp}
                    </text>
                  </box>
                  <box flexDirection="row" gap={2} alignItems="center">
                    <text fg={turn.role === "user" ? theme.secondary : theme.textMuted} width={7}>
                      {turn.roleLabel}
                    </text>
                    <Show when={turn.ceremony}>
                      <text fg={theme.textMuted}>
                        {turn.ceremonyRoleLabel}
                      </text>
                    </Show>
                    <text fg={traceColor(turn)} wrapMode="truncate-end">
                      {turn.ceremonyDetail ?? turn.traceLabel}
                    </text>
                  </box>
                </box>
              </box>
            )
          }}
        </For>
        
        <Show when={timelineTurns().length === 0}>
          <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
            <text fg={theme.textMuted}>No messages in this session yet.</text>
          </box>
        </Show>
      </box>
    </box>
  )
}
