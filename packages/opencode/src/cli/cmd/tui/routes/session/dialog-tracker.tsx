import { createMemo, createSignal, onMount, Show, For } from "solid-js"
import { useSync, getRootSessionID } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "@tui/ui/toast"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import type { TrackerTask } from "@/tracker/types"
import { SkillRegistry } from "@/skill/registry"

interface DagNode extends TrackerTask {
  level: number
  columnIndex: number
  rowOffset: number
}

interface DagLayout {
  nodes: DagNode[]
  levels: number
  maxColumnWidth: number
}

function topologicalSortWithLevels(tasks: TrackerTask[]): DagLayout {
  if (tasks.length === 0) {
    return { nodes: [], levels: 0, maxColumnWidth: 0 }
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]))
  const levels = new Map<string, number>()
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  tasks.forEach((task) => {
    inDegree.set(task.id, 0)
    adjacency.set(task.id, [])
  })

  tasks.forEach((task) => {
    task.dependencies.forEach((depId) => {
      if (taskMap.has(depId)) {
        const dependents = adjacency.get(depId) || []
        dependents.push(task.id)
        adjacency.set(depId, dependents)
        inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1)
      }
    })
  })

  const queue: string[] = []
  tasks.forEach((task) => {
    if ((inDegree.get(task.id) || 0) === 0) {
      queue.push(task.id)
      levels.set(task.id, 0)
    }
  })

  let maxLevel = 0
  const sorted: string[] = []

  while (queue.length > 0) {
    const currentId = queue.shift()!
    sorted.push(currentId)
    const currentLevel = levels.get(currentId) || 0

    const dependents = adjacency.get(currentId) || []
    dependents.forEach((depId) => {
      inDegree.set(depId, (inDegree.get(depId) || 0) - 1)
      const newLevel = currentLevel + 1
      const existingLevel = levels.get(depId) || 0
      levels.set(depId, Math.max(existingLevel, newLevel))
      maxLevel = Math.max(maxLevel, levels.get(depId) || 0)

      if ((inDegree.get(depId) || 0) === 0) {
        queue.push(depId)
      }
    })
  }

  const levelGroups = new Map<number, string[]>()
  sorted.forEach((id) => {
    const level = levels.get(id) || 0
    const group = levelGroups.get(level) || []
    group.push(id)
    levelGroups.set(level, group)
  })

  const nodes: DagNode[] = []
  let maxColumnWidth = 0

  for (let level = 0; level <= maxLevel; level++) {
    const idsAtLevel = levelGroups.get(level) || []
    idsAtLevel.forEach((id, index) => {
      const task = taskMap.get(id)!
      const node: DagNode = {
        ...task,
        level,
        columnIndex: index,
        rowOffset: 0,
      }
      nodes.push(node)
    })
    maxColumnWidth = Math.max(maxColumnWidth, idsAtLevel.length)
  }

  return {
    nodes,
    levels: maxLevel + 1,
    maxColumnWidth,
  }
}

function renderDagNode(node: DagNode, theme: any, pulsePhase: number): string {
  const statusColors: Record<string, string> = {
    closed: theme.success,
    in_progress: theme.accent,
    blocked: theme.error,
    open: theme.textMuted,
  }

  const statusIcons: Record<string, string> = {
    closed: "✓",
    in_progress: "◐",
    blocked: "⊘",
    open: "○",
  }

  const typeIcons: Record<string, string> = {
    epic: "◆",
    task: "▸",
    bug: "◉",
  }

  const color = statusColors[node.status] || theme.text
  const statusIcon = statusIcons[node.status] || "○"
  const typeIcon = typeIcons[node.type] || "•"

  const pulseIntensity = node.status === "in_progress" ? Math.sin(pulsePhase + node.level * 0.5) * 0.3 + 0.7 : 1

  const maxWidth = 32
  let title = node.title
  if (title.length > maxWidth - 4) {
    title = title.substring(0, maxWidth - 7) + "..."
  }

  const topBorder = "╭" + "─".repeat(maxWidth - 2) + "╮"
  const bottomBorder = "╰" + "─".repeat(maxWidth - 2) + "╯"
  const detailLine = (prefix: string, value: string) => {
    const contentWidth = maxWidth - 4
    const text = `${prefix} ${value}`
    return "│ " + text.slice(0, contentWidth).padEnd(contentWidth) + " │"
  }

  const decoratedTitle = `${typeIcon} ${title} ${statusIcon}`
  const padding = maxWidth - 2 - decoratedTitle.length
  const contentLine = "│ " + decoratedTitle + " ".repeat(Math.max(0, padding)) + " │"

  const detailLines: string[] = []
  if (node.requiredSkills && node.requiredSkills.length > 0) {
    const skillStatus = node.requiredSkills.map(s => SkillRegistry.isLoaded(s) ? s : `?${s}`).join(", ")
    detailLines.push(detailLine("🎯", skillStatus))
  }

  if (node.dependencies && node.dependencies.length > 0) {
    detailLines.push(detailLine("⟶", `${node.dependencies.length} dep(s)`))
  }

  if (detailLines.length > 0) {
    return `${topBorder}\n${contentLine}\n${detailLines.join("\n")}\n${bottomBorder}`
  }
  return `${topBorder}\n${contentLine}\n${bottomBorder}`
}

