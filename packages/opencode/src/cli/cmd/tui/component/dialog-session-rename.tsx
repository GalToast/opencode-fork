import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { Session as SessionApi } from "@/session"

interface DialogSessionRenameProps {
  session: string
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const client: OpencodeClient = sdk.client
  const session = createMemo(() => sync.session.get(props.session) as SessionApi.Info | undefined)

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <DialogPrompt
      title="Rename Session"
      value={session()?.title}
      onConfirm={(value) => {
        void client.session.update({
          sessionID: props.session,
          title: value,
        })
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
