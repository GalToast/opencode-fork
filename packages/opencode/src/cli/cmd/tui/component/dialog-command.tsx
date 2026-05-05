import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "@tui/ui/dialog-select"
import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { type KeybindKey, useKeybind } from "@tui/context/keybind"
import type { DialogContext } from "@tui/ui/dialog"
import type { ParsedKey } from "@opentui/core"
import { Log } from "@/util/log"

type Context = ReturnType<typeof init>
const ctx = createContext<Context>()

export type Slash = {
  name: string
  aliases?: string[]
}

export type CommandOption = DialogSelectOption<string> & {
  keybind?: KeybindKey
  suggested?: boolean
  slash?: Slash
  hidden?: boolean
  enabled?: boolean
}

type KeybindContext = {
  match: (key: KeybindKey, evt: ParsedKey) => boolean
  print: (key: KeybindKey) => string
}

const traceCommandSlash = process.env.OPENCODE_TUI_PROMPT_TRACE === "1"
const slashLog = Log.create({ service: "tui.command.slash" })

function traceSlash(event: string, extra?: Record<string, unknown>) {
  if (!traceCommandSlash) return
  slashLog.info(event, extra)
}

function init() {
  const [registrations, setRegistrations] = createSignal<Accessor<CommandOption[]>[]>([])
  const [suspendCount, setSuspendCount] = createSignal(0)
  const dialog: DialogContext = useDialog()
  const keybind = useKeybind() as unknown as KeybindContext

  const entries = createMemo(() => {
    const all = registrations().flatMap((x) => x())
    return all.map((x) => ({
      ...x,
      footer: x.keybind ? keybind.print(x.keybind) : undefined,
    }))
  })

  const isEnabled = (option: CommandOption) => option.enabled !== false
  const isVisible = (option: CommandOption) => isEnabled(option) && !option.hidden

  const visibleOptions = createMemo(() => entries().filter((option) => isVisible(option)))
  const suggestedOptions = createMemo(() =>
    visibleOptions()
      .filter((option) => option.suggested)
      .map((option) => ({
        ...option,
        value: `suggested:${option.value}`,
        category: "Suggested",
      })),
  )
  const suspended = () => suspendCount() > 0

  useKeyboard((evt) => {
    if (suspended()) return
    if (dialog.stack.length > 0) return
    for (const option of entries()) {
      if (!isEnabled(option)) continue
      if (option.keybind && keybind.match(option.keybind, evt)) {
        evt.preventDefault()
        option.onSelect?.(dialog)
        return
      }
    }
  })

  const result = {
    trigger(name: string) {
      for (const option of entries()) {
        if (option.value === name) {
          if (!isEnabled(option)) return
          option.onSelect?.(dialog)
          return
        }
      }
    },
    triggerSlash(name: string) {
      traceSlash("triggerSlash.start", { name, visibleCount: visibleOptions().length })
      for (const option of visibleOptions()) {
        const slash = option.slash
        if (!slash) continue
        const aliases = slash.aliases ?? []
        if (slash.name === name || aliases.includes(name)) {
          traceSlash("triggerSlash.hit", { name, value: option.value, slash: slash.name, aliases })
          option.onSelect?.(dialog)
          return true
        }
      }
      traceSlash("triggerSlash.miss", { name, visibleCount: visibleOptions().length })
      return false
    },
    hasSlash(name: string) {
      traceSlash("hasSlash.start", { name, visibleCount: visibleOptions().length })
      for (const option of visibleOptions()) {
        const slash = option.slash
        if (!slash) continue
        const aliases = slash.aliases ?? []
        if (slash.name === name || aliases.includes(name)) {
          traceSlash("hasSlash.hit", { name, value: option.value, slash: slash.name, aliases })
          return true
        }
      }
      traceSlash("hasSlash.miss", { name, visibleCount: visibleOptions().length })
      return false
    },
    slashes() {
      return visibleOptions().flatMap((option) => {
        const slash = option.slash
        if (!slash) return []
        return {
          display: "/" + slash.name,
          value: "/" + slash.name,
          description: option.description ?? option.title,
          aliases: slash.aliases?.map((alias) => "/" + alias),
          onSelect: () => result.trigger(option.value),
        }
      })
    },
    keybinds(enabled: boolean) {
      setSuspendCount((count) => count + (enabled ? -1 : 1))
    },
    suspended,
    show() {
      dialog.replace(() => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return <DialogCommand options={visibleOptions()} suggestedOptions={suggestedOptions()} />
      })
    },
    register(cb: () => CommandOption[]) {
      const results = createMemo(cb)
      setRegistrations((arr) => [results, ...arr])
      onCleanup(() => {
        setRegistrations((arr) => arr.filter((x) => x !== results))
      })
    },
  }
  return result
}

export function useCommandDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useCommandDialog must be used within a CommandProvider")
  }
  return value
}

export function CommandProvider(props: ParentProps) {
  const value = init()
  const dialog: DialogContext = useDialog()
  const keybind = useKeybind() as unknown as KeybindContext

  useKeyboard((evt) => {
    if (value.suspended()) return
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return
    if (keybind.match("command_list", evt)) {
      evt.preventDefault()
      value.show()
      return
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

function DialogCommand(props: { options: CommandOption[]; suggestedOptions: CommandOption[] }) {
  let ref: DialogSelectRef<string>
  const list = () => {
    if (ref?.filter) return props.options
    return [...props.suggestedOptions, ...props.options]
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return <DialogSelect ref={(r) => (ref = r)} title="Commands" options={list()} />
}
