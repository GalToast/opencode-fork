import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, Show } from "solid-js"
import { Tips } from "./tips-view"

const id = "internal:home-tips"

function View(props: { show: boolean }) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box height={4} minHeight={0} width="100%" maxWidth={75} alignItems="center" paddingTop={3} flexShrink={1}>
      <Show when={props.show}>
        <Tips />
      </Show>
    </box>
  )
}

const tui: TuiPlugin = (api) => {
  api.command.register(() => [
    {
      title: api.kv.get("tips_hidden", false) ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      hidden: api.route.current.name !== "home",
      onSelect() {
        api.kv.set("tips_hidden", !api.kv.get("tips_hidden", false))
        api.ui.dialog.clear()
      },
    },
  ])

  api.slots.register({
    order: 100,
    slots: {
      home_bottom() {
        const hidden = createMemo(() => api.kv.get("tips_hidden", false))
        const first = createMemo(() => api.state.session.count() === 0)
        const show = createMemo(() => !first() && !hidden())
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return <View show={show()} />
      },
    },
  })
  return Promise.resolve()
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
