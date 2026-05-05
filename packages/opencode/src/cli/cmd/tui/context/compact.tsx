import { createContext, useContext, createMemo, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"

const CompactContext = createContext<{
  isCompact: () => boolean
}>()

export function CompactProvider(props: { children: JSX.Element }) {
  const dimensions = useTerminalDimensions()
  const COMPACT_THRESHOLD = 100

  const isCompact = createMemo(() => {
    return dimensions().width < COMPACT_THRESHOLD
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <CompactContext.Provider value={{ isCompact }}>
      {props.children}
    </CompactContext.Provider>
  )
}

export function useCompact() {
  const context = useContext(CompactContext)
  if (!context) {
    throw new Error("useCompact must be used within a CompactProvider")
  }
  return context
}
