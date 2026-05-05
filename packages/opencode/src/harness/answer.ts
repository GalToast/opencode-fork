// @ts-nocheck
function scrub(text: string) {
  return normalize(text).replace(/[^a-z0-9_]+/g, " ").trim()
}

function uniq(items: string[]) {
  return [...new Set(items)]
}

function esc(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
}

type Hit = {
  item: string
  idx: number
}

export function normalize(text: string) {
  return text.trim().toLowerCase()
}

export function options(prompt?: string, extra?: readonly string[]) {
  const list = [...(extra ?? [])]
  if (prompt) {
    for (const match of prompt.matchAll(/(?:options|labels):\s*([^\n]+)/gi)) {
      list.push(...match[1].split(","))
    }
  }
  return uniq(
    list
      .map((item) => scrub(item.replace(/[.;:]+$/g, "")))
      .filter(Boolean),
  )
}

function find(text: string, list: readonly string[]) {
  const clean = scrub(text)
  if (!clean) return ""
  if (!list.length) return clean.split(/\s+/)[0] ?? ""
  if (list.includes(clean)) return clean

  const alt = list.map(esc).join("|")
  const cue = new RegExp(
    `(?:^|\\s)(?:choose|chose|pick|picked|select|selected|answer|label|option|return|reply|prefer|preferred|use|using|go\\s+with|went\\s+with|would\\s+choose|would\\s+pick|would\\s+go\\s+with)(?:\\s+(?:is|would|should|be|the|best|right|label|option|to|go|with|i|d)){0,4}\\s+(${alt})(?=$|\\s)`,
    "g",
  )
  let picked = ""
  for (const match of clean.matchAll(cue)) {
    picked = match[1] ?? picked
  }
  if (picked) return picked

  const hits: Hit[] = []
  for (const item of list) {
    const test = new RegExp(`(^|\\s)(${esc(item)})(?=$|\\s)`, "g")
    for (const match of clean.matchAll(test)) {
      hits.push({
        item,
        idx: match.index ?? 0,
      })
    }
  }
  if (!hits.length) return clean.split(/\s+/)[0] ?? ""
  const found = uniq(hits.map((item) => item.item))
  if (found.length === 1) return found[0]
  return hits.sort((a, b) => b.idx - a.idx)[0]?.item ?? ""
}

export function canonical(text: string, prompt?: string, extra?: readonly string[]) {
  return find(text, options(prompt, extra))
}

export function isLooseCorrect(text: string, expected: string, prompt?: string, extra?: readonly string[]) {
  return canonical(text, prompt, extra) === scrub(expected)
}

export function isContractViolation(text: string, expected: string, prompt?: string, extra?: readonly string[]) {
  return normalize(text) !== normalize(expected) && isLooseCorrect(text, expected, prompt, extra)
}

export function isDecisionMiss(text: string, expected: string, prompt?: string, extra?: readonly string[]) {
  return !isLooseCorrect(text, expected, prompt, extra)
}
