export function resolveAutocompleteOptionIndex(index: number | (() => number)) {
  return typeof index === "function" ? index() : index
}
