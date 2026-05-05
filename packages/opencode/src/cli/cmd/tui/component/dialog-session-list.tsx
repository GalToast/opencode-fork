import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount, Show, type JSX } from "solid-js"
import { Locale } from "@/util/locale"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { useKV } from "../context/kv"
import { createDebouncedSignal } from "../util/signal"
import { Spinner } from "./spinner"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { Session as SessionApi } from "@/session"
import type { KeybindInfo } from "@/util/keybind"
import type { Route } from "@tui/context/route"
import { buildSessionListSearchQuery, sortRootSessions } from "../util/session-list"

type SessionRow = SessionApi.Info
type RouteContext = {
  data: Route
  navigate(route: Route): void
}
type SyncContextList = {
  data: {
    session: SessionRow[]
    session_status?: Record<string, { type: string } | undefined>
  }
}
type KeybindContext = {
  all: Record<string, KeybindInfo[] | undefined>
  print: (key: string) => string
}
type SDKContext = {
  client: OpencodeClient
}

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute() as RouteContext
  const sync = useSync() as SyncContextList
  const keybind = useKeybind() as KeybindContext
  const { theme } = useTheme()
  const sdk = useSDK() as SDKContext
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const client: OpencodeClient = sdk.client
  const kv = useKV()
  const navigate = (next: Route) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    route.navigate(next)
  }
  const listSessions = async (query: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const result = await client.session.list(buildSessionListSearchQuery(query))
    return result.data ?? []
  }

  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)

  const [searchResults] = createResource(() => search(), async (query) => {
    if (!query) return undefined
    return listSessions(query)
  })

  const currentSessionID = createMemo(() => {
    const currentRoute = route.data
    return currentRoute.type === "session" ? currentRoute.sessionID : undefined
  })

  const sessions = createMemo<SessionRow[]>(() => searchResults() ?? sync.data.session)

  const options = createMemo(() => {
    const today = new Date().toDateString()
    return sortRootSessions(sessions())
      .map((x) => {
        const date = new Date(x.time.updated)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        const isDeleting = toDelete() === x.id
        const status = sync.data.session_status?.[x.id]
        const isWorking = status?.type === "busy"
        return {
          title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
          bg: isDeleting ? theme.error : undefined,
          value: x.id,
          category,
          footer: Locale.time(x.time.updated),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          gutter: isWorking ? <Spinner /> : undefined,
        }
      })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: (option) => {
            if (toDelete() === option.value) {
              void client.session
                .delete({
                  sessionID: option.value,
                })
                .catch(() => {})
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename",
          onTrigger: (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
      ]}
    />
  )
}
