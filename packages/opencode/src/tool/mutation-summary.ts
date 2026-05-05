export type FileMutationRecord = {
  file: string
  additions?: number
  deletions?: number
  type?: "add" | "update" | "delete" | "move"
}

export type MutationSummary = {
  fileCount: number
  additions: number
  deletions: number
  created: number
  modified: number
  deleted: number
  moved: number
  primaryFile?: string
  text: string
}

export function summarizeMutations(input: { files: FileMutationRecord[] }): MutationSummary {
  const files = input.files.filter((item) => item.file)
  const additions = files.reduce((sum, item) => sum + Math.max(0, item.additions ?? 0), 0)
  const deletions = files.reduce((sum, item) => sum + Math.max(0, item.deletions ?? 0), 0)
  const created = files.filter((item) => item.type === "add").length
  const modified = files.filter((item) => item.type === "update" || !item.type).length
  const deleted = files.filter((item) => item.type === "delete").length
  const moved = files.filter((item) => item.type === "move").length
  const fileCount = files.length
  const primaryFile = files[0]?.file
  const parts = [
    `${fileCount} ${fileCount === 1 ? "file" : "files"}`,
    additions > 0 || deletions > 0 ? `+${additions}/-${deletions}` : undefined,
    created > 0 ? `${created} new` : undefined,
    modified > 0 ? `${modified} modified` : undefined,
    deleted > 0 ? `${deleted} deleted` : undefined,
    moved > 0 ? `${moved} moved` : undefined,
    primaryFile,
  ].filter(Boolean)

  return {
    fileCount,
    additions,
    deletions,
    created,
    modified,
    deleted,
    moved,
    primaryFile,
    text: parts.join(" | "),
  }
}
