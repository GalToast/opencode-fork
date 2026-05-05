import { createComponent, createContext, createRoot, getOwner, useContext } from "solid-js"
import { describe, expect, test } from "bun:test"
import { createSlashCommandOption, invokeCommandOwner, matchesSlashCommand } from "../../src/cli/cmd/tui/component/dialog-command-util"

describe("dialog command helpers", () => {
  test("slash entries preserve the canonical command value for autocomplete dispatch", () => {
    const option = createSlashCommandOption(
      {
        value: "session.list",
        title: "Sessions",
        description: "Open the sessions dialog",
        slash: {
          name: "sessions",
          aliases: ["session", "sess"],
        },
      },
      () => {},
    )

    expect(option).toEqual({
      display: "/sessions",
      value: "/sessions",
      commandValue: "session.list",
      description: "Open the sessions dialog",
      aliases: ["/session", "/sess"],
      onSelect: expect.any(Function),
    })
  })

  test("deferred local slash callbacks run under their original Solid owner", () => {
    const DialogValueContext = createContext<string>()
    let owner = null as ReturnType<typeof getOwner> | null
    let deferred = null as null | (() => string)
    let dispose = () => {}

    createRoot((rootDispose) => {
      dispose = rootDispose

      const Capture = () => {
        owner = getOwner()
        deferred = () => {
          const value = useContext(DialogValueContext)
          if (!value) throw new Error("missing dialog context")
          return value
        }
        return null
      }

      return createComponent(DialogValueContext.Provider, {
        value: "dialog-context",
        get children() {
          return createComponent(Capture, {})
        },
      })
    })

    try {
      expect(deferred).not.toBeNull()
      expect(() => deferred!()).toThrow("missing dialog context")
      expect(invokeCommandOwner(owner, deferred!)).toBe("dialog-context")
    } finally {
      dispose()
    }
  })

  test("invokeCommandOwner only runs a void callback once", () => {
    let owner = null as ReturnType<typeof getOwner> | null
    let calls = 0

    createRoot((dispose) => {
      owner = getOwner()
      const callback = () => {
        calls += 1
      }

      expect(invokeCommandOwner(owner, callback)).toBeUndefined()
      dispose()
    })

    expect(calls).toBe(1)
  })

  test("hidden slash commands still resolve for typed local slash execution", () => {
    const hiddenCompact = {
      value: "session.compact",
      title: "Compact session",
      hidden: true,
      slash: {
        name: "compact",
        aliases: ["summarize"],
      },
    }

    expect(matchesSlashCommand(hiddenCompact, "compact")).toBe(true)
    expect(matchesSlashCommand(hiddenCompact, "summarize")).toBe(true)
  })

  test("disabled slash commands do not resolve for typed local slash execution", () => {
    const disabledCompact = {
      value: "session.compact",
      title: "Compact session",
      enabled: false,
      slash: {
        name: "compact",
      },
    }

    expect(matchesSlashCommand(disabledCompact, "compact")).toBe(false)
  })
})
