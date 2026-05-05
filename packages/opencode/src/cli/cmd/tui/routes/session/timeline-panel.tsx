import { createMemo, For, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import { deriveTurnCeremony, deriveTurnSurface } from "@/cli/cmd/tui/util/transcript"
import { TextAttributes } from "@opentui/core"
import type { RGBA } from "@opentui/core"

export function TimelinePanel(props: { sessionID: string; onMove?: (messageID: string) => void }) {
  const sync = useSync()
  const { theme } = useTheme()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  
  const timelineEntries = createMemo(() => {
    const msgs = messages()
    return msgs.flatMap((message, idx) => {
      if (message.role !== "user" && message.role !== "assistant") {
        return []
      }

      const parts = sync.data.part[message.id] ?? []
      const turn = deriveTurnSurface(message, parts, { previewLength: 40 })
      const ceremony = deriveTurnCeremony({
        message,
        parts,
        messages: msgs,
        partsByMessage: sync.data.part,
      })
      return [
        {
          id: message.id,
          turnNumber: idx + 1,
          preview: turn.preview,
          role: turn.role,
          roleLabel: turn.roleLabel,
          ceremonyRoleLabel: ceremony.roleLabel,
          traceLabel: ceremony.detail ?? turn.traceLabel,
          statusLabel: ceremony.label ?? turn.statusLabel,
          ceremony: Boolean(ceremony.label),
          timeLabel: Locale.todayTimeOrDateTime(turn.timestamp).split(" ").pop() ?? "",
          color: turn.role === "user" ? theme.primary : theme.textMuted,
          statusColor:
            ceremony.label
              ? theme.accent
              : turn.status === "error"
                ? theme.error
                : turn.status === "truncated"
                  ? theme.warning
                  : theme.textMuted,
        },
      ]
    })
  })

  const handleMove = (messageID: string) => {
    if (props.onMove) {
      props.onMove(messageID)
    }
  }

  function setEntryBackground(value: unknown, color: RGBA | undefined) {
    if (!value || typeof value !== "object" || !("backgroundColor" in value)) return
    const target = value as { backgroundColor?: unknown }
    target.backgroundColor = color
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box flexDirection="column" gap={0}>
      <For each={timelineEntries()}>
        {(entry) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return (
            <box
              flexDirection="row"
              gap={1}
              alignItems="center"
              onMouseDown={() => handleMove(entry.id)}
              onMouseOver={(event: { target: unknown }) => {
                setEntryBackground(event.target, entry.ceremony ? theme.backgroundMenu : theme.backgroundElement)
              }}
              onMouseOut={(event: { target: unknown }) => {
                setEntryBackground(event.target, entry.ceremony ? theme.backgroundElement : undefined)
              }}
              paddingTop={0}
              paddingBottom={0}
              paddingLeft={0}
              paddingRight={1}
            >
              {/* Turn number */}
              <text
                fg={theme.textMuted}
                flexShrink={0}
                style={{ width: 2 }}
              >
                {entry.turnNumber}
              </text>
              
              {/* Timeline line */}
              <box flexDirection="column" alignItems="center" flexShrink={0}>
                <text
                  fg={entry.ceremony ? theme.accent : entry.color}
                >
                  {entry.ceremony ? "◈" : entry.role === "user" ? "↗" : "•"}
                </text>
              </box>
            
            {/* Role indicator and preview */}
             <box flexDirection="column" gap={0} flexGrow={1}>
               <text
                 fg={entry.ceremony ? theme.accent : entry.color}
                 attributes={TextAttributes.BOLD}
               >
                {entry.ceremony ? entry.ceremonyRoleLabel ?? entry.roleLabel : entry.roleLabel}
               </text>
               <text
                 fg={theme.textMuted}
                 wrapMode="none"
               >
                 {entry.traceLabel}
               </text>
            </box>
            
            {/* Status */}
            <text fg={entry.statusColor} flexShrink={0} style={{ width: 8 }}>
              [{entry.statusLabel}]
            </text>
            
            {/* Timestamp */}
            <text
              fg={theme.textMuted}
              flexShrink={0}
              style={{ width: 7 }}
            >
              {entry.timeLabel}
            </text>
            </box>
          )
        }}
      </For>
      
      <Show when={timelineEntries().length === 0}>
        <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
          <text fg={theme.textMuted}>No messages in this session yet.</text>
        </box>
      </Show>
    </box>
  )
}
