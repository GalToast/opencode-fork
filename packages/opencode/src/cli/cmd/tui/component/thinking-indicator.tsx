import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Spinner, type SignalEvent, type SignalIntensity, type SignalMode, type SignalPressure } from "./spinner"

const MODE_LABELS: Partial<Record<SignalMode, string[]>> = {
  thinking: ["Signal tracing", "Pattern hunting", "Threading intent", "Resolving pressure"],
  writing: ["Inscribing change", "Etching patch flow", "Committing the contour", "Writing the seam"],
  waiting: ["Holding the line", "Listening outward", "Suspending the signal", "Awaiting return"],
  dispatching: ["Routing the lane", "Waking the stack", "Priming the field", "Launching intent"],
  responding: ["Throwing the reply", "Casting the answer", "Carrying signal", "Voice in motion"],
  processing: ["Driving the machinery", "Turning the gears", "Pushing the circuit", "Working the stack"],
}

export function ThinkingIndicator(props: {
  isThinking: boolean
  mode?: SignalMode
  pressure?: SignalPressure
  intensity?: SignalIntensity
  childCount?: number
  event?: SignalEvent
  compact?: boolean
}) {
  const [frame, setFrame] = createSignal(0)
  const mode = createMemo<SignalMode>(() => props.mode ?? (props.isThinking ? "thinking" : "idle"))
  const labels = createMemo(() => MODE_LABELS[mode()] ?? ["Signal idle"])
  const label = createMemo(() => labels()[Math.floor(frame() / 3) % labels().length] ?? "Signal idle")

  createEffect(() => {
    if (mode() === "idle" || mode() === "settled") return
    const frameInterval = setInterval(() => {
      setFrame((f) => (f + 1) % (labels().length * 3))
    }, 80)
    onCleanup(() => {
      clearInterval(frameInterval)
    })
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    <Spinner
      mode={mode()}
      pressure={props.pressure}
      intensity={props.intensity}
      childCount={props.childCount}
      event={props.event}
    >
      {props.compact ? undefined : mode() === "idle" || mode() === "settled" ? "Signal idle" : label()}
    </Spinner>
  )
}
