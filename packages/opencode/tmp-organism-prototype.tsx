import { createMemo, For, type JSX } from "solid-js"
import { RGBA } from "@opentui/core"

type Mood = "calm" | "curious" | "focused" | "strained" | "startled" | "triumphant" | "sleeping"
type Attention = "inward" | "forward" | "outward" | "suspended"
type Breath = "slow" | "medium" | "fast"
type Stimulus = "idle" | "typing" | "submit" | "tool" | "error" | "return" | "wait"

type OrganismState = {
  mood: Mood
  attention: Attention
  breath: Breath
  stress: number
  energy: number
  charge: number
  childCount: number
  contextPressure: number
  stimulus: Stimulus
  blink: boolean
  pulse: number
  frame: number
}

type OrganismFrame = {
  lines: [string, string, string]
  bodyColor: RGBA
  auraColor: RGBA
  coreColor: RGBA
  chromeColor: RGBA
  label: string
}

const slate = RGBA.fromInts(128, 142, 160, 255)
const mist = RGBA.fromInts(164, 180, 196, 255)
const ice = RGBA.fromInts(138, 192, 255, 255)
const glow = RGBA.fromInts(118, 222, 210, 255)
const ember = RGBA.fromInts(255, 176, 112, 255)
const warning = RGBA.fromInts(255, 118, 96, 255)
const violet = RGBA.fromInts(188, 156, 255, 255)

function orbit(count: number, frame: number) {
  if (count <= 0) return " "
  const glyphs = ["·", "°", "•"]
  return glyphs[(frame + count) % glyphs.length] ?? "·"
}

function eyes(state: OrganismState) {
  if (state.blink) return "◡ ◡"
  if (state.mood === "sleeping") return "─ ─"
  if (state.mood === "startled") return "◉ ◉"
  if (state.mood === "strained") return "◔ ◔"
  if (state.mood === "triumphant") return "✦ ✦"
  if (state.attention === "outward") return "◉ ◌"
  if (state.attention === "inward") return "◌ ◉"
  return "◉ ◉"
}

function core(state: OrganismState) {
  if (state.mood === "strained") return "╳"
  if (state.mood === "triumphant") return "✦"
  if (state.stimulus === "submit") return "◎"
  if (state.stimulus === "error") return "!"
  if (state.stimulus === "return") return "◈"
  return state.charge > 0.7 ? "◉" : "•"
}

function shell(state: OrganismState) {
  if (state.mood === "sleeping") return ["⟦", "⟧"] as const
  if (state.mood === "startled") return ["⟪", "⟫"] as const
  if (state.mood === "strained") return ["⟬", "⟭"] as const
  return ["⟨", "⟩"] as const
}

function breathTrail(state: OrganismState) {
  if (state.breath === "slow") return state.frame % 2 === 0 ? "~   ~" : " ~ ~ "
  if (state.breath === "fast") return state.frame % 2 === 0 ? "≈ ≈ ≈" : " ≋ ≋ "
  return state.frame % 2 === 0 ? "~ ≈ ~" : " ≈≈ "
}

function halo(state: OrganismState) {
  if (state.stimulus === "error") return ["·", "!", "·"]
  if (state.stimulus === "submit") return ["°", "✦", "°"]
  if (state.stimulus === "return") return ["°", "◈", "°"]
  if (state.childCount > 0) return [orbit(state.childCount, state.frame), "·", orbit(state.childCount + 1, state.frame)]
  return state.frame % 2 === 0 ? ["·", " ", "·"] : [" ", "°", " "]
}

function palette(state: OrganismState) {
  if (state.stimulus === "error" || state.mood === "strained") {
    return {
      bodyColor: mist,
      auraColor: warning,
      coreColor: warning,
      chromeColor: warning,
    }
  }
  if (state.mood === "triumphant") {
    return {
      bodyColor: glow,
      auraColor: violet,
      coreColor: ember,
      chromeColor: violet,
    }
  }
  if (state.childCount > 0 || state.stimulus === "tool") {
    return {
      bodyColor: ice,
      auraColor: violet,
      coreColor: glow,
      chromeColor: ice,
    }
  }
  return {
    bodyColor: mist,
    auraColor: slate,
    coreColor: ice,
    chromeColor: slate,
  }
}

