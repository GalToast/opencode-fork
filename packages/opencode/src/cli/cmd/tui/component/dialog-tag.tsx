import { createMemo, createResource } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { createStore } from "solid-js/store"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

type FileFindResponse = {
  error?: unknown
  data?: string[]
}

export function DialogTag(props: { onSelect?: (value: string) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const client: OpencodeClient = useSDK().client
  const dialog = useDialog()

  const [store] = createStore({
    filter: "",
  })

  const [files] = createResource<string[]>(
    () => [store.filter],
    async () => {
      const result = (await client.find.files({
        query: store.filter,
      })) as FileFindResponse
      if (result.error) return []
      const sliced = (result.data ?? []).slice(0, 5)
      return sliced
    },
  )

  const options = createMemo(() =>
    (files() ?? []).map((file) => ({
      value: file,
      title: file,
    })),
  )

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <DialogSelect
      title="Autocomplete"
      options={options()}
      onSelect={(option) => {
        props.onSelect?.(option.value)
        dialog.clear()
      }}
    />
  )
}