function renderDagConnections(nodes: DagNode[], theme: any): string[] {
  const lines: string[] = []
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  const levelGroups = new Map<number, DagNode[]>()
  nodes.forEach((node) => {
    const group = levelGroups.get(node.level) || []
    group.push(node)
    levelGroups.set(node.level, group)
  })

  const maxLevel = nodes.reduce((max, n) => Math.max(max, n.level), 0)
  
  for (let level = 0; level < maxLevel; level++) {
    const currentLevel = levelGroups.get(level) || []
    const nextLevel = levelGroups.get(level + 1) || []

    // Draw vertical connectors from each node in current level
    currentLevel.forEach((source) => {
      // Check if this node has dependents in the next level
      const hasDependents = nextLevel.some(target => target.dependencies.includes(source.id))
      
      if (hasDependents) {
        // Draw downward connector
        const col = source.columnIndex * 34
        const connector = " ".repeat(col) + "│"
        lines.push(connector)
      }
    })
    
    // Draw horizontal connectors between levels
    currentLevel.forEach((source) => {
      nextLevel.forEach((target) => {
        if (target.dependencies.includes(source.id)) {
          const sourceCol = source.columnIndex * 34
          const targetCol = target.columnIndex * 34
          const colDiff = targetCol - sourceCol
          
          if (colDiff > 0) {
            // Connector goes right
            lines.push(" ".repeat(sourceCol + 16) + "┌" + "─".repeat(colDiff - 1) + "┐")
          } else if (colDiff < 0) {
            // Connector goes left  
            lines.push(" ".repeat(targetCol + 16) + "└" + "─".repeat(Math.abs(colDiff) - 1) + "┘")
          } else {
            // Same column - direct vertical
            lines.push(" ".repeat(sourceCol + 16) + "│")
          }
        }
      })
    })
  }

  return lines
}