function organismFrame(state: OrganismState): OrganismFrame {
  const ring = halo(state)
  const face = eyes(state)
  const seed = core(state)
  const edge = shell(state)
  const colors = palette(state)
  const inhale = state.pulse > 0.66 ? "╭" : state.pulse > 0.33 ? "(" : " "
  const exhale = state.pulse > 0.66 ? "╮" : state.pulse > 0.33 ? ")" : " "

  return {
    lines: [
      `${ring[0]} ${inhale}${ring[1]}${exhale} ${ring[2]}`,
      `${edge[0]} ${face} ${seed} ${edge[1]}`,
      `${breathTrail(state)}`,
    ],
    ...colors,
    label: `${state.mood} / ${state.attention} / ${state.stimulus}`,
  }
}

function OrganismPreview(props: { state: OrganismState }) {
  const frame = createMemo(() => organismFrame(props.state))
  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="column">
        <text fg={frame().auraColor}>{frame().lines[0]}</text>
        <text fg={frame().bodyColor}>{frame().lines[1]}</text>
        <text fg={frame().auraColor}>{frame().lines[2]}</text>
      </box>
      <text fg={frame().chromeColor}>{frame().label}</text>
    </box>
  )
}

const PRESETS: Array<{ name: string; state: OrganismState }> = [
  {
    name: "idle breathing",
    state: {
      mood: "calm",
      attention: "suspended",
      breath: "slow",
      stress: 0.08,
      energy: 0.24,
      charge: 0.1,
      childCount: 0,
      contextPressure: 0.18,
      stimulus: "idle",
      blink: false,
      pulse: 0.22,
      frame: 0,
    },
  },
  {
    name: "typing curiosity",
    state: {
      mood: "curious",
      attention: "forward",
      breath: "medium",
      stress: 0.16,
      energy: 0.52,
      charge: 0.32,
      childCount: 0,
      contextPressure: 0.24,
      stimulus: "typing",
      blink: false,
      pulse: 0.48,
      frame: 1,
    },
  },
  {
    name: "submission launch",
    state: {
      mood: "focused",
      attention: "forward",
      breath: "fast",
      stress: 0.34,
      energy: 0.84,
      charge: 0.92,
      childCount: 0,
      contextPressure: 0.42,
      stimulus: "submit",
      blink: false,
      pulse: 0.88,
      frame: 2,
    },
  },
  {
    name: "swarm handling",
    state: {
      mood: "focused",
      attention: "outward",
      breath: "medium",
      stress: 0.52,
      energy: 0.78,
      charge: 0.66,
      childCount: 3,
      contextPressure: 0.64,
      stimulus: "tool",
      blink: false,
      pulse: 0.54,
      frame: 3,
    },
  },
  {
    name: "error wound",
    state: {
      mood: "strained",
      attention: "outward",
      breath: "fast",
      stress: 0.91,
      energy: 0.46,
      charge: 0.2,
      childCount: 1,
      contextPressure: 0.86,
      stimulus: "error",
      blink: true,
      pulse: 0.72,
      frame: 4,
    },
  },
  {
    name: "return glow",
    state: {
      mood: "triumphant",
      attention: "forward",
      breath: "medium",
      stress: 0.18,
      energy: 0.74,
      charge: 0.82,
      childCount: 2,
      contextPressure: 0.4,
      stimulus: "return",
      blink: false,
      pulse: 0.64,
      frame: 5,
    },
  },
]

export function OrganismPrototypeGallery(): JSX.Element {
  return (
    <box flexDirection="column" gap={1}>
      <text fg={ice}>Organism prototype gallery</text>
      <For each={PRESETS}>
        {(preset) => (
          <box flexDirection="column" paddingLeft={1}>
            <text fg={slate}>{preset.name}</text>
            <OrganismPreview state={preset.state} />
          </box>
        )}
      </For>
    </box>
  )
}

/*
Prototype notes:

1. This file is intentionally not wired into the live TUI.
2. The key change is treating the organism as a persistent 3-line body, not a single spinner rail.
3. The existing shell-signal system can feed this body later:
   - mood from climate + recent events
   - attention from waiting/responding/typing
   - breath from stress/charge
   - orbiters from childCount
   - blink/startle from prompt and error events
4. The next real implementation should put state accumulation in a shared organism context,
   then let header/footer/sidebar/transcript render different facets of the same creature.
*/
