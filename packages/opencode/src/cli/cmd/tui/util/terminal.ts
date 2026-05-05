import { RGBA } from "@opentui/core"

export type TerminalColors = {
  background: RGBA | null
  foreground: RGBA | null
  colors: RGBA[]
}

function parseTerminalColor(colorStr: string): RGBA | null {
  if (colorStr.startsWith("rgb:")) {
    const parts = colorStr.substring(4).split("/")
    return RGBA.fromInts(
      parseInt(parts[0], 16) >> 8,
      parseInt(parts[1], 16) >> 8,
      parseInt(parts[2], 16) >> 8,
      255,
    )
  }
  if (colorStr.startsWith("#")) {
    return RGBA.fromHex(colorStr)
  }
  if (colorStr.startsWith("rgb(")) {
    const parts = colorStr.substring(4, colorStr.length - 1).split(",")
    return RGBA.fromInts(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]), 255)
  }
  return null
}

export async function getTerminalColors(): Promise<TerminalColors> {
  if (!process.stdin.isTTY) {
    return { background: null, foreground: null, colors: [] }
  }

  return new Promise((resolve) => {
    let background: RGBA | null = null
    let foreground: RGBA | null = null
    const paletteColors: RGBA[] = []
    const handler = (data: Buffer) => {
      const str = data.toString()

      const bgMatch = str.match(/\x1b]11;([^\x07\x1b]+)/)
      if (bgMatch) background = parseTerminalColor(bgMatch[1])

      const fgMatch = str.match(/\x1b]10;([^\x07\x1b]+)/)
      if (fgMatch) foreground = parseTerminalColor(fgMatch[1])

      const paletteMatches = str.matchAll(/\x1b]4;(\d+);([^\x07\x1b]+)/g)
      for (const match of paletteMatches) {
        const index = parseInt(match[1])
        const color = parseTerminalColor(match[2])
        if (color) paletteColors[index] = color
      }

      if (paletteColors.filter((color) => color !== undefined).length === 16) {
        cleanup()
        resolve({ background, foreground, colors: paletteColors })
      }
    }

    // eslint-disable-next-line prefer-const
    let timeout: NodeJS.Timeout
    function cleanup() {
      process.stdin.setRawMode(false)
      process.stdin.removeListener("data", handler)
      clearTimeout(timeout)
    }

    timeout = setTimeout(() => {
      cleanup()
      resolve({ background, foreground, colors: paletteColors })
    }, 1000)

    process.stdin.setRawMode(true)
    process.stdin.on("data", handler)
    process.stdout.write("\x1b]11;?\x07")
    process.stdout.write("\x1b]10;?\x07")
    for (let i = 0; i < 16; i++) {
      process.stdout.write(`\x1b]4;${i};?\x07`)
    }
  })
}

export async function getTerminalBackgroundColor(): Promise<"dark" | "light"> {
  const result = await getTerminalColors()
  if (!result.background) return "dark"

  const { r, g, b } = result.background
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? "light" : "dark"
}
