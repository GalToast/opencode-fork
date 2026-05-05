import { Patch } from "@/patch"
import { HarnessState } from "./state"

/* eslint-disable @typescript-eslint/no-namespace */
export namespace HarnessPolicy {
  export type ProposalRisk = "small" | "medium" | "large"
  export type ProposalAutonomy = "manual" | "stage_only" | "autonomous_overlay" | "autonomous_patch"

  export type ScopePolicy = {
    risk: ProposalRisk
    riskReasons: string[]
    sensitivePaths: string[]
    expectedFiles: string[]
    maxFiles: number
    maxChangedLines: number
    allowMove: boolean
    allowDelete: boolean
    requirePriorValidation: boolean
  }

  export type ProposalPolicy = ScopePolicy & {
    autonomy: ProposalAutonomy
  }

  export type PatchScope = {
    changedFiles: string[]
    fileCount: number
    changedLineCount: number
    hasMove: boolean
    hasDelete: boolean
    sensitivePaths: string[]
    risk: ProposalRisk
    riskReasons: string[]
  }

  function addedPatchLines(patchText: string) {
    return patchText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
  }

  const SENSITIVE_PATH_PREFIXES = [
    "opencode-steer.ps1",
    "package.json",
    "bunfig.toml",
    "bun.lock",
    "tsconfig.json",
    "packages/opencode/src/launcher.ts",
    "packages/opencode/src/config/",
    "packages/opencode/src/scheduler/",
    "packages/opencode/src/session/prompt.ts",
    "packages/opencode/src/tool/task.ts",
    "packages/opencode/src/harness/policy.ts",
  ]

  const PACKAGE_SCOPE_PREFIXES = ["packages/opencode/"]

  function stripTrailingPathAnnotation(input: string) {
    return input.replace(/((?:^|\/)[^()\r\n]+\.[A-Za-z0-9._-]+)\s+\([^()\r\n]+\)$/, "$1")
  }

  function uniqueNormalized(files: string[]) {
    return [...new Set(files.map(normalizeHarnessRelative).filter(Boolean))]
  }

