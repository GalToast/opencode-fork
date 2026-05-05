import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { FilePart, OpencodeClient, TextPart } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import type { Route } from "@tui/context/route"
import { useDialog } from "../../ui/dialog"
import type { DialogContext } from "../../ui/dialog"
import type { PromptInfo } from "@tui/component/prompt/history"

type TimelineMessage = {
  id: string
  role: string
  time: {
    created: number
  }
}

type TimelinePart = (TextPart & { synthetic?: boolean; ignored?: boolean }) | FilePart

type TimelineSyncContext = {
  data: {
    message: Record<string, TimelineMessage[] | undefined>
    part: Record<string, TimelinePart[] | undefined>
  }
}

type TimelineSdkContext = {
  client: OpencodeClient
}

type TimelineRouteContext = {
  navigate: (route: Route) => void
}

function isTimelineTextPart(part: TimelinePart): part is TextPart & { synthetic?: boolean; ignored?: boolean } {
  return part.type === "text"
}

export function DialogForkFromTimeline(props: { sessionID: string; onMove: (messageID: string) => void }) {
  const sync = useSync() as unknown as TimelineSyncContext
  const dialog = useDialog() as unknown as DialogContext
  const client = (useSDK() as unknown as TimelineSdkContext).client
  const route = useRoute() as unknown as TimelineRouteContext

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const result = [] as DialogSelectOption<string>[]
    for (const message of messages) {
      if (message.role !== "user") continue
      const part = (sync.data.part[message.id] ?? []).find(
        (x) => isTimelineTextPart(x) && !x.synthetic && !x.ignored,
      )
      if (!part) continue
      const textPart = part as TextPart & { synthetic?: boolean; ignored?: boolean }
      result.push({
        title: String(textPart.text).replace(/\n/g, " "),
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: (dialogState) => {
          void (async () => {
            const forked = await client.session.fork({
              sessionID: props.sessionID,
              messageID: message.id,
            })
            const parts = sync.data.part[message.id] ?? []
            const initialPrompt = parts.reduce(
              (agg, messagePart) => {
                if (messagePart.type === "text") {
                  if (!messagePart.synthetic) agg.input += messagePart.text
                }
                if (messagePart.type === "file") agg.parts.push(messagePart)
                return agg
              },
              { input: "", parts: [] as PromptInfo["parts"] },
            )
            const nextRoute: Route = {
              sessionID: forked.data!.id,
              type: "session",
              initialPrompt,
            }
            route.navigate(nextRoute)
            dialogState.clear()
          })()
        },
      })
    }
    result.reverse()
    return result
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Fork from message" options={options()} />
}
