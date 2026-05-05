import { RGBA } from "@opentui/core"

type RgbaLike = {
  r: number
  g: number
  b: number
  a?: number
}

function isRgbaLike(value: unknown): value is RgbaLike {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<RgbaLike>
  return (
    typeof candidate.r === "number" &&
    typeof candidate.g === "number" &&
    typeof candidate.b === "number" &&
    (candidate.a === undefined || typeof candidate.a === "number")
  )
}

export function coerceRGBA(value: unknown, fallback?: RGBA): RGBA | undefined {
  if (value instanceof RGBA) return value
  if (isRgbaLike(value)) {
    const useIntChannels = value.r > 1 || value.g > 1 || value.b > 1 || (value.a ?? 1) > 1
    return RGBA.fromInts(
      Math.round(useIntChannels ? value.r : value.r * 255),
      Math.round(useIntChannels ? value.g : value.g * 255),
      Math.round(useIntChannels ? value.b : value.b * 255),
      Math.round(useIntChannels ? (value.a ?? 255) : (value.a ?? 1) * 255),
    )
  }
  return fallback
}

export function scaleRGBAAlpha(value: unknown, factor: number, fallback?: RGBA): RGBA | undefined {
  const color = coerceRGBA(value)
  if (!color) return fallback
  return RGBA.fromInts(
    Math.round(color.r * 255),
    Math.round(color.g * 255),
    Math.round(color.b * 255),
    Math.round(color.a * 255 * factor),
  )
}
