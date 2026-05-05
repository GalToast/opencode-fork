import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show, createSignal } from "solid-js"
import { TodoItem } from "../../component/todo-item"

const id = "internal:sidebar-todo"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.todo(props.session_id))
  const show = createMemo(() => list().length > 0 && list().some((item) => item.status !== "completed"))

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-return
              return <TodoItem status={item.status} content={item.content} />
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = (api) => {
  api.slots.register({
    order: 400,
    slots: {
      sidebar_content(_ctx, props) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return <View api={api} session_id={props.session_id} />
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
