import type { BoxRenderable, TextareaRenderable, KeyEvent, ScrollBoxRenderable, MouseEvent } from "@opentui/core"
import { pathToFileURL } from "bun"
import { firstBy } from "remeda"
import { createMemo, createResource, createEffect, onMount, onCleanup, Index, Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useTerminalDimensions } from "@opentui/solid"
import { Locale } from "@/util/locale"
import { Log } from "@/util/log"
import type { PromptInfo } from "./history"
import { useFrecency } from "./frecency"
import { rankAutocompleteOptions } from "./autocomplete-ranking"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

const tracePromptAutocomplete = process.env.OPENCODE_TUI_PROMPT_TRACE === "1"
const traceLog = Log.create({ service: "tui.prompt.autocomplete" })

function trace(event: string, extra?: Record<string, unknown>) {
  if (!tracePromptAutocomplete) return
  traceLog.info(event, extra)
}

function removeLineRange(input: string) {
  const hashIndex = input.lastIndexOf("#")
  return hashIndex !== -1 ? input.substring(0, hashIndex) : input
}

function extractLineRange(input: string) {
  const hashIndex = input.lastIndexOf("#")
  if (hashIndex === -1) {
    return { baseQuery: input }
  }

  const baseName = input.substring(0, hashIndex)
  const linePart = input.substring(hashIndex + 1)
  const lineMatch = linePart.match(/^(\d+)(?:-(\d*))?$/)

  if (!lineMatch) {
    return { baseQuery: baseName }
  }

  const startLine = Number(lineMatch[1])
  const endLine = lineMatch[2] && startLine < Number(lineMatch[2]) ? Number(lineMatch[2]) : undefined

  return {
    lineRange: {
      baseName,
      startLine,
      endLine,
    },
    baseQuery: baseName,
  }
}

export type AutocompleteRef = {
  onInput: (value: string) => void
  onKeyDown: (e: KeyEvent) => void
  accept: () => void
  visible: false | "@" | "/"
}

export type AutocompleteOption = {
  display: string
  value?: string
  aliases?: string[]
  disabled?: boolean
  description?: string
  isDirectory?: boolean
  onSelect?: () => void
  path?: string
}

type FileFindResponse = {
  error?: unknown
  data?: string[]
}

type SyncAutocompleteContext = {
  data: {
    path: {
      directory?: string
    }
    mcp_resource: Record<
      string,
      {
        name: string
        uri: string
        description?: string
        mimeType?: string
        client: string
      }
    >
    agent: Array<{
      name: string
      hidden?: boolean
      mode?: string
    }>
    command: Array<{
      name: string
      source: string
      description?: string
    }>
  }
}

type CommandDialogContext = {
  slashes(): AutocompleteOption[]
  keybinds(enabled: boolean): void
}

type FrecencyContext = {
  getFrecency(filePath: string): number
  updateFrecency(filePath: string): void
}

