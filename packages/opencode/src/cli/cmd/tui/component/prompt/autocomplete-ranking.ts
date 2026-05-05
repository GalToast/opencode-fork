import fuzzysort from "fuzzysort"

export type RankedAutocompleteOption = {
  display: string
  value?: string
  aliases?: string[]
  description?: string
  disabled?: boolean
  isDirectory?: boolean
  onSelect?: () => void
  path?: string
}

function removeLineRange(input: string) {
  const hashIndex = input.lastIndexOf("#")
  return hashIndex !== -1 ? input.substring(0, hashIndex) : input
}

function matchesSlashPrefix(option: RankedAutocompleteOption, query: string) {
  if (!query) return false
  const needle = query.toLowerCase()
  const primary = (option.value ?? option.display).trimEnd().toLowerCase()
  if (primary.startsWith("/" + needle)) return true
  return option.aliases?.some((alias) => alias.toLowerCase().startsWith("/" + needle)) ?? false
}

export function rankAutocompleteOptions<T extends RankedAutocompleteOption>(
  input: {
    query: string
    mode: "@" | "/"
    options: T[]
    frecency: { getFrecency: (path: string) => number }
  },
) {
  const { query, mode, options, frecency } = input
  if (!query) return options

  const result = fuzzysort.go(removeLineRange(query), options, {
    keys: [
      (obj) => removeLineRange((obj.value ?? obj.display).trimEnd()),
      "description",
      (obj) => obj.aliases?.join(" ") ?? "",
    ],
    limit: 10,
    scoreFn: (objResults) => {
      const displayResult = objResults[0]
      let score = objResults.score
      if (displayResult && displayResult.target.startsWith(mode + query)) {
        score *= 2
      }
      const frecencyScore = objResults.obj.path ? frecency.getFrecency(objResults.obj.path) : 0
      return score * (1 + frecencyScore)
    },
  })

  const ranked = result.map((arr) => arr.obj)
  if (mode !== "/") return ranked

  return [...ranked].sort((a, b) => {
    const aPrefix = matchesSlashPrefix(a, query)
    const bPrefix = matchesSlashPrefix(b, query)
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1
    return 0
  })
}