export function DialogTracker(props: { sessionID: string }) {
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [viewMode, setViewMode] = createSignal<"list" | "dag">("list")
  const [pulsePhase, setPulsePhase] = createSignal(0)
  const [filterText, setFilterText] = createSignal("")
  const [statusFilter, setStatusFilter] = createSignal<"all" | "open" | "in_progress" | "blocked" | "closed">("all")

  onMount(() => {
    dialog.setSize("large")

    let animationFrame: number
    const animate = () => {
      setPulsePhase((prev) => prev + 0.15)
      animationFrame = requestAnimationFrame(animate)
    }
    animationFrame = requestAnimationFrame(animate)

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame)
      }
    }
  })

  useKeyboard((evt) => {
    if (evt.ctrl || evt.meta || !evt.name) return
    const key = evt.name.toLowerCase()
    if (key === "l") {
      setViewMode("list")
      return
    }
    if (key === "d") {
      setViewMode("dag")
      return
    }
    if (viewMode() !== "list") return
    if (key === "a") setStatusFilter("all")
    else if (key === "o") setStatusFilter("open")
    else if (key === "i") setStatusFilter("in_progress")
    else if (key === "b") setStatusFilter("blocked")
    else if (key === "c") setStatusFilter("closed")
  })

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

  const statusLabel = (status: string) => {
    switch (status) {
      case "in_progress":
        return "in progress"
      default:
        return status
    }
  }

  const dagLayout = createMemo(() => {
    const summary = trackerSummary()
    const tasks = summary?.tasks ?? summary?.latestTasks ?? []
    return topologicalSortWithLevels(tasks)
  })

  const taskOptions = createMemo((): DialogSelectOption<string>[] => {
    const summary = trackerSummary()
    // Use full tasks if available, otherwise fall back to latestTasks
    const tasks = summary?.tasks ?? summary?.latestTasks ?? []
    if (!tasks.length) return []

    // Filter tasks by status
    let filteredTasks = tasks
    if (statusFilter() !== "all") {
      filteredTasks = filteredTasks.filter((task) => task.status === statusFilter())
    }

    // Filter tasks by text search
    const searchText = filterText().toLowerCase()
    if (searchText) {
      filteredTasks = filteredTasks.filter(
        (task) =>
          task.title.toLowerCase().includes(searchText) ||
          task.id.toLowerCase().includes(searchText) ||
          task.description.toLowerCase().includes(searchText)
      )
    }

    // Sort tasks: blocked first, then in_progress, then open, then closed
    const sortedTasks = [...filteredTasks].sort((a, b) => {
      const priority = { blocked: 0, in_progress: 1, open: 2, closed: 3 }
      return (priority[a.status as keyof typeof priority] ?? 4) - (priority[b.status as keyof typeof priority] ?? 4)
    })

    return sortedTasks.map((task) => {
      const typeIcon = task.type === "epic" ? "◆" : task.type === "task" ? "▸" : task.type === "bug" ? "◉" : "•"
      const statusIcon = task.status === "blocked" ? "⊘" : task.status === "in_progress" ? "◐" : task.status === "closed" ? "✓" : "○"
      const deps = task.dependencies.length > 0 ? ` · ${task.dependencies.length} dep${task.dependencies.length > 1 ? "s" : ""}` : ""
      const results = task.results && Object.keys(task.results).length > 0 ? ` · ${Object.keys(task.results).length} res` : ""
      const artifacts = task.artifacts && task.artifacts.length > 0 ? ` · ${task.artifacts.length} art` : ""
      const parent = task.parentId ? " · subtask" : ""
      
      return {
        title: `${typeIcon} ${task.title}`,
        value: task.id,
        description: `${statusIcon} ${statusLabel(task.status)}${deps}${results}${artifacts}${parent}`,
        footer: task.id.slice(0, 6),
        onSelect: async () => {
          let text = `${task.id}: ${task.title}`
          if (task.results) text += `\nResults: ${JSON.stringify(task.results, null, 2)}`
          if (task.artifacts) text += `\nArtifacts: ${task.artifacts.join(", ")}`
          await Clipboard.copy(text)
          toast.show({ variant: "success", message: "Copied task details" })
          dialog.clear()
        },
      }
    })
  })

  const copyTrackerPath = async () => {
    const summary = trackerSummary()
    if (!summary?.trackerPath) return
    await Clipboard.copy(summary.trackerPath)
    toast.show({ variant: "success", message: "Copied tracker path" })
    dialog.clear()
  }

  const SummaryMetric = (props: { label: string; value: number; color?: any }) => (
    <box flexDirection="row" gap={1}>
      <text fg={theme.textMuted}>{props.label}:</text>
      <text fg={props.color ?? theme.text} attributes={TextAttributes.BOLD}>
        {String(props.value)}
      </text>
    </box>
  )

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" gap={2}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Tracker
            </text>
            <text fg={theme.textMuted}>|</text>
            <box flexDirection="row" gap={1}>
              <text 
                fg={viewMode() === "list" ? theme.accent : theme.textMuted} 
                attributes={viewMode() === "list" ? TextAttributes.BOLD : undefined}
                onMouseUp={() => { setViewMode("list") }}
              >
                [L]ist
              </text>
              <text fg={theme.textMuted}>/</text>
              <text 
                fg={viewMode() === "dag" ? theme.accent : theme.textMuted} 
                attributes={viewMode() === "dag" ? TextAttributes.BOLD : undefined}
                onMouseUp={() => { setViewMode("dag") }}
              >
                [D]AG
              </text>
            </box>
          </box>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
      </box>
      <Show
        when={trackerSummary()}
        fallback={
          <box paddingLeft={4} paddingRight={4} paddingTop={2}>
            <text fg={theme.textMuted}>No tasks tracked yet.</text>
            <text fg={theme.textMuted} paddingTop={1}>Tasks will appear here once created.</text>
          </box>
        }
      >
        {(summary) => (
          <>
            <box paddingLeft={4} paddingRight={4} gap={2} flexDirection="row">
              <SummaryMetric label="Total" value={summary().taskCount} />
              <SummaryMetric label="Open" value={summary().openCount} color={statusColor("open")} />
              <SummaryMetric label="In Progress" value={summary().inProgressCount} color={statusColor("in_progress")} />
              <SummaryMetric label="Blocked" value={summary().blockedCount} color={statusColor("blocked")} />
              <SummaryMetric label="Closed" value={summary().closedCount} color={statusColor("closed")} />
            </box>
            <box paddingLeft={4} paddingRight={4}>
              <text fg={theme.textMuted}>Path: </text>
              <text fg={theme.text}>{summary().trackerPath}</text>
              <text fg={theme.primary} onMouseUp={() => { void copyTrackerPath() }}>
                {" [copy]"}
              </text>
            </box>

            <Show when={viewMode() === "dag"}>
              <box paddingLeft={2} paddingRight={2} paddingTop={2} flexDirection="column">
                <Show when={dagLayout().nodes.length > 0} fallback={
                  <text fg={theme.textMuted}>No tasks to visualize</text>
                }>
                  <box flexDirection="row" gap={4} flexWrap="wrap">
                    <For each={dagLayout().nodes}>
                      {(node) => (
                        <box>
                          <text fg={statusColor(node.status)}>
                            {renderDagNode(node, theme, pulsePhase())}
                          </text>
                        </box>
                      )}
                    </For>
                  </box>
                  <box paddingTop={2} paddingLeft={2}>
                    <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                      Legend:
                    </text>
                    <box flexDirection="row" gap={3} paddingTop={1}>
                      <text fg={theme.success}>✓ Closed</text>
                      <text fg={theme.accent}>◐ In Progress</text>
                      <text fg={theme.error}>⊘ Blocked</text>
                      <text fg={theme.textMuted}>○ Open</text>
                    </box>
                  </box>
                </Show>
              </box>
            </Show>

            <Show when={viewMode() === "list"}>
              <Show when={taskOptions().length > 0}>
                <box paddingLeft={4} paddingRight={4} paddingTop={1}>
                  <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                    Tasks ({taskOptions().length})
                  </text>
                </box>
                <box paddingLeft={4} paddingRight={4}>
                  <text fg={theme.textMuted}>Select to copy reference</text>
                </box>
                <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1} flexDirection="row">
                  <text fg={theme.textMuted}>Status:</text>
                  <text 
                    fg={statusFilter() === "all" ? theme.accent : theme.textMuted} 
                    attributes={statusFilter() === "all" ? TextAttributes.BOLD : undefined}
                    onMouseUp={() => { setStatusFilter("all") }}
                  >
                    [A]ll
                  </text>
                  <text fg={theme.textMuted}>/</text>
                  <text 
                    fg={statusFilter() === "open" ? theme.accent : theme.textMuted} 
                    attributes={statusFilter() === "open" ? TextAttributes.BOLD : undefined}
                    onMouseUp={() => { setStatusFilter("open") }}
                  >
                    [O]pen
                  </text>
                  <text fg={theme.textMuted}>/</text>
                  <text 
                    fg={statusFilter() === "in_progress" ? theme.accent : theme.textMuted} 
                    attributes={statusFilter() === "in_progress" ? TextAttributes.BOLD : undefined}
                    onMouseUp={() => { setStatusFilter("in_progress") }}
                  >
                    [I]n Progress
                  </text>
                  <text fg={theme.textMuted}>/</text>
                  <text 
                    fg={statusFilter() === "blocked" ? theme.accent : theme.textMuted} 
                    attributes={statusFilter() === "blocked" ? TextAttributes.BOLD : undefined}
                    onMouseUp={() => { setStatusFilter("blocked") }}
                  >
                    [B]locked
                  </text>
                  <text fg={theme.textMuted}>/</text>
                  <text 
                    fg={statusFilter() === "closed" ? theme.accent : theme.textMuted} 
                    attributes={statusFilter() === "closed" ? TextAttributes.BOLD : undefined}
                    onMouseUp={() => { setStatusFilter("closed") }}
                  >
                    [C]losed
                  </text>
                </box>
                <box paddingLeft={2} paddingRight={2}>
                  <DialogSelect title="" placeholder="Filter tasks" options={taskOptions()} />
                </box>
              </Show>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}