export function Autocomplete(props: {
  value: string
  sessionID?: string
  setPrompt: (input: (prompt: PromptInfo) => void) => void
  setExtmark: (partIndex: number, extmarkId: number) => void
  anchor: () => BoxRenderable
  input: () => TextareaRenderable
  ref: (ref: AutocompleteRef) => void
  fileStyleId: number
  agentStyleId: number
  promptPartTypeId: () => number
}) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const client: OpencodeClient = useSDK().client
  const sync = useSync() as unknown as SyncAutocompleteContext
  const command = useCommandDialog() as unknown as CommandDialogContext
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const frecency = useFrecency() as unknown as FrecencyContext

  const [store, setStore] = createStore({
    index: 0,
    selected: 0,
    visible: false as AutocompleteRef["visible"],
    input: "keyboard" as "keyboard" | "mouse",
  })

  const [positionTick, setPositionTick] = createSignal(0)
  const [lastMousePosition, setLastMousePosition] = createSignal<{ x: number; y: number } | undefined>(undefined)
  const [liveValue, setLiveValue] = createSignal(props.value ?? "")

  createEffect(() => {
    if (!store.visible) setLiveValue(props.value ?? "")
  })

  function currentValue() {
    return liveValue() ?? props.value ?? ""
  }

  function currentCursorOffset(value = currentValue()) {
    if (store.visible === "/" && store.index === 0 && value.startsWith("/")) {
      return value.length
    }
    return props.input().cursorOffset
  }

  function lockMouseSelection() {
    setStore("input", "keyboard")
    setLastMousePosition(undefined)
  }

  createEffect(() => {
    if (store.visible) {
      let lastPos = { x: 0, y: 0, width: 0 }
      const interval = setInterval(() => {
        const anchor = props.anchor()
        if (anchor.x !== lastPos.x || anchor.y !== lastPos.y || anchor.width !== lastPos.width) {
          lastPos = { x: anchor.x, y: anchor.y, width: anchor.width }
          setPositionTick((t) => t + 1)
        }
      }, 50)

      onCleanup(() => clearInterval(interval))
    }
  })

  const position = createMemo(() => {
    if (!store.visible) return { x: 0, y: 0, width: 0 }
    const dims = dimensions()
    positionTick()
    const anchor = props.anchor()
    const parent = anchor.parent
    const parentX = parent?.x ?? 0
    const parentY = parent?.y ?? 0

    return {
      x: anchor.x - parentX,
      y: anchor.y - parentY,
      width: anchor.width,
    }
  })

  const filter = createMemo(() => {
    if (!store.visible) return
    const value = currentValue()
    const cursorOffset = currentCursorOffset(value)
    if (cursorOffset <= store.index) return ""
    return value.slice(store.index + 1, cursorOffset)
  })

  // The popup needs to rank against the same live buffer that onInput() sees.
  // Deriving search from props.value can lag behind the textarea during fast typing.
  const [search, setSearch] = createSignal("")
  createEffect(() => {
    const next = filter()
    setSearch(next ? next : "")
  })

  // When the filter changes due to how TUI works, the mousemove might still be triggered
  // via a synthetic event as the layout moves underneath the cursor. This is a workaround to make sure the input mode remains keyboard so
  // that the mouseover event doesn't trigger when filtering.
  createEffect(() => {
    filter()
    lockMouseSelection()
  })

  function insertPart(text: string, part: PromptInfo["parts"][number]) {
    const input = props.input()
    const cursorOffset = input.cursorOffset

    const charAfterCursor = currentValue().at(cursorOffset)
    const needsSpace = charAfterCursor !== " "
    const append = "@" + text + (needsSpace ? " " : "")

    input.cursorOffset = store.index
    const startCursor = input.logicalCursor
    input.cursorOffset = cursorOffset
    const endCursor = input.logicalCursor

    input.deleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)
    input.insertText(append)

    const virtualText = "@" + text
    const extmarkStart = store.index
    const extmarkEnd = extmarkStart + Bun.stringWidth(virtualText)

    const styleId = part.type === "file" ? props.fileStyleId : part.type === "agent" ? props.agentStyleId : undefined

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId,
      typeId: props.promptPartTypeId(),
    })

    props.setPrompt((draft) => {
      if (part.type === "file") {
        const existingIndex = draft.parts.findIndex((p) => p.type === "file" && "url" in p && p.url === part.url)
        if (existingIndex !== -1) {
          const existing = draft.parts[existingIndex]
          if (
            part.source?.text &&
            existing &&
            "source" in existing &&
            existing.source &&
            "text" in existing.source &&
            existing.source.text
          ) {
            existing.source.text.start = extmarkStart
            existing.source.text.end = extmarkEnd
            existing.source.text.value = virtualText
          }
          return
        }
      }

      if (part.type === "file" && part.source?.text) {
        part.source.text.start = extmarkStart
        part.source.text.end = extmarkEnd
        part.source.text.value = virtualText
      } else if (part.type === "agent" && part.source) {
        part.source.start = extmarkStart
        part.source.end = extmarkEnd
        part.source.value = virtualText
      }
      const partIndex = draft.parts.length
      draft.parts.push(part)
      props.setExtmark(partIndex, extmarkId)
    })

    if (part.type === "file" && part.source && part.source.type === "file") {
      frecency.updateFrecency(part.source.path)
    }
  }

  const [files] = createResource(
    () => search(),
    async (query) => {
      if (!store.visible || store.visible === "/") return []

      const { lineRange, baseQuery } = extractLineRange(query ?? "")

      // Get files from SDK
      const result = (await client.find.files({
        query: baseQuery,
      })) as unknown as FileFindResponse

      const options: AutocompleteOption[] = []

      // Add file options
      if (!result.error && result.data) {
        const sortedFiles = [...result.data].sort((a, b) => {
          const aScore = frecency.getFrecency(a)
          const bScore = frecency.getFrecency(b)
          if (aScore !== bScore) return bScore - aScore
          const aDepth = a.split("/").length
          const bDepth = b.split("/").length
          if (aDepth !== bDepth) return aDepth - bDepth
          return a.localeCompare(b)
        })

        const width = props.anchor().width - 4
        options.push(
          ...sortedFiles.map((item): AutocompleteOption => {
            const baseDir = (sync.data.path.directory || process.cwd()).replace(/\/+$/, "")
            const fullPath = `${baseDir}/${item}`
            const urlObj = pathToFileURL(fullPath)
            let filename = item
            if (lineRange && !item.endsWith("/")) {
              filename = `${item}#${lineRange.startLine}${lineRange.endLine ? `-${lineRange.endLine}` : ""}`
              urlObj.searchParams.set("start", String(lineRange.startLine))
              if (lineRange.endLine !== undefined) {
                urlObj.searchParams.set("end", String(lineRange.endLine))
              }
            }
            const url = urlObj.href

            const isDir = item.endsWith("/")
            return {
              display: Locale.truncateMiddle(filename, width),
              value: filename,
              isDirectory: isDir,
              path: item,
              onSelect: () => {
                insertPart(filename, {
                  type: "file",
                  mime: "text/plain",
                  filename,
                  url,
                  source: {
                    type: "file",
                    text: {
                      start: 0,
                      end: 0,
                      value: "",
                    },
                    path: item,
                  },
                })
              },
            }
          }),
        )
      }

      return options
    },
    {
      initialValue: [],
    },
  )

  const mcpResources = createMemo(() => {
    if (!store.visible || store.visible === "/") return []

    const options: AutocompleteOption[] = []
    const width = props.anchor().width - 4

    for (const res of Object.values(sync.data.mcp_resource)) {
      const text = `${res.name} (${res.uri})`
      options.push({
        display: Locale.truncateMiddle(text, width),
        value: text,
        description: res.description,
        onSelect: () => {
          insertPart(res.name, {
            type: "file",
            mime: res.mimeType ?? "text/plain",
            filename: res.name,
            url: res.uri,
            source: {
              type: "resource",
              text: {
                start: 0,
                end: 0,
                value: "",
              },
              clientName: res.client,
              uri: res.uri,
            },
          })
        },
      })
    }

    return options
  })

  const agents = createMemo(() => {
    const agentList = sync.data.agent
    return agentList
      .filter((agent) => !agent.hidden && agent.mode !== "primary")
      .map(
        (agent): AutocompleteOption => ({
          display: "@" + agent.name,
          onSelect: () => {
            insertPart(agent.name, {
              type: "agent",
              name: agent.name,
              source: {
                start: 0,
                end: 0,
                value: "",
              },
            })
          },
        }),
      )
  })

  const commands = createMemo((): AutocompleteOption[] => {
    const results: AutocompleteOption[] = [...command.slashes()]

    for (const serverCommand of sync.data.command) {
      if (serverCommand.source === "skill") continue
      const label = serverCommand.source === "mcp" ? ":mcp" : ""
      results.push({
        display: "/" + serverCommand.name + label,
        value: "/" + serverCommand.name,
        description: serverCommand.description,
        onSelect: () => {
          const newText = "/" + serverCommand.name + " "
          const cursor = props.input().logicalCursor
          props.input().deleteRange(0, 0, cursor.row, cursor.col)
          props.input().insertText(newText)
          props.input().cursorOffset = Bun.stringWidth(newText)
        },
      })
    }

    results.sort((a, b) => a.display.localeCompare(b.display))

    const max = firstBy(results, [(x) => x.display.length, "desc"])?.display.length
    if (!max) return results
    return results.map((item) => ({
      ...item,
      display: item.display.padEnd(max + 2),
    }))
  })

  const options = createMemo((prev: AutocompleteOption[] | undefined) => {
    const filesValue = files()
    const agentsValue = agents()
    const commandsValue = commands()

    const mixed: AutocompleteOption[] =
      store.visible === "@" ? [...agentsValue, ...(filesValue || []), ...mcpResources()] : [...commandsValue]

    const searchValue = search()

    if (!searchValue) {
      return mixed
    }

    if (files.loading && prev && prev.length > 0) {
      return prev
    }

    return rankAutocompleteOptions({
      query: searchValue,
      mode: store.visible as "@" | "/",
      options: mixed,
      frecency,
    })
  })

  createEffect(() => {
    filter()
    options()
    if (!store.visible) return
    lockMouseSelection()
    setStore("selected", 0)
    trace("options.reset-selected", {
      mode: store.visible,
      search: search(),
      optionCount: options().length,
      top: options()[0]?.value ?? options()[0]?.display,
    })
    queueMicrotask(() => {
      if (!store.visible) return
      if (!options().length) return
      moveTo(0)
    })
  })

  function move(direction: -1 | 1) {
    if (!store.visible) return
    if (!options().length) return
    let next = store.selected + direction
    if (next < 0) next = options().length - 1
    if (next >= options().length) next = 0
    moveTo(next)
  }

  const height = createMemo(() => {
    const count = options().length || 1
    if (!store.visible) return Math.min(10, count)
    positionTick()
    return Math.min(10, count, Math.max(1, props.anchor().y))
  })

  let scroll: ScrollBoxRenderable

  function moveTo(next: number) {
    setStore("selected", next)
    trace("moveTo", {
      mode: store.visible,
      selected: next,
      optionCount: options().length,
      selectedValue: options()[next]?.value ?? options()[next]?.display,
      top: options()[0]?.value ?? options()[0]?.display,
      search: search(),
    })
    if (!scroll) return
    const viewportHeight = Math.min(height(), options().length)
    const scrollBottom = scroll.scrollTop + viewportHeight
    if (next < scroll.scrollTop) {
      scroll.scrollBy(next - scroll.scrollTop)
    } else if (next + 1 > scrollBottom) {
      scroll.scrollBy(next + 1 - scrollBottom)
    }
  }

  function select() {
    const selected = options()[store.selected]
    if (!selected) return
    trace("select", {
      mode: store.visible,
      selected: store.selected,
      selectedValue: selected.value ?? selected.display,
      search: search(),
    })
    hide()
    selected.onSelect?.()
  }

  function expandDirectory() {
    const selected = options()[store.selected]
    if (!selected) return

    const input = props.input()
    const cursorOffset = input.cursorOffset

    const displayText = selected.display.trimEnd()
    const path = displayText.startsWith("@") ? displayText.slice(1) : displayText

    input.cursorOffset = store.index
    const startCursor = input.logicalCursor
    input.cursorOffset = cursorOffset
    const endCursor = input.logicalCursor

    input.deleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)
    input.insertText("@" + path)

    setStore("selected", 0)
  }

  function show(mode: "@" | "/") {
    command.keybinds(false)
    lockMouseSelection()
    setStore({
      visible: mode,
      index: props.input().cursorOffset,
    })
    trace("show", {
      mode,
      index: props.input().cursorOffset,
      value: props.value,
      cursorOffset: currentCursorOffset(),
    })
  }

  function hide() {
    trace("hide", {
      mode: store.visible,
      selected: store.selected,
      search: search(),
      optionCount: options().length,
      top: options()[0]?.value ?? options()[0]?.display,
    })
    command.keybinds(true)
    setStore("visible", false)
  }

  function slashSlice(value: string, cursorOffset: number) {
    if (!store.visible) return ""
    if (cursorOffset <= store.index) return ""
    return value.slice(store.index, cursorOffset)
  }

  function handleMouseMove(event: MouseEvent) {
    const next = { x: event.x, y: event.y }
    const previous = lastMousePosition()
    setLastMousePosition(next)
    if (!previous) return
    if (previous.x === next.x && previous.y === next.y) return
    setStore("input", "mouse")
  }

  onMount(() => {
    props.ref({
      get visible() {
        return store.visible
      },
      accept() {
        if (!store.visible) return
        const selected = options()[store.selected]
        if (!selected) return
        if (selected.isDirectory) {
          expandDirectory()
          return
        }
        select()
      },
      onInput(value) {
        setLiveValue(value)
        if (store.visible) {
          const cursorOffset = currentCursorOffset(value)
          const activeSlice = slashSlice(value, cursorOffset)
          const textAfterTrigger = activeSlice.slice(1)
          if (
            // Typed text before the trigger
            cursorOffset <= store.index ||
            // There is a space between the trigger and the cursor
            /\s/.test(textAfterTrigger) ||
            // "/<command>" is not the sole content
            (store.visible === "/" && value.match(/^\S+\s+\S+\s*$/))
          ) {
            hide()
          }
          return
        }

        // Check if autocomplete should reopen (e.g., after backspace deleted a space)
        const offset = currentCursorOffset(value)
        if (offset === 0) return

        // Check for "/" at position 0 - reopen slash commands
        if (value.startsWith("/") && !value.slice(0, offset).match(/\s/)) {
          show("/")
          setStore("index", 0)
          return
        }

        // Check for "@" trigger - find the nearest "@" before cursor with no whitespace between
        const text = value.slice(0, offset)
        const idx = text.lastIndexOf("@")
        if (idx === -1) return

        const between = text.slice(idx)
        const before = idx === 0 ? undefined : value[idx - 1]
        if ((before === undefined || /\s/.test(before)) && !between.match(/\s/)) {
          show("@")
          setStore("index", idx)
        }
      },
      onKeyDown(e: KeyEvent) {
        if (store.visible) {
          const name = e.name?.toLowerCase()
          const ctrlOnly = e.ctrl && !e.meta && !e.shift
          const isNavUp = name === "up" || (ctrlOnly && name === "p")
          const isNavDown = name === "down" || (ctrlOnly && name === "n")

          if (isNavUp) {
            lockMouseSelection()
            move(-1)
            e.preventDefault()
            return
          }
          if (isNavDown) {
            lockMouseSelection()
            move(1)
            e.preventDefault()
            return
          }
          if (name === "escape") {
            hide()
            e.preventDefault()
            return
          }
          if (name === "return" || name === "enter") {
            select()
            e.preventDefault()
            return
          }
          if (name === "tab") {
            const selected = options()[store.selected]
            if (selected?.isDirectory) {
              expandDirectory()
            } else {
              select()
            }
            e.preventDefault()
            return
          }
        }
        if (!store.visible) {
          if (e.name === "@") {
            const cursorOffset = props.input().cursorOffset
            const charBeforeCursor = cursorOffset === 0 ? undefined : currentValue().slice(cursorOffset - 1, cursorOffset)
            const canTrigger = charBeforeCursor === undefined || charBeforeCursor === "" || /\s/.test(charBeforeCursor)
            if (canTrigger) show("@")
          }

          if (e.name === "/") {
            if (props.input().cursorOffset === 0) show("/")
          }
        }
      },
    })
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <box
      visible={store.visible !== false}
      position="absolute"
      top={position().y - height()}
      left={position().x}
      width={position().width}
      zIndex={100}
      {...SplitBorder}
      borderColor={theme.border}
    >
      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        backgroundColor={theme.backgroundMenu}
        height={height()}
        scrollbarOptions={{ visible: false }}
      >
        <Index
          each={options()}
          fallback={
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            <box paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>No matching items</text>
            </box>
          }
        >
          {(option, index) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={index === store.selected ? theme.primary : undefined}
                flexDirection="row"
                onMouseMove={(event: MouseEvent) => {
                  handleMouseMove(event)
                }}
                onMouseOver={() => {
                  if (store.input !== "mouse") return
                  moveTo(index)
                }}
                onMouseDown={() => {
                  setStore("input", "mouse")
                  moveTo(index)
                }}
                onMouseUp={() => select()}
              >
                <text fg={index === store.selected ? selectedForeground(theme) : theme.text} flexShrink={0}>
                  {option().display}
                </text>
                <Show when={option().description}>
                  <text fg={index === store.selected ? selectedForeground(theme) : theme.textMuted} wrapMode="none">
                    {option().description}
                  </text>
                </Show>
              </box>
            )
          }}
        </Index>
      </scrollbox>
    </box>
  )
}
