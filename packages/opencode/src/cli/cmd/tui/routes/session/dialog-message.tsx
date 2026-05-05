import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import type { Route } from "@tui/context/route"
import { Clipboard } from "@tui/util/clipboard"
import type { PromptInfo } from "@tui/component/prompt/history"
import type { FilePart, OpencodeClient, TextPart } from "@opencode-ai/sdk/v2"

type DialogMessageItem = {
  id: string
}

type DialogMessagePart = (TextPart & { synthetic?: boolean }) | FilePart

type DialogMessageSyncContext = {
  data: {
    message: Record<string, DialogMessageItem[] | undefined>
    part: Record<string, DialogMessagePart[] | undefined>
  }
}

type DialogMessageSdkContext = {
  client: OpencodeClient
}

type DialogMessageRouteContext = {
  navigate: (route: Route) => void
}

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync() as unknown as DialogMessageSyncContext
  const client = (useSDK() as unknown as DialogMessageSdkContext).client
  const message = createMemo(() => sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID))
  const route = useRoute() as unknown as DialogMessageRouteContext

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <DialogSelect
      title="Message Actions"
      options={[
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: (dialog) => {
            const msg = message()
            if (!msg) return

            void client.session.revert({
              sessionID: props.sessionID,
              messageID: msg.id,
            })

            if (props.setPrompt) {
              const parts = sync.data.part[msg.id]
              const promptInfo = parts.reduce(
                (agg, part) => {
                  if (part.type === "text") {
                    if (!part.synthetic) agg.input += part.text
                  }
                  if (part.type === "file") agg.parts.push(part)
                  return agg
                },
                { input: "", parts: [] as PromptInfo["parts"] },
              )
              props.setPrompt(promptInfo)
            }

            dialog.clear()
          },
        },
        {
          title: "Copy",
          value: "message.copy",
          description: "message text to clipboard",
          onSelect: (dialog) => {
            void (async () => {
              const msg = message()
              if (!msg) return

              const parts = sync.data.part[msg.id] ?? []
              const text = parts.reduce((agg, part) => {
                if (part.type === "text" && !part.synthetic) {
                  agg += part.text
                }
                return agg
              }, "")

              await Clipboard.copy(text)
              dialog.clear()
            })()
          },
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          onSelect: (dialog) => {
            void (async () => {
              const result = await client.session.fork({
                sessionID: props.sessionID,
                messageID: props.messageID,
              })
              const initialPrompt = (() => {
                const msg = message()
                if (!msg) return undefined
                const parts = sync.data.part[msg.id] ?? []
                return parts.reduce(
                  (agg, part) => {
                    if (part.type === "text") {
                      if (!part.synthetic) agg.input += part.text
                    }
                    if (part.type === "file") agg.parts.push(part)
                    return agg
                  },
                  { input: "", parts: [] as PromptInfo["parts"] },
                )
              })()
              const nextRoute: Route = {
                sessionID: result.data!.id,
                type: "session",
                initialPrompt,
              }
              route.navigate(nextRoute)
              dialog.clear()
            })()
          },
        },
      ]}
    />
  )
}
