import { createMemo, Show, For } from "solid-js"
import { useSync, getRootSessionID } from "@tui/context/sync"
import { useTheme } from "../../context/theme"
import { TextAttributes } from "@opentui/core"
import type { TrackerTask } from "@/tracker/types"
import { SkillRegistry } from "@/skill/registry"
import { DialogTracker } from "./dialog-tracker"
import { useDialog } from "../../ui/dialog"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "@tui/ui/toast"

export function SplitView(props: { sessionID: string; onClose: () => void }) {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()

  const rootSessionID = createMemo(() => getRootSessionID(sync.data.session, props.sessionID))
  const trackerSummary = createMemo(() => sync.data.tracker_summary[rootSessionID()])

  // Compact tracker preview for split view
  const recentTasks = createMemo(() => {
    const summary = trackerSummary()
    const tasks = summary?.tasks ?? summary?.latestTasks ?? []
    const priority: Record<string, number> = { blocked: 0, in_progress: 1, open: 2, closed: 3 }
    // Show blocked and in_progress first, then recent open tasks
    return tasks
      .sort((a, b) => {
        return (priority[a.status] ?? 4) - (priority[b.status] ?? 4)
      })
      .slice(0, 8)
  })

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
      case "bug":
        return "◉"
      default:
        return "▸"
    }
  }

  const openTrackerDialog = () => {
    dialog.replace(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      () => <DialogTracker sessionID={props.sessionID} />,
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const emptyTasksFallback = (
    <box paddingTop={2}>
      <text fg={theme.textMuted}>No tracked tasks yet.</text>
      <text fg={theme.textMuted} paddingTop={1}>Tasks will appear here once created.</text>
    </box>
  )

  const copyTask = async (task: TrackerTask) => {
    let text = `${task.id}: ${task.title}`
    if (task.results) text += `\nResults: ${JSON.stringify(task.results, null, 2)}`
    if (task.artifacts) text += `\nArtifacts: ${task.artifacts.join(", ")}`
    await Clipboard.copy(text)
    toast.show({ variant: "success", message: "Copied task details" })
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={50}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      border={["left"]}
      borderColor={theme.border}
    >
      <scrollbox
        flexGrow={1}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.background,
            foregroundColor: theme.borderActive,
          },
        }}
      >
        <box flexShrink={0} gap={1} paddingRight={1}>
          {/* Header */}
          <box flexDirection="row" justifyContent="space-between" alignItems="center">
            <box flexDirection="row" gap={1}>
              <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                ✦ Tracker
              </text>
              <Show when={trackerSummary()}>
                <text fg={theme.textMuted}>
                  ({trackerSummary()?.taskCount ?? 0} total • {trackerSummary()?.inProgressCount ?? 0} active •{" "}
                  {trackerSummary()?.blockedCount ?? 0} blocked)
                </text>
              </Show>
            </box>
            <box flexDirection="row" gap={1}>
              <text
                fg={theme.primary}
                onMouseUp={openTrackerDialog}
              >
                [full]
              </text>
              <text fg={theme.error} onMouseUp={props.onClose}>
                ✕
              </text>
            </box>
          </box>

          {/* Summary Stats */}
          <Show when={trackerSummary()}>
            <box flexDirection="row" gap={2} paddingTop={1}>
              <text fg={statusColor("open")}>
                {statusIcon("open")} {trackerSummary()?.openCount ?? 0} open
              </text>
              <text fg={statusColor("in_progress")}>
                {statusIcon("in_progress")} {trackerSummary()?.inProgressCount ?? 0} active
              </text>
              <text fg={statusColor("blocked")}>
                {statusIcon("blocked")} {trackerSummary()?.blockedCount ?? 0} blocked
              </text>
              <Show when={(trackerSummary()?.closedCount ?? 0) > 0}>
                <text fg={statusColor("closed")}>
                  {statusIcon("closed")} {trackerSummary()?.closedCount ?? 0} closed
                </text>
              </Show>
            </box>
          </Show>

          {/* Tasks List */}
          <Show
            when={recentTasks().length > 0}
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            fallback={emptyTasksFallback}
          >
            <box paddingTop={1} flexDirection="column" gap={0}>
              <For each={recentTasks()}>
                {(task) => {
                  const resultCount = task.results ? Object.keys(task.results).length : 0
                  const artifactCount = task.artifacts?.length ?? 0
                  const skillText = task.requiredSkills?.map((skill) => (SkillRegistry.isLoaded(skill) ? skill : `?${skill}`)).join(", ")
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                  return (
                    <box
                      flexDirection="column"
                      gap={0}
                      paddingTop={1}
                      paddingBottom={1}
                      onMouseUp={() => copyTask(task)}
                      backgroundColor={theme.backgroundElement}
                    >
                      <box flexDirection="row" justifyContent="space-between">
                        <text fg={theme.text} wrapMode="none">
                          {typeIcon(task.type)} {task.title}
                        </text>
                        <text fg={statusColor(task.status)} flexShrink={0}>
                          {statusIcon(task.status)}
                        </text>
                      </box>
                      <Show when={task.dependencies.length > 0 || resultCount > 0}>
                        <box flexDirection="row" gap={2} paddingTop={0}>
                          <Show when={task.dependencies.length > 0}>
                            <text fg={theme.textMuted}>
                              {task.dependencies.length} dep{task.dependencies.length > 1 ? "s" : ""}
                            </text>
                          </Show>
                          <Show when={resultCount > 0}>
                            <text fg={theme.textMuted}>
                              {resultCount} result{resultCount > 1 ? "s" : ""}
                            </text>
                          </Show>
                          <Show when={artifactCount > 0}>
                            <text fg={theme.textMuted}>
                              {artifactCount} artifact{artifactCount > 1 ? "s" : ""}
                            </text>
                          </Show>
                        </box>
                      </Show>
                      <Show when={skillText}>
                        <box paddingTop={0}>
                          <text fg={theme.textMuted}>🎯 {skillText}</text>
                        </box>
                      </Show>
                    </box>
                  )
                }}
              </For>
            </box>
          </Show>

          {/* Legend */}
          <box paddingTop={1}>
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              Legend:
            </text>
            <box flexDirection="row" gap={2} paddingTop={0}>
              <text fg={theme.success}>✓ Closed</text>
              <text fg={theme.accent}>◐ Active</text>
              <text fg={theme.error}>⊘ Blocked</text>
              <text fg={theme.textMuted}>○ Open</text>
            </box>
          </box>

          <box paddingTop={1}>
            <text fg={theme.textMuted}>
              Click task to copy • [full] for detailed view
            </text>
          </box>
        </box>
      </scrollbox>
    </box>
  )
}
