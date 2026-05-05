import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

type McpLocal = {
  mcp: {
    isEnabled: (name: string) => boolean
    toggle: (name: string) => Promise<void>
  }
}

function Status(props: { enabled: boolean; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.enabled) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}

export function DialogMcp() {
  const local = useLocal() as unknown as McpLocal
  const sync = useSync()
  const sdk = useSDK()
  const client: OpencodeClient = sdk.client
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)

  const options = createMemo(() => {
    // Track sync data and loading state to trigger re-render when they change
    const mcpData = sync.data.mcp
    const loadingMcp = loading()

    return pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const footer = <Status enabled={local.mcp.isEnabled(name)} loading={loadingMcp === name} />
        return {
          value: name,
          title: name,
          description: status.status === "failed" ? "failed" : status.status,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          footer,
          category: undefined,
        }
      }),
    )
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        // Prevent toggling while an operation is already in progress
        if (loading() !== null) return

        setLoading(option.value)
        try {
          await local.mcp.toggle(option.value)
          // Refresh MCP status from server
          const status = await client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          } else {
            console.error("Failed to refresh MCP status: no data returned")
          }
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
  ])

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <DialogSelect
      ref={setRef}
      title="MCPs"
      options={options()}
      keybind={keybinds()}
      onSelect={(_option) => {
        // Don't close on select, only on escape
      }}
    />
  )
}