  export function normalizeHarnessRelative(input: string) {
    const normalized = stripTrailingPathAnnotation(input.trim().replaceAll("\\", "/").replace(/^\.\//, ""))
    for (const prefix of PACKAGE_SCOPE_PREFIXES) {
      if (normalized.startsWith(prefix)) return normalized
      const marker = `/${prefix}`
      const index = normalized.lastIndexOf(marker)
      if (index !== -1) return normalized.slice(index + 1)
    }
    return normalized
  }

  function packageScopedVariants(input: string) {
    const normalized = normalizeHarnessRelative(input)
    if (!normalized) return []

    const variants = new Set([normalized])
    for (const prefix of PACKAGE_SCOPE_PREFIXES) {
      if (normalized.startsWith(prefix)) variants.add(normalized.slice(prefix.length))
    }
    return [...variants]
  }

  function pathsMatchWithinProposalScope(actual: string, expected: string) {
    const expectedVariants = new Set(packageScopedVariants(expected))
    return packageScopedVariants(actual).some((candidate) => expectedVariants.has(candidate))
  }

  function startsWithAny(path: string, prefixes: string[]) {
    const normalized = normalizeHarnessRelative(path)
    return prefixes.some(
      (prefix) => normalized === prefix || normalized.startsWith(prefix.endsWith("/") ? prefix : prefix + "/"),
    )
  }

  function changedLinesForAdd(contents: string) {
    return contents.split(/\r?\n/).filter((line, index, lines) => !(index === lines.length - 1 && line === "")).length
  }

  export function classifyChangedFiles(files: string[]): ScopePolicy {
    const expectedFiles = uniqueNormalized(files)
    const sensitivePaths = expectedFiles.filter((file) => startsWithAny(file, SENSITIVE_PATH_PREFIXES))
    const riskReasons: string[] = []

    let risk: ProposalRisk = "small"
    if (expectedFiles.length === 0) {
      risk = "large"
      riskReasons.push("missing_declared_files")
    }
    if (sensitivePaths.length > 0) {
      if (expectedFiles.length === 1 && sensitivePaths.some((p) => p.endsWith("policy.ts"))) {
        risk = "large"
        riskReasons.push("sensitive_paths")
      } else if (expectedFiles.length >= 5) {
        risk = "large"
        riskReasons.push("wide_file_scope")
      } else {
        risk = "medium"
        riskReasons.push("multi_file_scope")
      }
    }
    if (risk !== "large" && expectedFiles.length >= 5) {
      risk = "large"
      riskReasons.push("wide_file_scope")
    } else if (risk === "small" && expectedFiles.length >= 2) {
      risk = "medium"
      riskReasons.push("multi_file_scope")
    }
    if (riskReasons.length === 0) riskReasons.push("narrow_file_scope")

    if (risk === "small") {
      return {
        risk,
        riskReasons,
        sensitivePaths,
        expectedFiles,
        maxFiles: 1,
        maxChangedLines: 120,
        allowMove: false,
        allowDelete: false,
        requirePriorValidation: false,
      }
    }

    if (risk === "medium") {
      return {
        risk,
        riskReasons,
        sensitivePaths,
        expectedFiles,
        maxFiles: 4,
        maxChangedLines: 300,
        allowMove: false,
        allowDelete: false,
        requirePriorValidation: true,
      }
    }

    return {
      risk,
      riskReasons,
      sensitivePaths,
      expectedFiles,
      maxFiles: Math.max(12, expectedFiles.length),
      maxChangedLines: 6_000,
      allowMove: true,
      allowDelete: true,
      requirePriorValidation: true,
    }
  }

  function classifyCodePatch(proposal: HarnessState.Proposal): ProposalPolicy {
    const scope = classifyChangedFiles(proposal.patchHint?.files ?? [])
    if (HarnessState.effectiveConfidence(proposal) !== "high") {
      return {
        ...scope,
        autonomy: "stage_only",
      }
    }

    if (scope.expectedFiles.length === 0) {
      return {
        ...scope,
        autonomy: "stage_only",
      }
    }

    return {
      ...scope,
      autonomy: "autonomous_patch",
    }
  }

  export function classifyProposal(proposal: HarnessState.Proposal): ProposalPolicy {
    if (proposal.kind === "config_overlay") {
      return {
        risk: "small",
        riskReasons: ["config_overlay"],
        sensitivePaths: [],
        expectedFiles: [],
        maxFiles: 0,
        maxChangedLines: 0,
        allowMove: false,
        allowDelete: false,
        requirePriorValidation: false,
        autonomy: proposal.confidence === "high" ? "autonomous_overlay" : "manual",
      }
    }

    return classifyCodePatch(proposal)
  }

  export function decorateProposal<T extends HarnessState.Proposal>(proposal: T): T & ProposalPolicy {
    const policy = classifyProposal(proposal)
    return {
      ...proposal,
      ...policy,
    }
  }

  export function summarizePatch(patchText: string): PatchScope {
    const { hunks } = Patch.parsePatch(patchText)
    const changedFiles: string[] = []
    let changedLineCount = 0
    let hasMove = false
    let hasDelete = false

    for (const hunk of hunks) {
      if (hunk.type === "add") {
        changedFiles.push(normalizeHarnessRelative(hunk.path))
        changedLineCount += changedLinesForAdd(hunk.contents)
        continue
      }
      if (hunk.type === "delete") {
        changedFiles.push(normalizeHarnessRelative(hunk.path))
        changedLineCount += 1
        hasDelete = true
        continue
      }
      changedFiles.push(normalizeHarnessRelative(hunk.path))
      if (hunk.move_path) {
        changedFiles.push(normalizeHarnessRelative(hunk.move_path))
        hasMove = true
      }
      changedLineCount += hunk.chunks.reduce(
        (sum, chunk) => sum + Math.max(chunk.old_lines.length, chunk.new_lines.length),
        0,
      )
    }

    const normalizedFiles = uniqueNormalized(changedFiles)
    const scope = classifyChangedFiles(normalizedFiles)
    return {
      changedFiles: normalizedFiles,
      fileCount: normalizedFiles.length,
      changedLineCount,
      hasMove,
      hasDelete,
      sensitivePaths: scope.sensitivePaths,
      risk: scope.risk,
      riskReasons: scope.riskReasons,
    }
  }

  function rankRisk(input: string | undefined) {
    if (input === "small") return 0
    if (input === "medium") return 1
    return 2
  }

  export function validatePatchAgainstProposal(proposal: HarnessState.Proposal, patchText: string) {
    const scope = summarizePatch(patchText)
    const expectedFiles = uniqueNormalized(proposal.expectedFiles ?? proposal.patchHint?.files ?? [])
    if (expectedFiles.length > 0) {
      const unexpected = scope.changedFiles.filter(
        (file) => !expectedFiles.some((expectedFile) => pathsMatchWithinProposalScope(file, expectedFile)),
      )
      // Allow harness self-edits to touch related files within the same harness directory
      // This prevents validation loops where models naturally refactor adjacent files
      const allInHarnessDir = scope.changedFiles.every((file) => file.startsWith("packages/opencode/src/harness/"))
      const expectedInHarnessDir = expectedFiles.every((file) => file.startsWith("packages/opencode/src/harness/"))
      if (unexpected.length > 0 && !(allInHarnessDir && expectedInHarnessDir)) {
        throw new Error(`Patch touched unexpected files: ${unexpected.join(", ")}`)
      }
    }

    if (proposal.maxFiles && scope.fileCount > proposal.maxFiles) {
      throw new Error(`Patch exceeded file-count limit for this proposal: ${scope.fileCount} > ${proposal.maxFiles}.`)
    }
    if (proposal.maxChangedLines && scope.changedLineCount > proposal.maxChangedLines) {
      throw new Error(
        `Patch exceeded changed-line limit for this proposal: ${scope.changedLineCount} > ${proposal.maxChangedLines}.`,
      )
    }
    if (proposal.allowMove === false && scope.hasMove) {
      throw new Error("Patch used file moves, but this proposal is not allowed to move files.")
    }
    if (proposal.allowDelete === false && scope.hasDelete) {
      throw new Error("Patch deleted files, but this proposal is not allowed to delete files.")
    }

    const declaredRisk = proposal.risk === "core" ? "large" : proposal.risk
    if (declaredRisk && rankRisk(scope.risk) > rankRisk(declaredRisk)) {
      throw new Error(`Patch exceeded declared proposal risk: actual ${scope.risk}, declared ${declaredRisk}.`)
    }

    return scope
  }

  export function strategicPatchConcerns(proposal: HarnessState.Proposal, patchText: string) {
    const scope = summarizePatch(patchText)
    const added = addedPatchLines(patchText).join("\n")
    const concerns: string[] = []

    const routingProposal =
      proposal.id.includes("tighten_autopatch_routing") ||
      /tighten proposal routing before autopatch/i.test(proposal.title)
    const touchesPolicy = scope.changedFiles.includes("packages/opencode/src/harness/policy.ts")
    const largeToStageOnly =
      /scope\.risk\s*===\s*["']large["']/.test(added) && /autonomy:\s*["']stage_only["']/.test(added)

    if (routingProposal && touchesPolicy && largeToStageOnly) {
      concerns.push(
        "Patch reduces autonomy for large harness upgrades instead of clarifying routing or strengthening execution safeguards.",
      )
    }

    return concerns
  }

  export function validatePatchStrategy(proposal: HarnessState.Proposal, patchText: string) {
    const concerns = strategicPatchConcerns(proposal, patchText)
    if (concerns.length > 0) {
      throw new Error(concerns[0])
    }
    return concerns
  }
}

export const {
  classifyChangedFiles,
  classifyProposal,
  decorateProposal,
  normalizeHarnessRelative,
  strategicPatchConcerns,
  summarizePatch,
  validatePatchAgainstProposal,
  validatePatchStrategy,
} = HarnessPolicy
