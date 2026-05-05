import { createEffect, createMemo, createSignal, onCleanup, Match, Switch } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"

export type ConnectionStatus = "disconnected" | "connecting" | "connected"
export type SyncStatus = "idle" | "syncing" | "synced" | "error"
export type SessionState = "idle" | "loading" | "restoring" | "saving" | "error" | "active"

type IndicatorProps = {
  status: ConnectionStatus | SyncStatus | SessionState
  size?: "sm" | "md"
  showLabel?: boolean
  label?: string
}

export function StatusIndicator(props: IndicatorProps) {
  const { theme } = useTheme()
  const kv = useKV()
  const [pulsePhase, setPulsePhase] = createSignal(0)
  const animationsEnabled = createMemo<boolean>(() => Boolean(kv.get("animations_enabled", true)))

  const color = createMemo(() => {
    switch (props.status) {
      case "connected":
      case "synced":
      case "active":
        return theme.success
      case "connecting":
      case "syncing":
      case "loading":
      case "restoring":
      case "saving":
        return theme.warning
      case "disconnected":
      case "error":
        return theme.error
      case "idle":
      default:
        return theme.textMuted
    }
  })

  const isActive = createMemo(() => {
    return ["connecting", "syncing", "loading", "restoring", "saving", "active"].includes(props.status)
  })

  createEffect(() => {
    if (!animationsEnabled() || !isActive()) return
    const interval = setInterval(() => {
      setPulsePhase((p) => (p + 1) % 60)
    }, 50)
    onCleanup(() => clearInterval(interval))
  })

  const pulseOpacity = createMemo(() => {
    if (!isActive()) return 1
    return 0.6 + 0.4 * Math.sin((pulsePhase() / 60) * Math.PI * 2)
  })

  const symbol = createMemo(() => {
    switch (props.status) {
      case "connected":
      case "synced":
      case "active":
        return "●"
      case "connecting":
      case "syncing":
      case "loading":
      case "restoring":
      case "saving":
        return "◐"
      case "disconnected":
      case "error":
        return "◆"
      case "idle":
      default:
        return "○"
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <Switch>
        <Match when={props.status === "error"}>
          <text fg={color()}>{symbol()}</text>
        </Match>
        <Match when={isActive()}>
          <text
            fg={color()}
            style={{
              opacity: pulseOpacity(),
            }}
          >
            {symbol()}
          </text>
        </Match>
        <Match when={true}>
          <text fg={color()}>{symbol()}</text>
        </Match>
      </Switch>
      {props.showLabel && props.label && (
        <text fg={props.status === "connected" || props.status === "synced" ? theme.textMuted : color()}>{props.label}</text>
      )}
    </box>
  )
}

type SessionStateIndicatorProps = {
  state: SessionState
  showLabel?: boolean
}

export function SessionStateIndicator(props: SessionStateIndicatorProps) {
  const { theme } = useTheme()
  const kv = useKV()
  const [pulsePhase, setPulsePhase] = createSignal(0)
  const animationsEnabled = createMemo<boolean>(() => Boolean(kv.get("animations_enabled", true)))

  const config = createMemo(() => {
    switch (props.state) {
      case "loading":
        return {
          symbol: "◐",
          color: theme.warning,
          label: "Loading",
        }
      case "restoring":
        return {
          symbol: "◓",
          color: theme.warning,
          label: "Restoring",
        }
      case "saving":
        return {
          symbol: "◑",
          color: theme.warning,
          label: "Saving",
        }
      case "error":
        return {
          symbol: "✗",
          color: theme.error,
          label: "Error",
        }
      case "active":
        return {
          symbol: "●",
          color: theme.success,
          label: "Active",
        }
      case "idle":
      default:
        return {
          symbol: "○",
          color: theme.textMuted,
          label: "Idle",
        }
    }
  })

  const isActive = createMemo(() => {
    return ["loading", "restoring", "saving", "active"].includes(props.state)
  })

  createEffect(() => {
    if (!animationsEnabled() || !isActive()) return
    const interval = setInterval(() => {
      setPulsePhase((p) => (p + 1) % 60)
    }, 50)
    onCleanup(() => clearInterval(interval))
  })

  const pulseOpacity = createMemo(() => {
    if (!isActive()) return 1
    return 0.7 + 0.3 * Math.sin((pulsePhase() / 60) * Math.PI * 2)
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text
        fg={config().color}
        style={{
          opacity: pulseOpacity(),
        }}
      >
        {config().symbol}
      </text>
      {props.showLabel && (
        <text fg={config().color}>{config().label}</text>
      )}
    </box>
  )
}

type ConnectionStatusBarProps = {
  connection: ConnectionStatus
  sync: SyncStatus
  sessionState?: SessionState
  compact?: boolean
}

export function ConnectionStatusBar(props: ConnectionStatusBarProps) {
  if (props.compact) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (
      <box flexDirection="row" gap={1} alignItems="center">
        <StatusIndicator status={props.connection} size="sm" />
        <StatusIndicator status={props.sync} size="sm" />
        {props.sessionState && <StatusIndicator status={props.sessionState} size="sm" />}
      </box>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box flexDirection="row" gap={2} alignItems="center">
      <StatusIndicator status={props.connection} showLabel label={props.connection === "connecting" ? "Connecting..." : props.connection === "connected" ? "Connected" : "Disconnected"} />
      <StatusIndicator status={props.sync} showLabel label={props.sync === "syncing" ? "Syncing..." : props.sync === "synced" ? "Synced" : props.sync === "error" ? "Error" : "Idle"} />
      {props.sessionState && (
        <SessionStateIndicator state={props.sessionState} showLabel />
      )}
    </box>
  )
}
