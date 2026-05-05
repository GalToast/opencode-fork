import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { Logo } from "../component/logo"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData } from "@tui/context/route"
import { useRoute } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import type { Route } from "@tui/context/route"

type HomeCommandContext = {
  register: (
    cb: () => {
      title: string
      value: string
      keybind: string
      category: string
      onSelect: (dialog: { clear: () => void }) => void
    }[],
  ) => void
}

type HomePromptRefContext = {
  set: (ref: PromptRef | undefined) => void
}

type HomeKeybindContext = {
  print: (key: "command_list") => string
}

type HomeArgsContext = {
  prompt?: string
}

type HomeRouteContext = {
  navigate: (route: Route) => void
}

type SessionRow = {
  id: string
  parentID?: string
  time: {
    updated: number
  }
  title: string
}

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const routeActions = useRoute() as unknown as HomeRouteContext
  const promptRef = usePromptRef() as unknown as HomePromptRefContext
  const command = useCommandDialog() as unknown as HomeCommandContext
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const isFirstTimeUser = createMemo(() => sync.data.session.length === 0)
  const rootSessions = createMemo(() =>
    sync.data.session
      .filter((session) => {
        return session.parentID === undefined
      })
      .toSorted((a, b) => b.time.updated - a.time.updated),
  )
  const latestSession = createMemo(() => rootSessions()[0])
  const recentSessions = createMemo<SessionRow[]>(() => rootSessions().slice(0, 3))
  const featuredSession = createMemo(() => recentSessions()[0])
  const secondarySessions = createMemo<SessionRow[]>(() => recentSessions().slice(1, 3))
  const isReturningUser = createMemo(() => rootSessions().length > 0)
  const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
  const showTips = createMemo(() => {
    return !tipsHidden()
  })

  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
  ])

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const Hint: JSX.Element = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt: PromptRef | undefined
  const args = useArgs() as HomeArgsContext
  const [handoffSignature, setHandoffSignature] = createSignal("")

  const handoffSignal = createMemo(() => {
    if (route.initialPrompt) return "seeded"
    if (args.prompt) return "argv"
    if (!isReturningUser()) return "first"
    if (latestSession()) return "return"
    return "idle"
  })

  const handoffLead = createMemo(() => {
    switch (handoffSignal()) {
      case "seeded":
        return "External handoff"
      case "argv":
        return "Launch vector"
      case "return":
        return "Resume vector"
      case "first":
        return "First ignition"
      default:
        return "Standby"
    }
  })
  const ritualHeadline = createMemo(() => {
    switch (handoffSignal()) {
      case "seeded":
        return "A routed signal is already primed."
      case "argv":
        return "Startup signal is primed for immediate dispatch."
      case "return":
        return "Your latest mission is still warm."
      case "first":
        return "Speak once and the organism wakes around your intent."
      default:
        return "Seed the next signal."
    }
  })
  const ritualDetail = createMemo(() => {
    const latest = featuredSession()
    switch (handoffSignal()) {
      case "seeded":
        return "External handoff is already in the chamber. Review it or fire immediately."
      case "argv":
        return "Launch input is queued from startup. The prompt bay is ready to send."
      case "return":
        return latest
          ? `Resume ${Locale.truncate(latest.title, 44)} or open a fresh lane without losing the thread.`
          : "Resume a warm trace or open a fresh lane without losing the thread."
      case "first":
        return "Your first prompt becomes the mission spine for everything that follows."
      default:
        return "Choose a trace or open a clean lane in the prompt bay."
    }
  })
  const ritualMeta = createMemo(() => {
    const latest = featuredSession()
    switch (handoffSignal()) {
      case "seeded":
        return "incoming route held live"
      case "argv":
        return "launch vector routed from startup"
      case "return":
        return latest ? `${Locale.time(latest.time.updated)} • ${Locale.truncate(latest.title, 28)}` : "return vector held live"
      case "first":
        return "first ignition"
      default:
        return "standby"
    }
  })

  const handoffSignatureForInput = createMemo(() => {
    if (route.initialPrompt) return `seeded:${JSON.stringify(route.initialPrompt)}`
    if (args.prompt) return `argv:${args.prompt}`
    return "none"
  })
  createEffect(() => {
    const signature = handoffSignatureForInput()
    if (signature === handoffSignature()) return
    if (!prompt) return

    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      setHandoffSignature(signature)
      return
    }

    if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      setHandoffSignature(signature)
      prompt.submit()
      return
    }

    if (handoffSignature() !== "none") {
      setHandoffSignature("none")
    }
  })
  const directory = useDirectory()

  const keybind = useKeybind() as unknown as HomeKeybindContext

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box height={1} minHeight={0} flexShrink={1} />
        <box flexShrink={0} paddingTop={1} paddingBottom={1}>
          <Logo />
        </box>
        <box
          width="100%"
          maxWidth={75}
          flexDirection="column"
          alignItems="center"
          gap={1}
          flexShrink={0}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.backgroundPanel}
        >
          <text fg={theme.warning}>
            ◎ <b>{handoffLead()}</b>
          </text>
          <text fg={theme.text}>
            <b>{ritualHeadline()}</b>
          </text>
          <text fg={theme.textMuted} wrapMode="truncate-end">
            {ritualDetail()}
          </text>
          <box flexDirection="row" gap={2}>
            <text fg={connectedMcpCount() > 0 ? theme.success : theme.textMuted}>
              {connectedMcpCount()} MCP ready
            </text>
            <text fg={theme.textMuted}>•</text>
            <text fg={theme.textMuted}>{ritualMeta()}</text>
            <text fg={theme.textMuted}>•</text>
            <text fg={theme.textMuted}>{Installation.VERSION}</text>
          </box>
        </box>
        <box height={2} minHeight={0} flexShrink={1} />
        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1} flexShrink={0}>
          <Prompt
            ref={(r) => {
              prompt = r
              if (r !== undefined) promptRef.set(r)
            }}
            hint={Hint}
          />
        </box>
        <Show when={featuredSession()}>
          <box width="100%" maxWidth={75} flexDirection="column" gap={1} paddingTop={2} flexShrink={0}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.text}>
                <b>Continue latest mission</b>
              </text>
              <text fg={theme.textMuted}>return vector</text>
            </box>
            {(() => {
              const feature = featuredSession()
              if (!feature) return undefined
              // eslint-disable-next-line @typescript-eslint/no-unsafe-return
              return (
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  paddingLeft={2}
                  paddingRight={2}
                  paddingTop={1}
                  paddingBottom={1}
                  backgroundColor={theme.backgroundPanel}
                  onMouseUp={() =>
                    routeActions.navigate({
                      type: "session",
                      sessionID: feature.id,
                    })
                  }
                >
                  <box flexDirection="column" flexGrow={1}>
                    <text fg={theme.text} wrapMode="truncate-end">
                      <b>{feature.title}</b>
                    </text>
                    <text fg={theme.textMuted}>
                      {Locale.time(feature.time.updated)} • {feature.id.slice(-8)}
                    </text>
                  </box>
                  <text fg={theme.primary}>resume</text>
                </box>
              )
            })()}
            <Show when={secondarySessions().length > 0}>
              <box flexDirection="column" gap={1} paddingTop={1}>
                <text fg={theme.textMuted}>Secondary traces</text>
                <For each={secondarySessions()}>
                  {(session: SessionRow) => {
                    const resumeID = session.id
                    const updatedAt = session.time.updated
                    const title = session.title
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                    return (
                      <box
                        flexDirection="row"
                        justifyContent="space-between"
                        paddingLeft={1}
                        paddingRight={1}
                        onMouseUp={() =>
                          routeActions.navigate({
                            type: "session",
                            sessionID: resumeID,
                          })
                        }
                      >
                        <text fg={theme.textMuted} wrapMode="truncate-end" width={54}>
                          {title}
                        </text>
                        <text fg={theme.textMuted}>{Locale.time(updatedAt)}</text>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>
          </box>
        </Show>
        <box height={4} minHeight={0} width="100%" maxWidth={75} alignItems="center" paddingTop={3} flexShrink={1}>
          <Show when={showTips()}>
            <Tips context={isFirstTimeUser() ? "first" : "returning"} seed={featuredSession()?.id ?? handoffSignal()} />
          </Show>
        </box>
        <box flexGrow={1} minHeight={0} />
        <Toast />
      </box>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <text fg={theme.textMuted}>{directory()}</text>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>⊙ </span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted }}>⊙ </span>
                </Match>
              </Switch>
              {connectedMcpCount()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>
            {keybind.print("command_list")} commands
          </text>
        </box>
      </box>
    </>
  )
}
