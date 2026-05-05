import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import { RGBA, type RGBA as RGBAType } from "@opentui/core"
import { Log } from "@/util/log"

export type SignalMode =
  | "dispatching"
  | "writing"
  | "processing"
  | "thinking"
  | "waiting"
  | "responding"
  | "idle"
  | "stalled"
  | "settled"

export type SignalPressure = "cool" | "warm" | "hot"
export type SignalIntensity = "calm" | "active" | "crowded" | "stressed"
export type SignalAttention = "inward" | "outward" | "forward" | "suspended"
export type SignalEvent = "interrupt" | "subagent_return" | "accepted_baton" | "compaction_handoff" | "recovery"

type SignalSpec = {
  mood: string
  interval: number
  body: string[]
  rail: string[]
  aura: string[]
  shell: string[]
  atmosphere: string[]
  attention: SignalAttention
  specialBeat?: {
    every: number
    frames: string[]
  }
}

type ParticleState = {
  left: string
  right: string
}

const log = Log.create({ service: "spinner" })

type SpinStats = {
  next: number
  live: number
  mounts: number
  unmounts: number
  ticks: number
  chars: number
  spans: number
  logs: number
}

function spinStats() {
  const root = globalThis as typeof globalThis & { __opencodeSpinStats?: SpinStats }
  root.__opencodeSpinStats ??= {
    next: 1,
    live: 0,
    mounts: 0,
    unmounts: 0,
    ticks: 0,
    chars: 0,
    spans: 0,
    logs: 0,
  }
  return root.__opencodeSpinStats
}

function spinLog(on: boolean, msg: string, data?: Record<string, unknown>) {
  if (!on) return
  if (data) log.info(msg, data)
  else log.info(msg)
}

const TRANSITION_FRAMES = [
  " ⠁⟨~(  )···~⟩⠂ ",
  " ⠂⟪≈(◌ )::≈⟫⠁ ",
  "·⟬≋((◎))**≋⟭·",
  " ⠁⟪≈(◉ )::≈⟫⠂ ",
  " ~⟨~((◉))···~⟩~ ",
]

const EVENT_FRAMES: Record<SignalEvent, string[]> = {
  interrupt: ["!⟬!<(•﹏•)>!⟭!", "·⟪!<(-_-)>!⟫·", "!⟨!<(•﹏•)>!⟩!", "·⟪:<(_ _)>:⟫·"],
  subagent_return: ["°⟪°(•◕•)°••⟫°", "✦⟬✦(•◡•)✦°•⟭✦", "°⟪°(•ᴗ•)°••⟫°", "·⟨✦(•◡•)✦··⟩·"],
  accepted_baton: ["✦⟬✦((◉))✦⟭✦", "°⟪✦(•◕•)✦⟫°", "·⟨✦(•◡•)✦⟩·", "°⟪◎(•◡•)◎⟫°"],
  compaction_handoff: ["~⟦~(◌◡◌)~⟧~", "·⟪≈(◎◡◎)≈⟫·", "~⟦~(◌◡◌)~⟧~", "⠁⟨:(◌◡◌):⟩⠂"],
  recovery: ["·⟪·(x_x)·⟫·", "⠂⟬°(•﹏•)°⟭⠁", "°⟨✦(•◡•)✦⟩°", "·⟨~(•◡•)~⟩·"],
}

