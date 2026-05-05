function truncate(input: string | undefined, limit = 28) {
  if (!input) return undefined
  const normalized = input.trim()
  if (!normalized) return undefined
  if (normalized.length <= limit) return normalized
  return normalized.slice(0, Math.max(0, limit - 1)).trimEnd() + "..."
}

export function plainEnglishUpgradeDetail(input: string | undefined, limit = 30) {
  if (!input) return undefined
  let text = input.trim()
  text = text.replace(/^learn more directly from\s+/i, "")
  text = text.replace(/^address\s+/i, "")
  text = text.replace(/^preserve\s+/i, "")
  text = text.replace(/^reduce\s+/i, "")
  text = text.replace(/^accelerate\s+/i, "")
  text = text.replace(/\bterminal operator\b/gi, "terminal")
  text = text.replace(/\bharness\b/gi, "")
  text = text.replace(/\s+/g, " ").trim()
  if (!text) return undefined
  return truncate(text.charAt(0).toLowerCase() + text.slice(1), limit)
}

export function launchUpgradeMessage(detail: string | undefined) {
  if (!detail) return "A validated harness upgrade from the last session is active on this launch."
  return `Harness upgrade active: ${detail}. You should notice the improvement on this launch.`
}
