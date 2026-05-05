import path from "path"
import { Patch } from "@/patch"
import { Filesystem } from "@/util/filesystem"
import { classifyChangedFiles } from "./policy"
import { HarnessState } from "./state"

export type VerifyPlanSource = "explicit" | "review" | "default" | "none"
export type VerifyPlanRisk = "small" | "medium" | "large"

export type VerifyPlanRequirements = {
  minCommands: number
  requirePostApply: boolean
}

export type VerifyPlan = {
  proposalID?: string
  patchPath?: string
  reviewReportPath?: string
  generatedAt: number
  source: VerifyPlanSource
  sources: VerifyPlanSource[]
  risk: VerifyPlanRisk
  requirements: VerifyPlanRequirements
  commands: string[]
  changedFiles: string[]
  rationale: string
}

function normalizeRelative(input: string) {
  return input.replaceAll("\\", "/").replace(/^\.\//, "")
}

function normalizeVerifyCommands(commands: string[] | undefined) {
  return [...new Set((commands ?? []).map((item) => item.trim()).filter((item) => item && item.toLowerCase() !== "none"))]
}

export function changedFilesFromPatch(patchText: string) {
  const parsed = Patch.parsePatch(patchText)
  return [...new Set(parsed.hunks.flatMap((hunk) => {
    if (hunk.type === "update" && hunk.move_path) {
      return [normalizeRelative(hunk.path), normalizeRelative(hunk.move_path)]
    }
    return [normalizeRelative(hunk.path)]
  }))]
}

export function defaultVerifyCommands(paths: string[]) {
  const normalized = paths.map(normalizeRelative)
  const commands: string[] = []
  if (normalized.some((file) => file === "opencode-steer.ps1" || file === "packages/opencode/src/launcher.ts")) {
    commands.push("bun test test/launcher.test.ts --timeout 30000")
  }
  if (normalized.some((file) => file.startsWith("packages/opencode/src/harness/") || file.startsWith("packages/opencode/test/harness/"))) {
    commands.push(
      "bun test test/harness/generate.test.ts test/harness/review.test.ts --timeout 30000",
      "bun test test/harness/self-edit.test.ts test/harness/state.test.ts test/harness/verify.test.ts --timeout 30000",
    )
  }
  if (
    normalized.some(
      (file) =>
        file === "opencode-steer.ps1" ||
        file === "packages/opencode/src/launcher.ts" ||
        file.startsWith("packages/opencode/src/config/"),
    )
  ) {
    commands.push("bun test test/config/config.test.ts test/mcp/local-cwd.test.ts --timeout 30000")
    commands.push("bun test test/harness/generate.test.ts test/harness/self-edit.test.ts test/harness/verify.test.ts --timeout 30000")
  }
  if (
    normalized.some(
      (file) =>
        file.startsWith("packages/opencode/src/session/") ||
        file.startsWith("packages/opencode/src/tool/task") ||
        file.startsWith("packages/opencode/test/session/") ||
        file.startsWith("packages/opencode/test/tool/"),
    )
  ) {
    commands.push("bun test test/session/prompt.test.ts test/session/llm.test.ts --timeout 30000")
    commands.push("bun test test/tool/task-lane.test.ts test/tool/task-mailbox-smoke.test.ts --timeout 30000")
  }
  if (normalized.some((file) => file === "packages/opencode/src/provider/transform.ts" || file === "packages/opencode/test/provider/transform.test.ts")) {
    commands.push("bun test test/provider/transform.test.ts --timeout 30000")
  }
  if (normalized.some((file) => file === "packages/opencode/src/provider/provider.ts" || file === "packages/opencode/test/provider/provider.test.ts")) {
    commands.push("bun test test/provider/provider.test.ts --timeout 30000")
  }
  if (normalized.some((file) => file === "packages/opencode/src/session/llm.ts" || file === "packages/opencode/test/session/llm.test.ts")) {
    commands.push("bun test test/session/llm.test.ts --timeout 30000")
  }
  return [...new Set(commands)]
}

function normalizeRisk(input: HarnessState.ProposalRisk | VerifyPlanRisk | undefined, changedFiles: string[]): VerifyPlanRisk {
  if (input === "large" || input === "core") return "large"
  if (input === "medium") return "medium"
  if (input === "small") return "small"
  return classifyChangedFiles(changedFiles).risk
}

function requirementsForRisk(risk: VerifyPlanRisk): VerifyPlanRequirements {
  if (risk === "small") {
    return {
      minCommands: 1,
      requirePostApply: false,
    }
  }
  if (risk === "medium") {
    return {
      minCommands: 2,
      requirePostApply: false,
    }
  }
  return {
    minCommands: 2,
    requirePostApply: true,
  }
}

export function buildVerifyPlan(input: {
  proposalID?: string
  patchText: string
  patchPath?: string
  reviewReportPath?: string
  explicitCommands?: string[]
  reviewCommands?: string[]
  risk?: HarnessState.ProposalRisk | VerifyPlanRisk
}): VerifyPlan {
  const changedFiles = changedFilesFromPatch(input.patchText)
  const defaults = defaultVerifyCommands(changedFiles)
  const explicit = normalizeVerifyCommands(input.explicitCommands)
  const review = normalizeVerifyCommands(input.reviewCommands)
  const sources: VerifyPlanSource[] = []
  if (explicit.length > 0) sources.push("explicit")
  if (review.length > 0) sources.push("review")
  if (defaults.length > 0) sources.push("default")

  const source: VerifyPlanSource =
    explicit.length > 0 ? "explicit" : review.length > 0 ? "review" : defaults.length > 0 ? "default" : "none"
  const commands = [...new Set([...explicit, ...review, ...defaults])]
  const risk = normalizeRisk(input.risk, changedFiles)
  const requirements = requirementsForRisk(risk)

  const rationale =
    sources.length === 0
      ? `No suitable verification commands were derived from the patch, review, or operator input. ${risk} risk live apply requires ${requirements.minCommands} verification command(s).`
      : `Using merged verification coverage from ${sources.join(", ")} sources. ${risk} risk live apply requires ${requirements.minCommands} verification command(s)${requirements.requirePostApply ? " and post-apply re-verification." : "."}`

  return {
    proposalID: input.proposalID,
    patchPath: input.patchPath,
    reviewReportPath: input.reviewReportPath,
    generatedAt: Date.now(),
    source,
    sources,
    risk,
    requirements,
    commands,
    changedFiles,
    rationale,
  }
}

export function proposalVerifyPlanPath(proposalID: string) {
  return path.join(HarnessState.reviewDir(), proposalID, "verify.plan.json")
}

export function executionVerifyPlanPath(artifactDir: string) {
  return path.join(artifactDir, "verify.plan.json")
}

export async function writeVerifyPlan(filepath: string, plan: VerifyPlan) {
  await Filesystem.writeJson(filepath, plan)
  return filepath
}