const SIGNALS: Record<SignalMode, SignalSpec> = {
  dispatching: {
    mood: "alert",
    interval: 72,
    body: ["(•◡•)", "(•◠•)", "(•◕•)", "(•◠•)", "(•◡•)", "(•◟•)"],
    rail: ["▂▃▅▇", "▃▅▇█", "▅▇█▆", "▇█▆▄", "█▆▄▂", "▆▄▂▁"],
    aura: ["~", "≈", "≋", "≈", "~", "·"],
    shell: ["⟨", "⟪", "⟬", "⟪", "⟨", "⟦"],
    atmosphere: ["·", ":", "*", ":", "·", "·"],
    attention: "forward",
  },
  writing: {
    mood: "inscribing",
    interval: 78,
    body: ["(✎◜◡◝)", "(✎◠◠)", "(✎◡◡)", "(✎◠◠)", "(✎◜◡◝)", "(✎◟◞)"],
    rail: ["▁▃▅█╾", "▂▄▆█╾", "▃▅▇█╾", "▄▆█▇╾", "▅▇█▆╾", "▄▆▇▅╾"],
    aura: ["≈", "≋", "≈", "✦", "≈", "·"],
    shell: ["⟬", "⟪", "⟨", "⟪", "⟬", "⟨"],
    atmosphere: ["»", "›", "✦", "›", "»", "✦"],
    attention: "forward",
    specialBeat: {
      every: 4,
      frames: ["⟬✦▆█▇╾(✎◕◡◕)»⟭", "⟪≈█▇▆╾(✎◠◠)›⟫"],
    },
  },
  processing: {
    mood: "driven",
    interval: 90,
    body: ["(~◜_◝)", "(~◠_◠)", "(~◡_◡)", "(~◠_◠)", "(~◜_◝)", "(~◟_◞)"],
    rail: ["▁▃▆█▆", "▂▄▇█▇", "▃▅█▇█", "▄▆█▆▄", "▅▇█▅▃", "▄▆█▆▄"],
    aura: ["≈", "≋", "≈", "~", "≈", "·"],
    shell: ["⟦", "⟨", "⟪", "⟬", "⟪", "⟨"],
    atmosphere: ["·", ":", "*", ":", "·", ":"],
    attention: "forward",
  },
  thinking: {
    mood: "absorbed",
    interval: 106,
    body: ["(◔◡◔)", "(◑◡◐)", "(◕◠◕)", "(◑◡◐)", "(◔◡◔)", "(◌◡◎)"],
    rail: ["·▂▄▂·", ":▃▅▃:", "*▄▆▄*", ":▅▇▅:", "·▄▆▄·", ":▃▅▃:"],
    aura: ["~", "≈", "≋", "≈", "~", "·"],
    shell: ["⟬", "⟪", "⟨", "⟦", "⟨", "⟪"],
    atmosphere: ["·", "·", ":", "·", "·", ":"],
    attention: "inward",
  },
  waiting: {
    mood: "listening",
    interval: 196,
    body: ["(－◡－)", "(－﹏－)", "(－◠－)", "(－◌－)", "(－◠－)", "(－﹏－)", "(－◡－)", "(－◠－)", "(－ ·－)", "(－◌－)"],
    rail: ["~▁▂▂▂▁~", "~▁▂▃▂▁~", "~▂▂▃▂▂~", "~▂▃▄▃▂~", "~▂▂▃▂▂~", "~▁▂▃▂▁~", "~▁▂▂▂▁~", "~▁▂▃▂▁~"],
    aura: ["~", "·", ":", "·", "⠂", "·", "~", "·"],
    shell: ["⟦", "⟨", "⟪", "⟬", "⟪", "⟨", "⟦", "⟨"],
    atmosphere: ["·", "⠂", "·", "⠁", "·", "⠂", "·", "⠁"],
    attention: "suspended",
    specialBeat: {
      every: 6,
      frames: ["⟬~(－◡－)~⠁◌⠂~⟭", "⟪·(－﹏－)·⠂◎⠁·⟫", "⟨:(－◌－):⠁◎⠂:⟩", "⟪·(－ ·－)·⠂◉⠁·⟫"],
    },
  },
  responding: {
    mood: "expressive",
    interval: 70,
    body: ["(•◡•)", "(•ᴗ•)", "(•◕•)", "(•◠•)", "(•◡•)", "(•^•)"],
    rail: ["▂▃»", "▃▄▅›", "▄▅▆█»", "▅▆█▇›", "▆█▇▅»", "█▇▅▄›"],
    aura: ["~", "≈", "≋", "≈", "~", "✦"],
    shell: ["⟨", "⟪", "⟬", "⟪", "⟨", "⟦"],
    atmosphere: ["»", "›", "✦", "›", "»", "✦"],
    attention: "forward",
    specialBeat: {
      every: 5,
      frames: ["⟬✦▆█▇✦(•◕•)✦⟭", "⟪✦█▇▅✦(•ᴗ•)»⟫"],
    },
  },
  idle: {
    mood: "dormant",
    interval: 420,
    body: ["( -.- )", "( - o )", "( -.- )", "( -.- )", "( o.- )", "( -.- )", "( -.- )", "( - o )", "( -.- )", "( -.- )", "( -.- )", "( .-. )", "( -.- )", "( -.- )"],
    rail: ["··╴╶··", "·╴··╶·", "··╶╴··", "·╶··╴·", "··╴╶··", "·╴··╶·", "··╶╴··", "·╶··╴·", "··╴╶··", "·╴··╶·"],
    aura: ["·", " ", "·", " ", "°", " ", "·", " ", "⠁", " "],
    shell: ["⟦", "⟦", "⟨", "⟨", "⟦", "⟨", "⟦", "⟨", "⟦", "⟨"],
    atmosphere: [" ", "·", " ", "°", " ", "·", " ", "⠁", " ", "⠂"],
    attention: "suspended",
    specialBeat: {
      every: 12,
      frames: ["⟦( - o )··╴╶··⟧", "⟨( o.- )·╶··╴·⟩", "⟦·( -.- )·╴╶·°⟧", "⟨:( -.- ):⠁╶⠂⟩", "⟦⠁( .-. )⠂╴╶·⟧", "⟨·( -.- )·╶⠁╴⟩"],
    },
  },
  stalled: {
    mood: "wounded",
    interval: 126,
    body: ["(×_×)", "(×﹏×)", "(x_x)", "(×﹏×)", "(×_×)", "(x﹏x)"],
    rail: ["!▁▁!▁", "·▁!▁·", "!▁█▁!", "·!▁!·", "!▁▁!▁", ".▁·▁."],
    aura: ["!", "·", "!", ".", "!", "·"],
    shell: ["⟪", "⟬", "⟪", "⟨", "⟪", "⟬"],
    atmosphere: ["!", ".", "!", ":", "!", "."],
    attention: "outward",
    specialBeat: {
      every: 3,
      frames: ["⟬!(x_x)!▁·█·▁!⟭", "⟪.(×﹏×).▁ ▁ .⟫"],
    },
  },
  settled: {
    mood: "satisfied",
    interval: 262,
    body: ["( ˘◡˘ )", "( ˘◡˘ )", "( ˘◡˘ )", "( ˘◡˘ )"],
    rail: ["──╼╾──", "─╼──╾─", "──╾╼──", "─╾──╼─"],
    aura: ["·", "·", "·", "·"],
    shell: ["⟦", "⟨", "⟦", "⟨"],
    atmosphere: ["°", "·", "°", "·"],
    attention: "suspended",
  },
}

