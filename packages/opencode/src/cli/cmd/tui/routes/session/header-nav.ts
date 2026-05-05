import { Locale } from "../../../../../util/locale"

export function deriveParentNavLabel(width: number, title?: string) {
  if (width < 96) return "Back"
  if (width < 150) return "Return"
  if (width < 190) return "Return to parent"
  if (!title) return "Return to parent"
  return `Return | ${Locale.truncate(title, Math.max(12, Math.min(26, width - 178)))}`
}
