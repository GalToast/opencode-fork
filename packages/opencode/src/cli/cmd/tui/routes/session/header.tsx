import { createMemo, createSignal, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useRouteData } from "@tui/context/route"
import { listSessionDescendants, useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { NoBorderLeft, SplitBorderLeft } from "@tui/component/border"
import { useCommandDialog } from "@tui/component/dialog-command"
import { type SessionState } from "../../component/status-indicator"
import type { Message, PermissionRequest, Provider, QuestionRequest } from "@opencode-ai/sdk/v2"
import { useKV } from "../../context/kv"
import { ThinkingIndicator } from "../../component/thinking-indicator"
import type { SignalMode } from "../../component/spinner"
import { RGBA } from "@opentui/core"
import { deriveSessionForegroundSurface } from "../../util/prompt-status"
import { buildModelContextSummary } from "./sidebar-state"
import {
  countRecentShellSignals,
  resolveSessionMessageScope,
  deriveShellPosture,
  deriveShellSurfaceNarrative,
  deriveRecentShellEvent,
  deriveShellSwarmMode,
  deriveShellWorkMode,
  deriveShellRhythm,
  useLingeringShellEvent,
  useShellChargeExchange,
  useShellClimate,
} from "./shell-signal"

type HeaderSessionStatus = {
  type: string
}

type HeaderShellPart = {
  type: string
  tool?: string
  text?: string
  state?: {
    status?: string
  } | null
}

type HeaderSession = {
  id: string
  parentID?: string
  title?: string
}

type HeaderForeground = {
  awaitingPromotion?: boolean
}

type HeaderSteerInfo = {
  stage: "received" | "applied"
  pending: number
}

type HeaderSyncContext = {
  session: {
    get(id: string): HeaderSession | undefined
  }
  data: {
    foreground?: Record<string, HeaderForeground | undefined>
    steer: Record<string, HeaderSteerInfo | undefined>
    session_status?: Record<string, HeaderSessionStatus | undefined>
    session: HeaderSession[]
    message?: Record<string, Message[] | undefined>
    permission?: Record<string, PermissionRequest[] | undefined>
    question?: Record<string, QuestionRequest[] | undefined>
    supervisor_inbox?: Record<string, unknown[] | undefined>
    provider: Provider[]
    part: Record<string, HeaderShellPart[] | undefined>
  }
}

type HeaderCommandContext = {
  trigger: (name: string) => void
}

type HeaderProps = {
  width?: number
}

export function Header(props: HeaderProps = {}) {
  const route = useRouteData("session")
  const sync = useSync() as unknown as HeaderSyncContext
  const session = createMemo(() => sync.session.get(route.sessionID))
  const foregroundSummary = createMemo(() => sync.data.foreground?.[route.sessionID])
  const kv = useKV()

  const { theme } = useTheme()
  const command = useCommandDialog() as unknown as HeaderCommandContext
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null)
  const decorativeBorders = createMemo(() => kv.get("decorative_borders", false))
  const dimensions = useTerminalDimensions()
  const railWidth = createMemo(() => Math.max(0, props.width ?? dimensions().width))

  const sessionState = createMemo<SessionState>(() => {
    const status = sync.data.session_status?.[route.sessionID]
    if (!status) return "idle"
    if (status.type === "busy") return "active"
    if (status.type === "retry") return "error"
    return "idle"
  })
  const isChildSession = createMemo(() => Boolean(session()?.parentID))
  const isThinking = createMemo(() => {
    if (isChildSession() && foregroundSummary()?.awaitingPromotion) return true
    return sessionState() === "active"
  })
  const localSessionChildren = createMemo(() =>
    listSessionDescendants(sync.data.session, route.sessionID).filter((id) => id !== route.sessionID),
  )
  const localChildCount = createMemo(() => localSessionChildren().length)
  const localActiveChildCount = createMemo(
    () =>
      localSessionChildren().filter((sessionID) => {
        const status = sync.data.session_status?.[sessionID]?.type
        return status !== undefined && status !== "idle"
      }).length,
  )
  const localFlaggedChildCount = createMemo(
    () =>
      localSessionChildren()
        .filter((sessionID) => sync.data.session_status?.[sessionID]?.type === "retry").length,
  )
  const messages = createMemo<Message[]>(
    () =>
      resolveSessionMessageScope({
        messagesBySession: sync.data.message,
        sessionID: route.sessionID,
      }).messages,
  )
  const permissionRequests = createMemo(() => sync.data.permission?.[route.sessionID] ?? [])
  const questionRequests = createMemo(() => sync.data.question?.[route.sessionID] ?? [])
  const supervisorRequests = createMemo(() => sync.data.supervisor_inbox?.[route.sessionID] ?? [])
  const pendingPermissionCount = createMemo(() => permissionRequests().length)
  const pendingQuestionCount = createMemo(() => questionRequests().length)
  const pendingSupervisorCount = createMemo(() => supervisorRequests().length)
  const pendingInboxCount = createMemo(() => pendingPermissionCount() + pendingQuestionCount() + pendingSupervisorCount())
  const steerStatus = createMemo(() => sync.data.steer?.[route.sessionID])
  const modelContext = createMemo(() =>
    buildModelContextSummary({
      messages: messages(),
      providers: sync.data.provider,
    }),
  )
  const signalPressure = createMemo<"cool" | "warm" | "hot">(() => {
    const ctx = modelContext()?.contextPercent ?? 0
    if (ctx >= 85) return "hot"
    if (ctx >= 65) return "warm"
    return "cool"
  })
  const signalIntensity = createMemo<"calm" | "active" | "crowded" | "stressed">(() => {
    if (sessionState() === "error") return "stressed"
    if (localChildCount() >= 3) return "crowded"
    if (isThinking()) return "active"
    return "calm"
  })
  const shellEvent = createMemo(() =>
    deriveRecentShellEvent({
      messages: messages(),
      partsByMessage: sync.data.part,
      awaitingPromotion: foregroundSummary()?.awaitingPromotion,
      sessionState: sessionState(),
    }),
  )
  const shellPosture = createMemo(() =>
    deriveShellPosture({
      messages: messages(),
      partsByMessage: sync.data.part,
      sessionState: sessionState(),
      childCount: localChildCount(),
      pendingPermissionCount: pendingPermissionCount(),
      pendingQuestionCount: pendingQuestionCount(),
      pendingSupervisorCount: pendingSupervisorCount(),
    }),
  )
  const shellWorkMode = createMemo<SignalMode>(() =>
    deriveShellSwarmMode({
      baseMode: deriveShellWorkMode({
        messages: messages(),
        partsByMessage: sync.data.part,
        sessionState: sessionState(),
        childCount: localChildCount(),
      }),
      activeChildCount: localActiveChildCount(),
      flaggedChildCount: localFlaggedChildCount,
    }),
  )
  const shellCounts = createMemo(() => countRecentShellSignals({ messages: messages(), partsByMessage: sync.data.part }))
  const shellEventState = useLingeringShellEvent(shellEvent, 5200)
  const shellClimate = useShellClimate({
    event: createMemo(() => shellEventState().event),
    eventPhase: createMemo(() => shellEventState().phase),
    basePressure: signalPressure,
    baseIntensity: signalIntensity,
    childCount: localChildCount,
    recentInterrupts: createMemo(() => shellCounts().interrupts),
    recentReturns: createMemo(() => shellCounts().returns),
    recentHandoffs: createMemo(() => shellCounts().handoffs),
    retrying: createMemo(() => sessionState() === "error"),
    externalLoad: createMemo(
      () => pendingPermissionCount() + pendingQuestionCount() + pendingSupervisorCount() + localFlaggedChildCount(),
    ),
  })
  const recentCompletionAt = createMemo(() => messages().findLast((item) => item.role === "assistant")?.time?.completed)
  const shellCharge = useShellChargeExchange({
    active: isThinking,
    recentCompletionAt,
    climateHeat: createMemo(() => shellClimate().heat),
  })
  const shellNarrative = createMemo(() =>
    deriveShellSurfaceNarrative({
      event: shellEventState().event,
      posture: shellPosture(),
      pressure: shellClimate().pressure,
      weather: shellClimate().weather,
      childCount: localChildCount(),
      activeChildCount: localActiveChildCount(),
      pendingPermissionCount: pendingPermissionCount(),
      pendingQuestionCount: pendingQuestionCount(),
      pendingSupervisorCount: pendingSupervisorCount(),
      sessionState: sessionState(),
      isChildSession: isChildSession(),
    }),
  )
  const foregroundSurface = createMemo(() =>
    deriveSessionForegroundSurface({
      statusType: sessionState() === "error" ? "retry" : sync.data.session_status?.[route.sessionID]?.type ?? "idle",
      pendingInboxCount: pendingInboxCount(),
      pendingPermissionCount: pendingPermissionCount(),
      pendingQuestionCount: pendingQuestionCount(),
      pendingSupervisorCount: pendingSupervisorCount(),
      steerPending: steerStatus()?.pending ?? 0,
      steerStage: steerStatus()?.stage,
      hasPendingAssistant: isThinking(),
      submitLabel: isThinking() ? "steer" : "send",
      contextPercent: modelContext()?.contextPercent,
      childCount: localChildCount(),
      isChildSession: isChildSession(),
    }),
  )
  const shellRhythm = createMemo(() =>
    deriveShellRhythm({
      event: shellEventState().event,
      eventPhase: shellEventState().phase,
      eventDecay: shellEventState().decay,
      chargePhase: shellCharge().phase,
      chargeValue: shellCharge().value,
      climateHeat: shellClimate().heat,
      pressure: shellClimate().pressure,
      posture: shellPosture(),
    }),
  )
  const shellWeatherBg = createMemo(() => {
    const event = shellEventState().event
    const phase = shellEventState().phase
    const rhythm = shellRhythm()
    if (event === "accepted_baton") return RGBA.fromInts(22, 36, 58, phase === "live" ? 104 : phase === "afterglow" ? 92 : 78)
    if (event === "compaction_handoff") return RGBA.fromInts(18, 26, 40, phase === "live" ? 94 : phase === "afterglow" ? 80 : 64)
    if (event === "subagent_return") return RGBA.fromInts(18, 34, 26, phase === "live" ? 94 : phase === "afterglow" ? 82 : 66)
    if (event === "interrupt") return RGBA.fromInts(44, 28, 18, phase === "live" ? 94 : phase === "afterglow" ? 82 : 66)
    if (event === "recovery") return RGBA.fromInts(40, 20, 20, phase === "live" ? 94 : phase === "afterglow" ? 78 : 60)
    if (sessionState() === "error") return RGBA.fromInts(40, 20, 20, 94)
    if (shellClimate().weather === "recovery dawn") return RGBA.fromInts(20, 28, 32, 86)
    if (rhythm.wake > 0.12) return RGBA.fromInts(22, 36, 56, Math.round(58 + rhythm.wake * 28))
    if (rhythm.scar > 0.08) return RGBA.fromInts(42, 24, 18, Math.round(52 + rhythm.scar * 22))
    if (shellCharge().phase === "radiant") return RGBA.fromInts(20, 28, 38, Math.round(80 + rhythm.glow * 12))
    if (shellCharge().phase === "cooling") return RGBA.fromInts(18, 24, 34, Math.round(54 + rhythm.glow * 16))
    if (shellClimate().pressure === "hot") return RGBA.fromInts(28, 22, 22, 92)
    if (shellClimate().pressure === "warm") return RGBA.fromInts(18, 24, 34, 92)
    return theme.backgroundPanel
  })
  const shellWeatherBorder = createMemo(() => {
    if (shellEventState().event === "accepted_baton") return theme.primary
    if (shellEventState().event === "compaction_handoff") return theme.borderActive
    if (shellEventState().event === "subagent_return") return theme.success
    if (shellEventState().event === "interrupt") return theme.warning
    if (sessionState() === "error") return theme.warning
    if (shellRhythm().wake > 0.28) return theme.primary
    if (shellRhythm().scar > 0.24) return theme.warning
    if (shellClimate().weather === "recovery dawn") return theme.secondary
    return shellClimate().pressure === "hot" ? theme.warning : theme.border
  })
  const shellLabelColor = createMemo(() => {
    if (shellEventState().event === "subagent_return") return theme.success
    if (shellEventState().event === "interrupt") return theme.warning
    if (shellEventState().event === "accepted_baton") return theme.primary
    if (shellEventState().event === "compaction_handoff") return theme.secondary
    if (shellRhythm().pulse > 0.66) return theme.text
    if (shellRhythm().wake > 0.18) return theme.primary
    if (shellRhythm().scar > 0.18) return theme.warning
    if (shellClimate().pressure === "hot") return theme.warning
    if (shellClimate().pressure === "warm") return theme.primary
    return theme.primary
  })
  const shellMetaBg = createMemo(() => {
    if (shellEventState().event === "accepted_baton") return RGBA.fromInts(24, 40, 66, 80)
    if (shellEventState().event === "subagent_return") return RGBA.fromInts(18, 36, 26, 54)
    if (shellEventState().event === "interrupt") return RGBA.fromInts(52, 28, 18, 58)
    if (shellRhythm().wake > 0.08) return RGBA.fromInts(24, 38, 62, Math.round(38 + shellRhythm().wake * 28))
    if (shellRhythm().scar > 0.08) return RGBA.fromInts(52, 28, 18, Math.round(30 + shellRhythm().scar * 20))
    if (shellClimate().pressure === "warm") return RGBA.fromInts(22, 28, 38, 42)
    if (shellClimate().pressure === "hot") return RGBA.fromInts(42, 24, 18, 46)
    return theme.backgroundPanel
  })
  const headerBorderProps = createMemo(() => (decorativeBorders() ? SplitBorderLeft : NoBorderLeft))
  const veryNarrow = createMemo(() => railWidth() < 72)
  const showThinkingIndicator = createMemo(() => railWidth() >= 118)
  const showParentNav = createMemo(() => isChildSession() && railWidth() >= 150)
  const showSiblingNav = createMemo(() => showParentNav() && railWidth() >= 190)
  const childNavWidth = createMemo(() => {
    if (!showParentNav()) return 0
    return showSiblingNav() ? 23 : 7
  })
  const primaryTruth = createMemo(() => {
    const foreground = foregroundSurface()
    if (foreground.visible) return foreground.label
    return session()?.title ?? "Session"
  })
  const supportingTruth = createMemo(() => {
    const foreground = foregroundSurface()
    if (foreground.visible && foreground.detail) return foreground.detail
    if (localActiveChildCount() > 0) return `${localActiveChildCount()}/${localChildCount()} lanes live`
    if (localChildCount() > 0) return `${localChildCount()} lanes attached`
    return shellNarrative().secondaryLabel
  })
  const showSupportingTruth = createMemo(() => !veryNarrow() && railWidth() >= 156 && Boolean(supportingTruth()))
  const supportingTruthWidth = createMemo(() => {
    if (!showSupportingTruth()) return 0
    const width = railWidth() - (showThinkingIndicator() ? 52 : 18) - childNavWidth() - 26
    return width > 0 ? Math.min(26, Math.max(0, width)) : 0
  })
  const primaryTruthWidth = createMemo(() => {
    const fixed = (veryNarrow() ? 4 : 11) + (showThinkingIndicator() ? 52 : 18) + childNavWidth() + supportingTruthWidth() + 6
    return Math.max(1, railWidth() - fixed)
  })
  const primaryTruthColor = createMemo(() => {
    const foreground = foregroundSurface()
    if (foreground.visible) {
      if (foreground.tone === "warning") return theme.warning
      if (foreground.tone === "success") return theme.success
      if (foreground.tone === "muted") return theme.textMuted
      return theme.primary
    }
    return shellLabelColor()
  })
  const controlTone = createMemo(() => {
    if (shellPosture() === "editing" || shellPosture() === "searching") return theme.primary
    if (shellPosture() === "orchestrating") return theme.warning
    if (shellPosture() === "blocked") return theme.warning
    if (shellPosture() === "recovering") return theme.error
    if (shellRhythm().wake > 0.2) return theme.secondary
    return theme.textMuted
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box width={railWidth()} flexShrink={0}>
      <box
        paddingTop={0}
        paddingBottom={0}
        paddingLeft={2}
        paddingRight={1}
        {...headerBorderProps()}
        borderColor={shellWeatherBorder()}
        flexShrink={0}
        backgroundColor={shellWeatherBg()}
      >
        <box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
          <text fg={shellLabelColor()}>
            <b>{veryNarrow() ? "NOIR" : "NOIR SIGNAL"}</b>
          </text>
          {showThinkingIndicator() ? (
            <ThinkingIndicator
              isThinking={isThinking()}
              mode={shellWorkMode()}
              pressure={shellClimate().pressure}
              intensity={shellClimate().intensity}
              childCount={localChildCount()}
              event={shellEventState().event}
              compact={true}
            />
          ) : (
            <text fg={sessionState() === "error" ? theme.error : isThinking() ? theme.success : theme.textMuted}>
              {sessionState() === "error" ? "◆" : isThinking() ? "◐" : "○"}
            </text>
          )}
          <text fg={primaryTruthColor()} bg={shellMetaBg()} wrapMode="truncate-end" width={primaryTruthWidth()}>
            <b>{primaryTruth()}</b>
          </text>
          <Show when={showSupportingTruth() && supportingTruthWidth() > 0}>
            <text fg={theme.textMuted} bg={theme.backgroundPanel} wrapMode="truncate-end" width={supportingTruthWidth()}>
              {supportingTruth()}
            </text>
          </Show>
          <Show when={showParentNav()}>
            <box flexDirection="row" gap={1} flexShrink={0}>
              <box
                onMouseUp={() => command.trigger("session.parent")}
                onMouseOver={() => setHover("parent")}
                onMouseOut={() => setHover(null)}
                backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.backgroundPanel}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={hover() === "parent" ? controlTone() : theme.text}>Stem</text>
              </box>
              <Show when={showSiblingNav()}>
                <box
                  onMouseUp={() => command.trigger("session.child.previous")}
                  onMouseOver={() => setHover("prev")}
                  onMouseOut={() => setHover(null)}
                  backgroundColor={hover() === "prev" ? theme.backgroundElement : theme.backgroundPanel}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text fg={hover() === "prev" ? controlTone() : theme.text}>Drift</text>
                </box>
                <box
                  onMouseUp={() => command.trigger("session.child.next")}
                  onMouseOver={() => setHover("next")}
                  onMouseOut={() => setHover(null)}
                  backgroundColor={hover() === "next" ? theme.backgroundElement : theme.backgroundPanel}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text fg={hover() === "next" ? controlTone() : theme.text}>Pulse</text>
                </box>
              </Show>
            </box>
          </Show>
        </box>
      </box>
    </box>
  )
}