function pressureAccent(pressure: SignalPressure) {
  if (pressure === "hot") return "✦"
  if (pressure === "warm") return "•"
  return "·"
}

function pulseWrap(mode: SignalMode, pressure: SignalPressure, intensity: SignalIntensity, frame: number) {
  if (mode === "stalled") return frame % 2 === 0 ? ["!", "!"] as const : [".", "."] as const
  if (mode === "idle" || mode === "settled") {
    if (mode === "idle") {
      if (frame % 22 === 0) return ["~", "~"] as const
      if (frame % 11 === 0) return ["·", "·"] as const
      return [" ", " "] as const
    }
    if (frame % 16 === 0) return ["~", "~"] as const
    if (frame % 9 === 0) return ["·", "·"] as const
    return [" ", " "] as const
  }
  if (mode === "waiting") {
    if (frame % 8 === 0) return ["~", "~"] as const
    if (frame % 5 === 0) return ["·", "·"] as const
    return [" ", " "] as const
  }
  if (pressure === "hot") return frame % 3 === 0 ? ["✦", "✦"] as const : ["•", "•"] as const
  if (intensity === "crowded" || intensity === "stressed") return frame % 2 === 0 ? ["°", "•"] as const : ["•", "°"] as const
  return frame % 4 === 0 ? ["~", "~"] as const : [" ", " "] as const
}

function driftParticles(mode: SignalMode, pressure: SignalPressure, intensity: SignalIntensity, frame: number): ParticleState {
  const calm = [" ", " ", "·", " "]
  const idle = [" ", " ", "⠁", " ", "·", " ", "⠂", " ", " ", "⠁", " "]
  const waiting = ["⠁", " ", "⠂", "·", " ", "⠂", " "]
  const warm = ["·", "°", "•", "·"]
  const hot = ["•", "✦", "•", "°"]
  const hurt = ["!", ".", "!", ":"]
  const set =
    mode === "stalled"
      ? hurt
      : mode === "waiting"
        ? waiting
        : mode === "idle" || mode === "settled"
          ? idle
      : pressure === "hot"
        ? hot
        : pressure === "warm" || intensity === "crowded"
          ? warm
          : calm
  return {
    left: set[frame % set.length] ?? " ",
    right: set[(frame + 2) % set.length] ?? " ",
  }
}

function auraEcho(aura: string, frame: number, mode: SignalMode) {
  if (mode === "idle") return frame % 16 === 0 ? aura : frame % 23 === 0 ? "·" : " "
  if (mode === "settled") return frame % 10 === 0 ? aura : " "
  if (mode === "waiting") return frame % 7 === 0 ? aura : frame % 4 === 0 ? "·" : " "
  if (mode === "stalled") return frame % 2 === 0 ? "!" : aura
  return frame % 3 === 0 ? aura : frame % 2 === 0 ? "·" : " "
}

