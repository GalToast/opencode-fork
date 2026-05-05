import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

type AgentOption = {
  name: string
  native?: boolean
  description?: string
}

type AgentLocal = {
  agent: {
    list: () => AgentOption[]
    current: () => AgentOption
    set: (name: string) => void
  }
}

export function DialogAgent() {
  const local = useLocal() as unknown as AgentLocal
  const dialog = useDialog()

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      return {
        value: item.name,
        title: item.name,
        description: item.native ? "native" : item.description,
      }
    }),
  )

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      options={options()}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
