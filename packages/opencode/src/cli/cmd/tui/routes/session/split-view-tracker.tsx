import { createMemo, For, Show } from "solid-js"
import { useSync, getRootSessionID } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { SkillRegistry } from "@/skill/registry"

export function SplitViewTracker(props: { sessionID: string; maxHeight?: number }) {
  const sync = useSync()
  const { theme } = useTheme()

  const rootSessionID = createMemo(() => getRootSessionID(sync.data.session, props.sessionID))
  const trackerSummary = createMemo(() => sync.data.tracker_summary[rootSessionID()])

  const statusColor = (status: string) => {
    switch (status) {
      case "open":
        return theme.textMuted
      case "in_progress":
        return theme.accent
      case "blocked":
        return theme.error
      case "closed":
        return theme.success
      default:
        return theme.text
    }
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "closed":
        return "✓"
      case "in_progress":
        return "◐"
      case "blocked":
        return "⊘"
      default:
        return "○"
    }
  }

  const typeIcon = (type: string) => {
    switch (type) {
      case "epic":
        return "◆"
      case "task":
        return "▸"
      case "bug":
        return "◉"
      default:
        return "•"
    }
  }

  const tasks = createMemo(() => {
    const summary = trackerSummary()
    return summary?.tasks ?? summary?.latestTasks ?? []
  })

  const maxDisplayTasks = props.maxHeight ? Math.floor((props.maxHeight - 4) / 3) : 10
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const emptyTasksFallback = (
    <box paddingLeft={1} paddingRight={1} paddingTop={1}>
      <text fg={theme.textMuted}>No tasks yet</text>
    </box>
  )

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box flexDirection="column" gap={0}>
      <box paddingLeft={1} paddingRight={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Tracker
        </text>
        <text fg={theme.textMuted}>
          {" "}
          | {tasks().length} task{tasks().length !== 1 ? "s" : ""}
        </text>
      </box>
      <box paddingLeft={1} paddingRight={1} gap={2} flexDirection="row">
        <text fg={statusColor("open")}>○ {trackerSummary()?.openCount ?? 0}</text>
        <text fg={statusColor("in_progress")}>◐ {trackerSummary()?.inProgressCount ?? 0}</text>
        <text fg={statusColor("blocked")}>⊘ {trackerSummary()?.blockedCount ?? 0}</text>
        <text fg={statusColor("closed")}>✓ {trackerSummary()?.closedCount ?? 0}</text>
      </box>
      <Show
        when={tasks().length > 0}
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        fallback={emptyTasksFallback}
      >
        <box flexDirection="column" gap={0} paddingTop={1}>
          <For each={tasks().slice(0, maxDisplayTasks)}>
            {(task) => {
              const skillText = task.requiredSkills?.map((skill) => (SkillRegistry.isLoaded(skill) ? skill : `?${skill}`)).join(", ")
              // eslint-disable-next-line @typescript-eslint/no-unsafe-return
              return (
                <box paddingLeft={1} paddingRight={1}>
                  <text fg={statusColor(task.status)}>
                    {typeIcon(task.type)} {task.title} {statusIcon(task.status)}
                  </text>
                  <Show when={skillText}>
                    <text fg={theme.textMuted} paddingLeft={2}>
                      🎯 {skillText}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={tasks().length > maxDisplayTasks}>
            <box paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>+ {tasks().length - maxDisplayTasks} more...</text>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}