function childOrbit(count: number, frame: number) {
  if (count <= 0) return ""
  const capped = Math.min(3, count)
  const orbits = ["°", "•", "·"]
  let output = ""
  for (let i = 0; i < capped; i++) {
    output += orbits[(frame + i) % orbits.length]
  }
  return output
}

function attentionWrap(attention: SignalAttention, body: string, rail: string) {
  if (attention === "forward") return `${rail}${body}»`
  if (attention === "inward") return `«${body}${rail}`
  if (attention === "outward") return `:${body}${rail}:`
  return `${body}${rail}`
}

function intensityRail(rail: string, intensity: SignalIntensity) {
  if (intensity === "crowded") return rail + "≈"
  if (intensity === "stressed") return rail.replace(/─/g, "━").replace(/·/g, "!")
  if (intensity === "active") return rail
  return rail.replace(/[█▇▆▅]/g, "▅")
}

function pressureTint(mode: SignalMode, pressure: SignalPressure) {
  if (mode === "stalled") return "hot"
  return pressure
}

function specialBeatEvery(
  beat: NonNullable<SignalSpec["specialBeat"]>,
  opts: {
    mode: SignalMode
    pressure: SignalPressure
    intensity: SignalIntensity
    children: number
  },
) {
  let every = beat.every
  if (opts.pressure === "hot") every = Math.max(2, every - 2)
  else if (opts.pressure === "warm") every = Math.max(2, every - 1)

  if (opts.intensity === "crowded") every = Math.max(2, every - 1)
  if (opts.intensity === "stressed") every = Math.max(2, every - 2)

  if (opts.children >= 2) every = Math.max(2, every - 1)
  if (opts.mode === "idle") {
    every += 2
    if (opts.children > 0) every = Math.max(6, every - 1)
  }
  if (opts.mode === "waiting") {
    every += 1
  }
  return every
}

function specialBeatFrames(
  beat: NonNullable<SignalSpec["specialBeat"]>,
  opts: {
    mode: SignalMode
    pressure: SignalPressure
    intensity: SignalIntensity
    children: number
  },
) {
  const orbit = childOrbit(opts.children, 0)
  const accent = pressureAccent(pressureTint(opts.mode, opts.pressure))
  return beat.frames.map((frame) => {
    let next = frame
    if (orbit) next = next.replace(/⟭$|⟫$|⟩$|⟧$/, `${orbit}$&`)
    if (opts.intensity === "stressed") next = next.replace(/·/g, "!")
    if (opts.pressure !== "cool") next = next.replace(/~|°|✦|◎|◌/, `${accent}$&`)
    return next
  })
}

function composeFrame(
  spec: SignalSpec,
  frame: number,
  opts: {
    pressure: SignalPressure
    intensity: SignalIntensity
    children: number
    mode: SignalMode
  },
) {
  const body = spec.body[frame % spec.body.length]
  const rail = intensityRail(spec.rail[frame % spec.rail.length], opts.intensity)
  const aura = spec.aura[frame % spec.aura.length]
  const shell = spec.shell[frame % spec.shell.length]
  const atmosphere = spec.atmosphere[frame % spec.atmosphere.length]
  const orbit = childOrbit(opts.children, frame)
  const tunedPressure = pressureAccent(pressureTint(opts.mode, opts.pressure))
  const pulse = pulseWrap(opts.mode, opts.pressure, opts.intensity, frame)
  const particles = driftParticles(opts.mode, opts.pressure, opts.intensity, frame)
  const echo = auraEcho(aura, frame + 1, opts.mode)
  const center = attentionWrap(spec.attention, body, rail)
  return `${particles.left}${pulse[0]}${shell}${echo}${aura}${center}${orbit}${atmosphere}${tunedPressure}${echo}${shell}${pulse[1]}${particles.right}`
}

function frameWidth(frame: string) {
  return Array.from(frame).length
}

function padFrame(frame: string, width: number) {
  const padding = Math.max(0, width - frameWidth(frame))
  return frame + " ".repeat(padding)
}

