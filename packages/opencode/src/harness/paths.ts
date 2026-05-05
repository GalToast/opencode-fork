import { existsSync } from "fs"
import path from "path"

const PACKAGE_ROOT_SEGMENTS = ["packages", "opencode"] as const
const PACKAGE_ENTRY_SEGMENTS = ["packages", "opencode", "src", "index.ts"] as const
const NESTED_PACKAGE_ENTRY_SEGMENTS = ["opencode", "src", "index.ts"] as const
const DIRECT_PACKAGE_ENTRY_SEGMENTS = ["src", "index.ts"] as const
const NESTED_PACKAGE_SEGMENTS = ["opencode", "src"] as const
const DIRECT_PACKAGE_SEGMENTS = ["src"] as const

function hasEntry(root: string, segments: readonly string[]) {
  return existsSync(path.join(root, ...segments))
}

export function canonicalHarnessSourceRoot(input?: string, fallback = process.cwd()) {
  const root = path.resolve(input || fallback)
  if (hasEntry(root, PACKAGE_ENTRY_SEGMENTS)) return root
  if (
    path.basename(root) === "packages" &&
    (hasEntry(root, NESTED_PACKAGE_ENTRY_SEGMENTS) || hasEntry(root, NESTED_PACKAGE_SEGMENTS))
  ) {
    return path.resolve(root, "..")
  }
  if (
    path.basename(root) === "opencode" &&
    path.basename(path.dirname(root)) === "packages" &&
    (hasEntry(root, DIRECT_PACKAGE_ENTRY_SEGMENTS) || hasEntry(root, DIRECT_PACKAGE_SEGMENTS))
  ) {
    return path.resolve(root, "..", "..")
  }
  return root
}

export function resolveHarnessSourcePath(file: string, root?: string) {
  if (path.isAbsolute(file)) return path.normalize(file)
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "")
  return path.join(canonicalHarnessSourceRoot(root), ...normalized.split("/"))
}

export function harnessPackageRoot(root?: string) {
  return path.join(canonicalHarnessSourceRoot(root), ...PACKAGE_ROOT_SEGMENTS)
}
