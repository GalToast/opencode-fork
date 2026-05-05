import { createContext, Show, useContext, type ParentProps } from "solid-js"
import { Log } from "@/util/log"
import { appendFileSync } from "fs"

type ReadyAware = {
  ready?: boolean
}

export function createSimpleContext<T>(input: {
  name: string
  init: () => T
}): {
  provider: (props: ParentProps) => any
  use: () => T
}
export function createSimpleContext<Props extends object, T>(input: {
  name: string
  init: (input: Props) => T
}): {
  provider: (props: ParentProps<Props>) => any
  use: () => T
}
export function createSimpleContext<Props extends object, T>(input: {
  name: string
  init: ((input: Props) => T) | (() => T)
}) {
  const ctx = createContext<T>()
  const log = Log.create({ service: "tui.context" })
  const trace = (message: string) => {
    const target = process.env["OPENCODE_TUI_BOOT_TRACE"]
    if (!target) return
    try {
      appendFileSync(target, `${new Date().toISOString()} context:${input.name}:${message}\n`)
    } catch {
    }
  }

  return {
    provider: (props: ParentProps<Props>) => {
      trace("init:start")
      let init: T
      try {
        init = input.init(props)
      } catch (error) {
        trace(`init:error=${error instanceof Error ? error.message : String(error)}`)
        throw error
      }
      trace("init:done")
      const ready = () => (init as ReadyAware).ready
      const shouldRender = () =>
        process.env["OPENCODE_TUI_FAST_BOOT"] === "1" || input.name === "Sync" || ready() === undefined || ready() === true
      trace(`ready=${String(ready())} render=${String(shouldRender())}`)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return (
        <Show when={shouldRender()}>
          <ctx.Provider value={init}>{props.children}</ctx.Provider>
        </Show>
      )
    },
    use: () => {
      const value = useContext(ctx)
      if (!value) {
        if (input.name === "Sync") {
          const stack = new Error("Sync context missing").stack
          log.error("missing-sync-provider", { stack })
        }
        throw new Error(`${input.name} context must be used within a context provider`)
      }
      return value
    },
  }
}