function computeSignalStageWidth() {
  let width = 0
  const pressures: SignalPressure[] = ["cool", "warm", "hot"]
  const intensities: SignalIntensity[] = ["calm", "active", "crowded", "stressed"]

  for (const frames of Object.values(EVENT_FRAMES)) {
    for (const frame of frames) width = Math.max(width, frameWidth(frame))
  }

  for (const frame of TRANSITION_FRAMES) {
    width = Math.max(width, frameWidth(frame))
  }

  for (const [mode, spec] of Object.entries(SIGNALS) as Array<[SignalMode, SignalSpec]>) {
    const frameCount = Math.max(spec.body.length, spec.rail.length)
    for (const pressure of pressures) {
      for (const intensity of intensities) {
        for (let children = 0; children <= 3; children++) {
          for (let frame = 0; frame < frameCount; frame++) {
            width = Math.max(
              width,
              frameWidth(
                composeFrame(spec, frame, {
                  pressure,
                  intensity,
                  children,
                  mode,
                }),
              ),
            )
          }

          if (spec.specialBeat) {
            const frames = specialBeatFrames(spec.specialBeat, {
              mode,
              pressure,
              intensity,
              children,
            })
            for (const frame of frames) width = Math.max(width, frameWidth(frame))
          }
        }
      }
    }
  }

  return width
}

const SIGNAL_STAGE_WIDTH = computeSignalStageWidth()

function signalGlyphColor(input: {
  char: string
  theme: ReturnType<typeof useTheme>["theme"]
  mode: SignalMode
  pressure: SignalPressure
  event?: SignalEvent
  ember: number
  baton: number
  scar: number
}) {
  const { char, theme, mode, pressure, event, ember, baton, scar } = input
  if ("⟨⟪⟬⟦⟩⟫⟭⟧[]()╱╲".includes(char)) {
    if (baton > 0.5) return theme.primary
    if (scar > 0.58) return theme.warning
    return pressure === "hot" || ember > 0.7 ? theme.warning : theme.border
  }
  if ("◉◎◌✦!╳".includes(char)) {
    if (event === "subagent_return" || event === "recovery") return theme.success
    if (event === "accepted_baton") return theme.primary
    if (baton > 0.82) return theme.text
    if (baton > 0.66) return theme.primary
    if (event === "compaction_handoff") return theme.secondary
    if (mode === "stalled" || event === "interrupt" || scar > 0.72) return theme.warning
    if (pressure === "hot" || ember > 0.72) return theme.warning
    if (ember > 0.48) return theme.primary
    if (pressure === "warm") return theme.primary
    return theme.secondary
  }
  if ("~≈≋:°•*⠁⠂".includes(char)) {
    if (mode === "stalled" || event === "interrupt" || scar > 0.68) return theme.warning
    if (event === "subagent_return" || event === "recovery") return theme.success
    if (baton > 0.56) return theme.primary
    if (event === "compaction_handoff") return theme.secondary
    return pressure === "hot" || ember > 0.68 ? theme.warning : ember > 0.36 ? theme.secondary : theme.textMuted
  }
  if ("▁▂▃▄▅▆▇█╾╴╶─━».‹›".includes(char)) {
    if (mode === "settled") return theme.success
    if (mode === "waiting") return theme.secondary
    return pressure === "hot" || ember > 0.62 || scar > 0.62 ? theme.warning : theme.primary
  }
  return theme.text
}

function pulseCore(mode: SignalMode, pressure: SignalPressure, event: SignalEvent | undefined, baton: number, scar: number, frame: number) {
  if (event === "accepted_baton" || baton > 0.82) return ["◌", "◎", "◉", "✦", "◉", "◎", "✦", "◉", "◎", "◌"]
  if (baton > 0.48) return ["◌", "◎", "◉", "◎", "✦", "◉", "◎", "◉"]
  if (event === "subagent_return") return ["◌", "◉", "✦", "◉", "◎", "◌"]
  if (event === "interrupt" || mode === "stalled" || scar > 0.82) return ["!", "◌", "!", "◉", "!"]
  if (scar > 0.44) return ["◌", "!", "◌", "◉", "◌"]
  if (event === "compaction_handoff") return ["◌", "◎", "◌", "◎", "◌"]
  if (event === "recovery") return ["◌", "◉", "◌", "✦", "◌"]
  if (mode === "idle") return frame % 28 === 0 ? ["◌", "◉", "◎", "◌"] : frame % 17 === 0 ? ["◌", "◉", "◌", "◌"] : ["◌", "◎", "◌", "◌", "◌"]
  if (mode === "waiting") return frame % 14 === 0 ? ["◌", "◉", "◌", "◎", "◌"] : ["◌", "◎", "◌", "◌", "◌"]
  if (mode === "settled") return ["◌", "◉", "◌", "✦", "◌"]
  if (pressure === "hot") return ["◉", "◎", "◉", "✦", "◎"]
  if (pressure === "warm") return ["◌", "◉", "◎", "◉", "◌"]
  return ["◌", "◉", "◌", "◎", "◌"]
}

