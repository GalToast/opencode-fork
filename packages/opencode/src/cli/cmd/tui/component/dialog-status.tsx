import { TextAttributes } from "@opentui/core"
import { fileURLToPath } from "bun"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { For, Match, Switch, Show, createMemo } from "solid-js"

export function DialogStatus() {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()

  const enabledFormatters = createMemo(() => sync.data.formatter.filter((f) => f.enabled))

  const plugins = createMemo(() => {
    const list = sync.data.config.plugin ?? []
    const result = list.map((item) => {
      const value = typeof item === "string" ? item : item[0]
      if (value.startsWith("file://")) {
        const path = fileURLToPath(value)
        const parts = path.split("/")
        const filename = parts.pop() || path
        if (!filename.includes(".")) return { name: filename }
        const basename = filename.split(".")[0]
        if (basename === "index") {
          const dirname = parts.pop()
          const name = dirname || basename
          return { name }
        }
        return { name: basename }
      }
      const index = value.lastIndexOf("@")
      if (index <= 0) return { name: value, version: "latest" }
      const name = value.substring(0, index)
      const version = value.substring(index + 1)
      return { name, version }
    })
    return result.toSorted((a, b) => a.name.localeCompare(b.name))
  })

  const mcpCount = createMemo(() => Object.keys(sync.data.mcp).length)
  const mcpStatusColor = (status: string) =>
    ({
      connected: theme.success,
      failed: theme.error,
      disabled: theme.textMuted,
      needs_auth: theme.warning,
      needs_client_registration: theme.error,
    })[status] ?? theme.textMuted
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const noMcpServersFallback = <text fg={theme.text}>No MCP Servers</text>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const noFormattersFallback = <text fg={theme.text}>No Formatters</text>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const noPluginsFallback = <text fg={theme.text}>No Plugins</text>

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Status
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      {/* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */}
      <Show when={mcpCount() > 0} fallback={noMcpServersFallback}>
        <box>
          <text fg={theme.text}>{mcpCount()} MCP Servers</text>
          <For each={Object.entries(sync.data.mcp)}>
            {([key, item]) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-return
              return (
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} style={{ fg: mcpStatusColor(item.status) }}>
                    •
                  </text>
                  <text fg={theme.text} wrapMode="word">
                    <b>{key}</b>{" "}
                    <span style={{ fg: theme.textMuted }}>
                      <Switch fallback={item.status}>
                        <Match when={item.status === "connected"}>Connected</Match>
                        <Match when={item.status === "failed" && item}>{(val) => val().error}</Match>
                        <Match when={item.status === "disabled"}>Disabled in configuration</Match>
                        <Match when={item.status === "needs_auth"}>Needs authentication (run: opencode mcp auth {key})</Match>
                        <Match when={item.status === "needs_client_registration" && item}>{(val) => val().error}</Match>
                      </Switch>
                    </span>
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </Show>
      {sync.data.lsp.length > 0 && (
        <box>
          <text fg={theme.text}>{sync.data.lsp.length} LSP Servers</text>
          <For each={sync.data.lsp}>
            {(item) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-return
              return (
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} style={{ fg: item.status === "connected" ? theme.success : theme.error }}>
                    •
                  </text>
                  <text fg={theme.text} wrapMode="word">
                    <b>{item.id}</b> <span style={{ fg: theme.textMuted }}>{item.root}</span>
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      )}
      {/* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */}
      <Show when={enabledFormatters().length > 0} fallback={noFormattersFallback}>
        <box>
          <text fg={theme.text}>{enabledFormatters().length} Formatters</text>
          <For each={enabledFormatters()}>
            {(item) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-return
              return (
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} style={{ fg: theme.success }}>
                    •
                  </text>
                  <text wrapMode="word" fg={theme.text}>
                    <b>{item.name}</b>
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </Show>
      {/* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */}
      <Show when={plugins().length > 0} fallback={noPluginsFallback}>
        <box>
          <text fg={theme.text}>{plugins().length} Plugins</text>
          <For each={plugins()}>
            {(item) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-return
              return (
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} style={{ fg: theme.success }}>
                    •
                  </text>
                  <text wrapMode="word" fg={theme.text}>
                    <b>{item.name}</b>
                    {item.version && <span style={{ fg: theme.textMuted }}> @{item.version}</span>}
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}
