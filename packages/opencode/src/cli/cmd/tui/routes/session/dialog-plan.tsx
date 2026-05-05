import { createMemo, onMount, Show } from "solid-js"
import { useSync, getRootSessionID } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "@tui/ui/toast"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"

export function DialogPlan(props: { sessionID: string }) {
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()

  onMount(() => {
    dialog.setSize("medium")
  })

  const rootSessionID = createMemo(() => getRootSessionID(sync.data.session, props.sessionID))
  const planState = createMemo(() => sync.data.plan_state?.[rootSessionID()])
  const plannerPreview = createMemo(() => sync.data.planner_preview?.[rootSessionID()])
  const workgraph = createMemo(() => sync.data.workgraph?.[rootSessionID()])

  const modeLabel = createMemo(() => {
    const state = planState()
    if (!state) return "No Plan"
    switch (state.mode) {
      case "planning":
        return "Planning"
      case "awaiting_approval":
        return "Awaiting Approval"
      case "approved":
        return "Approved"
    }
  })

  const plannerModeLabel = createMemo(() => {
    const preview = plannerPreview()
    if (!preview) return undefined
    switch (preview.mode) {
      case "plan":
        return "Planning"
      case "build":
        return "Building"
    }
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const state = planState()
    const result: DialogSelectOption<string>[] = []

    if (state?.approvedPlanPath) {
      result.push({
        title: "Approved Plan",
        value: "approved",
        description: state.approvedPlanPath,
        onSelect: () => {
          void (async () => {
            if (!state.approvedPlanPath) return
            await Clipboard.copy(state.approvedPlanPath)
            toast.show({ variant: "success", message: "Copied approved plan path" })
            dialog.clear()
          })()
        },
      })
    }

    if (state?.pendingPlanPath) {
      result.push({
        title: "Pending Plan",
        value: "pending",
        description: state.pendingPlanPath,
        onSelect: () => {
          void (async () => {
            if (!state.pendingPlanPath) return
            await Clipboard.copy(state.pendingPlanPath)
            toast.show({ variant: "success", message: "Copied pending plan path" })
            dialog.clear()
          })()
        },
      })
    }

    if (state?.feedback) {
      result.push({
        title: "Feedback",
        value: "feedback",
        description: state.feedback.length > 50 ? state.feedback.slice(0, 50) + "..." : state.feedback,
        onSelect: () => {
          void (async () => {
            if (!state.feedback) return
            await Clipboard.copy(state.feedback)
            toast.show({ variant: "success", message: "Copied feedback" })
            dialog.clear()
          })()
        },
      })
    }

    const preview = plannerPreview()
    if (preview?.planPath) {
      result.push({
        title: "Planner Preview",
        value: "planner-preview",
        description: preview.planPath + (preview.hint ? ` — ${preview.hint}` : ""),
        onSelect: () => {
          void (async () => {
            await Clipboard.copy(preview.planPath!)
            toast.show({ variant: "success", message: "Copied plan path" })
            dialog.clear()
          })()
        },
      })
    }

    return result
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Plan
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box paddingTop={1} flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>Status:</text>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            {modeLabel()}
          </text>
        </box>
        <Show when={plannerPreview()}>
          <box paddingTop={1} flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>Planner:</text>
            <text fg={theme.textMuted}>{plannerModeLabel()}</text>
            <Show when={plannerPreview()?.hint}>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>{plannerPreview()?.hint}</text>
            </Show>
          </box>
        </Show>
        <Show when={workgraph()}>
          <box paddingTop={1} flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>Workgraph:</text>
            <text fg={theme.textMuted}>
              {workgraph()!.objectiveCount} obj
              {workgraph()!.activeObjectiveCount > 0 ? ` (${workgraph()!.activeObjectiveCount} active)` : ""}
              , {workgraph()!.laneCount} lane{workgraph()!.laneCount !== 1 ? "s" : ""}
            </text>
          </box>
        </Show>
      </box>
      <Show
        when={options().length > 0}
        fallback={
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          <box paddingLeft={4} paddingRight={4} paddingTop={2}>
            <text fg={theme.textMuted}>No plan data available yet.</text>
            <text fg={theme.textMuted} paddingTop={1}>Plan files, hints, and approval state will appear here once planning starts.</text>
          </box>
        }
      >
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.textMuted}>Select to copy</text>
        </box>
        <box paddingLeft={2} paddingRight={2}>
          <DialogSelect title="" placeholder="Search" options={options()} skipFilter={true} />
        </box>
      </Show>
      <Show when={planState()?.updatedAt}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>
            Updated {new Date(planState()?.updatedAt ?? 0).toLocaleTimeString()}
          </text>
        </box>
      </Show>
    </box>
  )
}