function infuseCore(frame: string, core: string) {
  const chars = Array.from(frame)
  const target = chars.findIndex((char) => "◉◎◌✦!╳".includes(char))
  if (target === -1) return frame
  chars[target] = core
  return chars.join("")
}

function scarDistort(frame: string, scar: number, frameIndex: number, mode: SignalMode, event: SignalEvent | undefined) {
  if (scar < 0.18 && mode !== "stalled" && event !== "interrupt") return frame

  const chars = Array.from(frame)
  const openings = chars.reduce<number[]>((all, char, index) => {
    if ("⟨⟪⟬⟦([".includes(char)) all.push(index)
    return all
  }, [])
  const closings = chars.reduce<number[]>((all, char, index) => {
    if ("⟩⟫⟭⟧)]".includes(char)) all.push(index)
    return all
  }, [])
  const aura = chars.reduce<number[]>((all, char, index) => {
    if ("~≈≋°•*⠁⠂·:".includes(char)) all.push(index)
    return all
  }, [])
  const rails = chars.reduce<number[]>((all, char, index) => {
    if ("▁▂▃▄▅▆▇█╾╴╶─━».‹›".includes(char)) all.push(index)
    return all
  }, [])

  if (scar > 0.26 && aura.length > 0) chars[aura[frameIndex % aura.length]] = "!"
  if (scar > 0.4 && openings.length > 0) chars[openings[frameIndex % openings.length]] = "╱"
  if (scar > 0.4 && closings.length > 0) chars[closings[(frameIndex + 1) % closings.length]] = "╲"
  if (scar > 0.58 && rails.length > 0) chars[rails[(frameIndex + 2) % rails.length]] = "╳"
  if ((scar > 0.76 || mode === "stalled" || event === "interrupt") && aura.length > 1) {
    chars[aura[(frameIndex + 3) % aura.length]] = frameIndex % 2 === 0 ? ":" : "!"
  }

  return chars.join("")
}

