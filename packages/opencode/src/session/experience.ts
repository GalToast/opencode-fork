function clip(input: string | undefined, max: number) {
  const clipped = input?.trim()
  if (!clipped) return undefined
  if (clipped.length <= max) return clipped
  return clipped.slice(0, Math.max(1, max - 3)).trimEnd() + "..."
}

function norm(input: string) {
  return input.replace(/\s+/g, " ").trim()
}

export function text(parts: Array<{ type: string; text?: string; synthetic?: boolean }>) {
  return parts
    .filter((part): part is { type: "text"; text: string; synthetic?: boolean } => part.type === "text" && !!part.text)
    .filter((part) => !part.synthetic)
    .map((part) => part.text)
    .join("\n")
}

export function intent(input: string, max = 96) {
  const value = norm(input)
  if (!value) return "No user intent captured yet."
  return clip(value, max) ?? "No user intent captured yet."
}

export function constraints(input: string, max = 160) {
  const value = norm(input)
  if (!value) return undefined
  const items = value
    .split(/[\n.!?]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const hits = items.filter((item) =>
    /\b(must|need to|should|avoid|don't|do not|only|without|with|keep|prefer|never|always|limit)\b/i.test(item),
  )
  const picked = (hits.length > 0 ? hits : items.slice(0, 1)).slice(0, 3).join("; ")
  if (!picked) return undefined
  return clip(picked, max)
}

export function cues(input: string) {
  const value = norm(input).toLowerCase()
  const words = value ? value.split(/\s+/).length : 0
  return {
    words,
    correction:
      /\b(wrong|incorrect|instead|actually|rather|not that|that's not|should have|meant|i said|no,|no\.)\b/i.test(
        value,
      ),
    frustration:
      /\b(fuck|fucking|damn|annoying|frustrating|broken|stuck|hanging|hang|loop|looping|crash|crashing|why are you|why is this)\b/i.test(
        value,
      ),
    ui: /\b(terminal|tui|ui|interface|prompt|popup|restart|session|conversation|chat)\b/i.test(value),
    restart: /\b(restart|relaunch|rebuild|reload)\b/i.test(value),
  }
}