export function Spinner(props: {
  children?: JSX.Element
  color?: RGBA
  elapsed?: string
  mode?: SignalMode
  pressure?: SignalPressure
  intensity?: SignalIntensity
  childCount?: number
  event?: SignalEvent
}) {
  const { theme } = useTheme()
  const kv = useKV()
  const id = spinStats().next++
  const [frame, setFrame] = createSignal(0)
  const [cycle, setCycle] = createSignal(0)
  const [displayMode, setDisplayMode] = createSignal<SignalMode>(props.mode ?? "processing")
  const [transitionStep, setTransitionStep] = createSignal(0)
  const [eventStep, setEventStep] = createSignal(0)
  const [activeEvent, setActiveEvent] = createSignal<SignalEvent | undefined>(undefined)
  const [ember, setEmber] = createSignal(0)
  const [baton, setBaton] = createSignal(0)
  const [scar, setScar] = createSignal(0)
  const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
  const debug = createMemo(() => kv.get("spinner_debug_metrics", false))
  const mode = createMemo<SignalMode>(() => props.mode ?? "processing")
  const event = createMemo(() => props.event)
  const color = () => props.color ?? theme.textMuted
  const pressure = createMemo<SignalPressure>(() => props.pressure ?? "cool")
  const intensity = createMemo<SignalIntensity>(() => props.intensity ?? "active")
  const childCount = createMemo(() => props.childCount ?? 0)
  const spec = createMemo(() => SIGNALS[displayMode()])

  {
    const stats = spinStats()
    stats.live += 1
    stats.mounts += 1
    spinLog(debug(), "mount", {
      id,
      live: stats.live,
      mode: mode(),
      pressure: pressure(),
      intensity: intensity(),
      children: childCount(),
    })
    onCleanup(() => {
      const next = spinStats()
      next.live = Math.max(0, next.live - 1)
      next.unmounts += 1
      spinLog(debug(), "unmount", {
        id,
        live: next.live,
        ticks: next.ticks,
        chars: next.chars,
        spans: next.spans,
      })
    })
  }

  createEffect(() => {
    const next = mode()
    if (next === displayMode()) return
    if (displayMode() === "stalled" && next !== "stalled") {
      setActiveEvent("recovery")
      setEventStep(animationsEnabled() ? EVENT_FRAMES.recovery.length : 0)
    }
    setDisplayMode(next)
    setFrame(0)
    setCycle(0)
    setTransitionStep(animationsEnabled() ? TRANSITION_FRAMES.length : 0)
  })

  createEffect(() => {
    const next = event()
    if (!next) return
    setActiveEvent(next)
    setEventStep(animationsEnabled() ? EVENT_FRAMES[next].length : 0)
  })

  createEffect(() => {
    if (!animationsEnabled()) return
    const interval = setInterval(() => {
      const stats = spinStats()
      stats.ticks += 1
      const frameCount = Math.max(spec().body.length, spec().rail.length)
      setFrame((value) => {
        const next = (value + 1) % frameCount
        if (next === 0) setCycle((count) => count + 1)
        return next
      })
      setTransitionStep((value) => Math.max(0, value - 1))
      setEventStep((value) => Math.max(0, value - 1))
      const target =
        activeEvent() === "interrupt"
          ? 1
          : activeEvent() === "subagent_return" || activeEvent() === "accepted_baton"
            ? 0.82
            : activeEvent() === "compaction_handoff"
              ? 0.58
              : activeEvent() === "recovery"
                ? 0.42
                : mode() === "stalled"
                  ? 0.78
                  : pressure() === "hot"
                    ? 0.64
                    : pressure() === "warm"
                      ? 0.34
                      : mode() === "waiting"
                        ? 0.22
                        : mode() === "idle" || mode() === "settled"
                          ? 0.1
                          : 0.2
      setEmber((value) => value + (target - value) * (target > value ? 0.24 : 0.08))
      const batonTarget =
        activeEvent() === "accepted_baton"
          ? 1
          : activeEvent() === "subagent_return"
            ? 0.54
            : activeEvent() === "recovery"
              ? 0.38
              : baton() > 0.01
                ? 0
                : 0
      setBaton((value) => value + (batonTarget - value) * (batonTarget > value ? 0.34 : 0.035))
      const scarTarget =
        activeEvent() === "interrupt"
          ? 1
          : mode() === "stalled"
            ? 0.82
            : activeEvent() === "recovery"
              ? 0.46
              : scar() > 0.01
                ? 0
                : 0
      setScar((value) => value + (scarTarget - value) * (scarTarget > value ? 0.28 : 0.04))
      if (debug() && stats.ticks % 120 === 0) {
        stats.logs += 1
        spinLog(true, "tick", {
          id,
          live: stats.live,
          ticks: stats.ticks,
          chars: stats.chars,
          spans: stats.spans,
          mode: displayMode(),
          event: activeEvent(),
          stage: SIGNAL_STAGE_WIDTH,
        })
      }
    }, spec().interval)
    onCleanup(() => clearInterval(interval))
  })

  const signal = createMemo(() => {
    if (eventStep() > 0 && activeEvent()) {
      const frames = EVENT_FRAMES[activeEvent()!]
      const index = (frames.length - eventStep()) % frames.length
      const coreFrames = pulseCore(mode(), pressure(), activeEvent(), baton(), scar(), frame())
      return scarDistort(
        infuseCore(frames[index] ?? "", coreFrames[index % coreFrames.length] ?? "◉"),
        scar(),
        frame(),
        mode(),
        activeEvent(),
      )
    }
    if (transitionStep() > 0) {
      const index = (TRANSITION_FRAMES.length - transitionStep()) % TRANSITION_FRAMES.length
      const coreFrames = pulseCore(mode(), pressure(), activeEvent(), baton(), scar(), frame())
      return scarDistort(
        infuseCore(TRANSITION_FRAMES[index] ?? "", coreFrames[index % coreFrames.length] ?? "◉"),
        scar(),
        frame(),
        mode(),
        activeEvent(),
      )
    }
    const beat = spec().specialBeat
    const beatOpts = {
      mode: displayMode(),
      pressure: pressure(),
      intensity: intensity(),
      children: childCount(),
    }
    const reactiveBeatFrames = beat ? specialBeatFrames(beat, beatOpts) : undefined
    const reactiveBeatEvery = beat ? specialBeatEvery(beat, beatOpts) : undefined
    if (beat && reactiveBeatEvery && reactiveBeatFrames && cycle() > 0 && cycle() % reactiveBeatEvery === 0 && frame() < reactiveBeatFrames.length) {
      const coreFrames = pulseCore(mode(), pressure(), activeEvent(), baton(), scar(), frame())
      return scarDistort(
        infuseCore(reactiveBeatFrames[frame()] ?? "", coreFrames[frame() % coreFrames.length] ?? "◉"),
        scar(),
        frame(),
        mode(),
        activeEvent(),
      )
    }
    const base = composeFrame(spec(), frame(), {
      pressure: pressure(),
      intensity: intensity(),
      children: childCount(),
      mode: displayMode(),
    })
    const coreFrames = pulseCore(mode(), pressure(), activeEvent(), baton(), scar(), frame())
    return scarDistort(
      infuseCore(base, coreFrames[frame() % coreFrames.length] ?? "◉"),
      scar(),
      frame(),
      mode(),
      activeEvent(),
    )
  })

  const fallbackGlyph = createMemo(() =>
    padFrame(
      composeFrame(spec(), 0, {
        pressure: pressure(),
        intensity: intensity(),
        children: childCount(),
        mode: displayMode(),
      }),
      SIGNAL_STAGE_WIDTH,
    ),
  )

  const _fg = createMemo(() => {
    if (activeEvent() === "interrupt") return theme.warning
    if (activeEvent() === "subagent_return") return theme.success
    if (activeEvent() === "accepted_baton") return theme.text
    if (activeEvent() === "compaction_handoff") return theme.secondary
    if (activeEvent() === "recovery") return theme.success
    if (baton() > 0.8) return theme.text
    if (baton() > 0.56) return theme.primary
    if (scar() > 0.64) return theme.warning
    if (mode() === "stalled") return theme.warning
    if (mode() === "idle") return pressure() === "warm" || ember() > 0.4 ? theme.text : theme.textMuted
    if (mode() === "settled") return theme.success
    if (mode() === "waiting") return pressure() === "hot" ? theme.warning : theme.secondary
    if (pressure() === "hot" || ember() > 0.68) return theme.warning
    if (pressure() === "warm") return theme.primary
    return theme.primary
  })

  const bg = createMemo<RGBAType | undefined>(() => {
    if (activeEvent() === "interrupt") return RGBA.fromInts(52, 24, 18, 104)
    if (activeEvent() === "subagent_return") return RGBA.fromInts(18, 40, 28, 92)
    if (activeEvent() === "accepted_baton") return RGBA.fromInts(24, 38, 62, 104)
    if (activeEvent() === "compaction_handoff") return RGBA.fromInts(26, 22, 44, 88)
    if (activeEvent() === "recovery") return RGBA.fromInts(18, 36, 28, 82)
    if (baton() > 0.7) return RGBA.fromInts(24, 38, 62, Math.round(62 + baton() * 22))
    if (baton() > 0.42) return RGBA.fromInts(20, 32, 52, Math.round(54 + baton() * 24))
    if (scar() > 0.4) return RGBA.fromInts(42, 22, 18, Math.round(48 + scar() * 20))
    if (mode() === "idle") return pressure() === "warm" || ember() > 0.34 ? RGBA.fromInts(30, 28, 36, Math.round(44 + ember() * 22)) : undefined
    if (mode() === "settled") return RGBA.fromInts(18, 34, 28, 60)
    if (mode() === "waiting") return pressure() === "hot" ? RGBA.fromInts(44, 34, 18, 72) : RGBA.fromInts(24, 28, 40, 64)
    if (mode() === "stalled") return RGBA.fromInts(44, 20, 20, 82)
    if (pressure() === "hot" || ember() > 0.68) return RGBA.fromInts(44, 28, 18, Math.round(56 + ember() * 26))
    if (pressure() === "warm") return RGBA.fromInts(24, 28, 40, 52)
    return undefined
  })
  const coloredSignal = createMemo(() => {
    const text = padFrame(signal(), SIGNAL_STAGE_WIDTH)
    const parts = Array.from(text).map((char) => ({
      char,
      fg: signalGlyphColor({
        char,
        theme,
        mode: mode(),
        pressure: pressure(),
        event: activeEvent(),
        ember: ember(),
        baton: baton(),
        scar: scar(),
      }),
    }))
    const stats = spinStats()
    stats.chars += text.length
    stats.spans += parts.length
    return parts
  })

  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
  return (
    <Show when={animationsEnabled()} fallback={<text fg={color()}>{fallbackGlyph()} {props.children}</text>}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text bg={bg()}>
          {coloredSignal().map((part) => (
            <span style={{ fg: part.fg }}>{part.char}</span>
          ))}
        </text>
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
        <Show when={props.elapsed}>
          <text fg={theme.textMuted}>· {props.elapsed}</text>
        </Show>
      </box>
    </Show>
  )
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
}
