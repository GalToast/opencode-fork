import path from "path"
import { cp, mkdir, readdir, rm, stat, symlink, unlink } from "fs/promises"
import { existsSync } from "fs"
import { Identifier } from "@/id/id"
import { Patch } from "@/patch"
import { Filesystem } from "@/util/filesystem"
import { Lock } from "@/util/lock"
import { Process } from "@/util/process"
import { activeWorkerManifestPath, markPendingWorkerActivation, pendingWorkerManifestPath } from "./hotswap"
import { canonicalHarnessSourceRoot } from "./paths"
import { validatePatchAgainstProposal } from "./policy"
import { HarnessState } from "./state"
import { plainEnglishUpgradeDetail } from "./ux"
import { buildVerifyPlan, executionVerifyPlanPath, type VerifyPlan } from "./verify"
import { Shell } from "@/shell/shell"

type ExecuteInput = {
  proposalID?: string
  patchText: string
  verifyPlan?: VerifyPlan
  verifyCommands?: string[]
  applyLive?: boolean
  allowUnverifiedLive?: boolean
  verifyCommandTimeoutMS?: number
}

type ChangeSummary =
  | { type: "add"; path: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; unifiedDiff: string }

type VerifyResult = {
  command: string
  code: number
  stdout: string
  stderr: string
  durationMS: number
  phase: "shadow" | "live"
}

type PlannedOperation =
  | { type: "add"; target: string; relativePath: string; content: string }
  | { type: "delete"; target: string; relativePath: string }
  | { type: "update"; target: string; relativePath: string; newContent: string }
  | { type: "move"; source: string; target: string; relativePath: string; movePath: string; newContent: string }

type BackupEntry = {
  path: string
  existed: boolean
  content?: string
}

const ROOT_FILES = ["package.json", "bunfig.toml", "bun.lock", "tsconfig.json", "opencode-steer.ps1"]
const PACKAGE_ROOT = path.join("packages", "opencode")
const MAX_SHADOW_DIRS = 6
const MAX_EXECUTION_DIRS = 6
const ALLOWED_PREFIXES = [
  PACKAGE_ROOT,
  "opencode-steer.ps1",
  "package.json",
  "bunfig.toml",
  "bun.lock",
  "tsconfig.json",
]

function harnessRoot() {
  return process.env.OPENCODE_HARNESS_ROOT || process.cwd()
}

function sourceRoot() {
  return canonicalHarnessSourceRoot(process.env.OPENCODE_HARNESS_SOURCE_ROOT, process.cwd())
}

function executionsDir() {
  return path.join(harnessRoot(), ".opencode", "runtime", "harness", "executions")
}

function shadowRoot(executionID: string) {
  return path.join(sourceRoot(), ".opencode", "runtime", "harness", "shadow", executionID)
}

function shadowDir() {
  return path.join(sourceRoot(), ".opencode", "runtime", "harness", "shadow")
}

function liveLockPath() {
  return path.join(sourceRoot(), ".opencode", "runtime", "harness", "live-apply")
}

function normalizeRelative(input: string) {
  return input.replaceAll("\\", "/").replace(/^\.\//, "")
}

function isAllowedTarget(relativePath: string) {
  const normalized = normalizeRelative(relativePath)
  return ALLOWED_PREFIXES.map(normalizeRelative).some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix + "/"),
  )
}

function shellCommand(command: string) {
  if (process.platform === "win32") {
    const shell = Shell.preferred()
    const shellName = Shell.name(shell)
    if (shellName === "pwsh" || shellName === "powershell") {
      return [shell, "-NoProfile", "-Command", command]
    }
    return [shell, "/c", command]
  }
  return ["sh", "-lc", command]
}

function liveApplyRequirements(plan: VerifyPlan) {
  return plan.requirements
}

function packageCopyFilter(sourcePath: string) {
  const relative = normalizeRelative(path.relative(path.join(sourceRoot(), PACKAGE_ROOT), sourcePath))
  if (!relative || relative === ".") return true
  const parts = relative.split("/")
  return !parts.some((part) =>
    [
      "node_modules",
      "dist",
      ".opencode",
      "reports",
      "coverage",
      "junit-control-plane.xml",
      "junit-soak.xml",
      "junit-task-mailbox.xml",
      "nul",
    ].includes(part),
  )
}

async function copyIfPresent(from: string, to: string, filter?: (sourcePath: string) => boolean) {
  if (!existsSync(from)) return
  await mkdir(path.dirname(to), { recursive: true })
  await cp(from, to, { recursive: true, force: true, filter })
}

async function prepareShadowWorkspace(target: string) {
  await rm(target, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(target, { recursive: true })
  for (const relative of ROOT_FILES) {
    await copyIfPresent(path.join(sourceRoot(), relative), path.join(target, relative))
  }
  await copyIfPresent(path.join(sourceRoot(), "patches"), path.join(target, "patches"))
  await copyIfPresent(path.join(sourceRoot(), PACKAGE_ROOT), path.join(target, PACKAGE_ROOT), packageCopyFilter)
  const sourceNodeModules = path.join(sourceRoot(), "node_modules")
  const shadowNodeModules = path.join(target, "node_modules")
  if (existsSync(sourceNodeModules)) {
    await symlink(sourceNodeModules, shadowNodeModules, "junction").catch(async () => {
      await copyIfPresent(sourceNodeModules, shadowNodeModules)
    })
  }
  const sourcePackageNodeModules = path.join(sourceRoot(), PACKAGE_ROOT, "node_modules")
  const shadowPackageNodeModules = path.join(target, PACKAGE_ROOT, "node_modules")
  if (existsSync(sourcePackageNodeModules)) {
    await symlink(sourcePackageNodeModules, shadowPackageNodeModules, "junction").catch(() => undefined)
  }
}

async function preservedExecutionIDs() {
  const ids = new Set<string>()
  for (const target of [activeWorkerManifestPath(), pendingWorkerManifestPath()]) {
    const manifest = await Filesystem.readJson<{ executionID?: string }>(target).catch(() => undefined)
    if (manifest?.executionID) ids.add(manifest.executionID)
  }
  return ids
}

async function pruneArtifactDirs(root: string, keep: Set<string>, max: number) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const dirs = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const target = path.join(root, entry.name)
          const info = await stat(target).catch(() => undefined)
          if (!info?.isDirectory()) return
          return {
            name: entry.name,
            target,
            mtime: info.mtimeMs,
          }
        }),
    )
  ).filter((entry): entry is { name: string; target: string; mtime: number } => !!entry)
  dirs.sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name))

  let kept = 0
  for (const dir of dirs) {
    if (keep.has(dir.name)) continue
    kept += 1
    if (kept <= max) continue
    await rm(dir.target, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function pruneSelfEditArtifacts(currentExecutionID: string) {
  const keep = await preservedExecutionIDs()
  keep.add(currentExecutionID)
  await pruneArtifactDirs(shadowDir(), keep, MAX_SHADOW_DIRS)
  await pruneArtifactDirs(executionsDir(), keep, MAX_EXECUTION_DIRS)
}

function previewChanges(baseDir: string, hunks: Patch.Hunk[]): ChangeSummary[] {
  const changes: ChangeSummary[] = []
  for (const hunk of hunks) {
    if (hunk.type === "add") {
      const absolutePath = path.resolve(baseDir, hunk.path)
      if (existsSync(absolutePath)) throw new Error(`Patch add target already exists: ${hunk.path}`)
      changes.push({ type: "add", path: normalizeRelative(hunk.path) })
      continue
    }
    if (hunk.type === "delete") {
      const absolutePath = path.resolve(baseDir, hunk.path)
      if (!existsSync(absolutePath)) throw new Error(`Patch delete target does not exist: ${hunk.path}`)
      changes.push({ type: "delete", path: normalizeRelative(hunk.path) })
      continue
    }
    const absolutePath = path.resolve(baseDir, hunk.path)
    const update = Patch.deriveNewContentsFromChunks(absolutePath, hunk.chunks)
    if (hunk.move_path) {
      const moveTarget = path.resolve(baseDir, hunk.move_path)
      if (moveTarget !== absolutePath && existsSync(moveTarget)) {
        throw new Error(`Patch move target already exists: ${hunk.move_path}`)
      }
    }
    changes.push({
      type: "update",
      path: normalizeRelative(hunk.path),
      movePath: hunk.move_path ? normalizeRelative(hunk.move_path) : undefined,
      unifiedDiff: update.unified_diff,
    })
  }
  return changes
}

function planOperations(baseDir: string, hunks: Patch.Hunk[]): PlannedOperation[] {
  const operations: PlannedOperation[] = []
  for (const hunk of hunks) {
    if (hunk.type === "add") {
      const target = path.resolve(baseDir, hunk.path)
      if (existsSync(target)) throw new Error(`Patch add target already exists: ${hunk.path}`)
      operations.push({
        type: "add",
        target,
        relativePath: normalizeRelative(hunk.path),
        content: hunk.contents,
      })
      continue
    }
    if (hunk.type === "delete") {
      const target = path.resolve(baseDir, hunk.path)
      if (!existsSync(target)) throw new Error(`Patch delete target does not exist: ${hunk.path}`)
      operations.push({
        type: "delete",
        target,
        relativePath: normalizeRelative(hunk.path),
      })
      continue
    }
    const target = path.resolve(baseDir, hunk.path)
    const update = Patch.deriveNewContentsFromChunks(target, hunk.chunks)
    if (hunk.move_path) {
      const moveTarget = path.resolve(baseDir, hunk.move_path)
      if (moveTarget !== target && existsSync(moveTarget)) {
        throw new Error(`Patch move target already exists: ${hunk.move_path}`)
      }
      operations.push({
        type: "move",
        source: target,
        target: moveTarget,
        relativePath: normalizeRelative(hunk.path),
        movePath: normalizeRelative(hunk.move_path),
        newContent: update.content,
      })
      continue
    }
    operations.push({
      type: "update",
      target,
      relativePath: normalizeRelative(hunk.path),
      newContent: update.content,
    })
  }
  return operations
}

async function snapshotPaths(paths: string[]): Promise<BackupEntry[]> {
  const unique = [...new Set(paths)]
  const backups: BackupEntry[] = []
  for (const item of unique) {
    const existed = existsSync(item)
    backups.push({
      path: item,
      existed,
      content: existed ? await Filesystem.readText(item).catch(() => "") : undefined,
    })
  }
  return backups
}

async function restoreBackups(backups: BackupEntry[]) {
  for (const backup of backups) {
    if (!backup.existed) {
      await rm(backup.path, { force: true, recursive: true }).catch(() => undefined)
      continue
    }
    await Filesystem.write(backup.path, backup.content ?? "")
  }
}

async function applyOperations(operations: PlannedOperation[]) {
  for (const operation of operations) {
    if (operation.type === "add") {
      await Filesystem.write(operation.target, operation.content)
      continue
    }
    if (operation.type === "delete") {
      await unlink(operation.target)
      continue
    }
    if (operation.type === "update") {
      await Filesystem.write(operation.target, operation.newContent)
      continue
    }
    await Filesystem.write(operation.target, operation.newContent)
    await unlink(operation.source)
  }
}

async function applyWithRollback(baseDir: string, hunks: Patch.Hunk[]) {
  const operations = planOperations(baseDir, hunks)
  const pathsToBackup = operations.flatMap((operation) => {
    if (operation.type === "move") return [operation.source, operation.target]
    return [operation.target]
  })
  const backups = await snapshotPaths(pathsToBackup)
  try {
    await applyOperations(operations)
  } catch (error) {
    await restoreBackups(backups)
    throw error
  }
  return backups
}

async function runVerifyCommands(
  commands: string[],
  cwd: string,
  phase: VerifyResult["phase"],
  verifyCommandTimeoutMS?: number,
): Promise<VerifyResult[]> {
  const results: VerifyResult[] = []
  for (const command of commands) {
    const startedAt = Date.now()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    if (verifyCommandTimeoutMS && verifyCommandTimeoutMS > 0) {
      timer = setTimeout(() => controller.abort(), verifyCommandTimeoutMS)
    }
    let result: Awaited<ReturnType<typeof Process.run>>
    try {
      result = await Process.run(shellCommand(command), {
        cwd,
        nothrow: true,
        abort: controller.signal,
      })
    } catch (error) {
      const durationMS = Date.now() - startedAt
      if (timer) clearTimeout(timer)
      if (controller.signal.aborted) {
        throw new Error(`Verification timed out after ${verifyCommandTimeoutMS}ms: ${command}`)
      }
      throw error
    }
    if (timer) clearTimeout(timer)
    const durationMS = Date.now() - startedAt
    if (controller.signal.aborted) {
      throw new Error(`Verification timed out after ${verifyCommandTimeoutMS}ms: ${command}`)
    }
    results.push({
      command,
      code: result.code,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      durationMS,
      phase,
    })
    if (result.code !== 0) {
      throw new Error(
        `Verification failed: ${command}\nstdout:\n${result.stdout.toString()}\nstderr:\n${result.stderr.toString()}`,
      )
    }
  }
  return results
}

function summarizeMarkdown(input: {
  proposalID?: string
  executionID: string
  applyLive: boolean
  patchPath: string
  verifyPlanPath: string
  verifyPlanSource: string
  verifyPlanRisk: string
  shadowPath: string
  liveRoot: string
  verifyCommands: string[]
  changes: ChangeSummary[]
  verifyResults: VerifyResult[]
  postApplyVerifyResults: VerifyResult[]
}) {
  return [
    "# Harness Self-Edit Execution",
    "",
    `- executionId: ${input.executionID}`,
    `- proposalId: ${input.proposalID ?? "none"}`,
    `- applyLive: ${input.applyLive}`,
    `- patchPath: ${input.patchPath}`,
    `- verifyPlanPath: ${input.verifyPlanPath}`,
    `- verifyPlanSource: ${input.verifyPlanSource}`,
    `- verifyPlanRisk: ${input.verifyPlanRisk}`,
    `- shadowPath: ${input.shadowPath}`,
    `- liveRoot: ${input.liveRoot}`,
    "",
    "## Changed Files",
    "",
    ...(input.changes.length > 0
      ? input.changes.map((change) =>
          change.type === "update"
            ? `- update ${change.path}${change.movePath ? ` -> ${change.movePath}` : ""}`
            : `- ${change.type} ${change.path}`,
        )
      : ["- none"]),
    "",
    "## Verification Commands",
    "",
    ...(input.verifyCommands.length > 0 ? input.verifyCommands.map((command) => `- ${command}`) : ["- none"]),
    "",
    "## Verification Results",
    "",
    ...(input.verifyResults.length > 0
      ? input.verifyResults.map((result) => `- [${result.code}] (${result.phase}) ${result.command}`)
      : ["- no verification commands were run"]),
    "",
    "## Post-Apply Verification Results",
    "",
    ...(input.postApplyVerifyResults.length > 0
      ? input.postApplyVerifyResults.map((result) => `- [${result.code}] (${result.phase}) ${result.command}`)
      : ["- no verification commands were run"]),
    "",
  ].join("\n")
}

/* eslint-disable-next-line @typescript-eslint/no-namespace */
export namespace HarnessSelfEdit {
  export async function execute(input: ExecuteInput) {
    const parsed = Patch.parsePatch(input.patchText)
    const relativePaths = parsed.hunks.flatMap((hunk) => {
      if (hunk.type === "update" && hunk.move_path) return [normalizeRelative(hunk.path), normalizeRelative(hunk.move_path)]
      return [normalizeRelative(hunk.path)]
    })
    if (relativePaths.some((item) => item.startsWith("../") || path.isAbsolute(item))) {
      throw new Error("Patch contains paths outside the harness source root.")
    }
    if (relativePaths.some((item) => !isAllowedTarget(item))) {
      throw new Error("Patch contains unsupported targets. Self-edit currently supports the wrapper, root config files, and packages/opencode only.")
    }

    const snapshot = input.proposalID ? await HarnessState.getSnapshot() : undefined
    const proposal = input.proposalID
      ? snapshot?.proposals.find((item) => item.id === input.proposalID && item.kind === "code_patch")
      : undefined
    const patchScope = proposal ? validatePatchAgainstProposal(proposal, input.patchText) : undefined

    const executionID = Identifier.ascending("part")
    const artifactDir = path.join(executionsDir(), executionID)
    const shadow = shadowRoot(executionID)
    const packageCwd = path.join(shadow, PACKAGE_ROOT)
    const patchPath = path.join(artifactDir, "patch.txt")
    const verifyPlanPath = executionVerifyPlanPath(artifactDir)
    const verifyPlan =
      input.verifyPlan ??
      buildVerifyPlan({
        proposalID: input.proposalID,
        patchText: input.patchText,
        patchPath,
        explicitCommands: input.verifyCommands ?? [],
        risk: proposal?.risk ?? patchScope?.risk,
      })
    const verifyCommands = verifyPlan.commands
    const requirements = liveApplyRequirements(verifyPlan)
    if ((input.applyLive ?? true) && verifyCommands.length < requirements.minCommands) {
      const allowUnverifiedSmall = requirements.minCommands === 1 && verifyCommands.length === 0 && !requirements.requirePostApply
      if (!(allowUnverifiedSmall && input.allowUnverifiedLive)) {
        throw new Error(
          `Live self-edit for ${verifyPlan.risk} risk requires at least ${requirements.minCommands} verification command(s) before apply.`,
        )
      }
    }

    try {
      await mkdir(artifactDir, { recursive: true })
      await Filesystem.write(patchPath, input.patchText)
      await Filesystem.writeJson(verifyPlanPath, verifyPlan)
      await prepareShadowWorkspace(shadow)
      const shadowChanges = previewChanges(shadow, parsed.hunks)
      await applyWithRollback(shadow, parsed.hunks)
      const verifyResults = await runVerifyCommands(verifyCommands, packageCwd, "shadow", input.verifyCommandTimeoutMS).catch(async (error) => {
        await Filesystem.write(path.join(artifactDir, "failure.txt"), String(error instanceof Error ? error.stack || error.message : error))
        throw error
      })

      let postApplyVerifyResults: VerifyResult[] = []
      if (input.applyLive ?? true) {
        using _ = await Lock.write(liveLockPath())
        const livePackageCwd = path.join(sourceRoot(), PACKAGE_ROOT)
        const liveBackups = await snapshotPaths(
          parsed.hunks.flatMap((hunk) => {
            if (hunk.type === "update" && hunk.move_path) {
              return [path.resolve(sourceRoot(), hunk.path), path.resolve(sourceRoot(), hunk.move_path)]
            }
            return [path.resolve(sourceRoot(), hunk.path)]
          }),
        )
        await Filesystem.writeJson(path.join(artifactDir, "backup.json"), liveBackups)
        try {
          await applyWithRollback(sourceRoot(), parsed.hunks)
          if (requirements.requirePostApply) {
            postApplyVerifyResults = await runVerifyCommands(verifyCommands, livePackageCwd, "live", input.verifyCommandTimeoutMS)
          }
        } catch (error) {
          await restoreBackups(liveBackups)
          await Filesystem.write(
            path.join(artifactDir, "failure.txt"),
            String(error instanceof Error ? error.stack || error.message : error),
          )
          throw error
        }
      }

      const reportPath = path.join(artifactDir, "report.json")
      const summaryPath = path.join(artifactDir, "summary.md")
      await Filesystem.writeJson(reportPath, {
        executionID,
        proposalID: input.proposalID,
        applyLive: input.applyLive ?? true,
        patchPath,
        shadowPath: shadow,
        liveRoot: sourceRoot(),
        verifyPlanPath,
        verifyPlan,
        verifyCommands,
        verifyCommandTimeoutMS: input.verifyCommandTimeoutMS,
        changes: shadowChanges,
        verifyResults,
        postApplyVerifyResults,
      })
      await Filesystem.write(
        summaryPath,
        summarizeMarkdown({
          proposalID: input.proposalID,
          executionID,
          applyLive: input.applyLive ?? true,
          patchPath,
          verifyPlanPath,
          verifyPlanSource: verifyPlan.source,
          verifyPlanRisk: verifyPlan.risk,
          shadowPath: shadow,
          liveRoot: sourceRoot(),
          verifyCommands,
          changes: shadowChanges,
          verifyResults,
          postApplyVerifyResults,
        }),
      )

      if (input.proposalID) {
        await HarnessState.updateProposal(input.proposalID, (current) => ({
          ...current,
          status: input.applyLive ?? true ? "applied" : current.status,
          autoStatus: input.applyLive ?? true ? "applied" : "validated",
          lastAutoExecutionAt: Date.now(),
          lastAutoExecutionError: undefined,
          lastValidatedAt: Date.now(),
          validatedFingerprint: current.fingerprint ?? current.validatedFingerprint,
        }))
      }

      if (input.applyLive ?? true) {
        await markPendingWorkerActivation({
          executionID,
          proposalID: input.proposalID,
          updatedAt: Date.now(),
          reportPath,
          summaryPath,
          title: proposal?.title,
          detail: plainEnglishUpgradeDetail(proposal?.title, 48),
        }).catch(() => undefined)
      }

      await HarnessState.appendObservation({
        source: "analyzer",
        kind: input.applyLive ?? true ? "self_edit.applied" : "self_edit.validated",
        message: `Executed self-edit patch for ${relativePaths.length} path(s).`,
        data: {
          executionID,
          proposalID: input.proposalID,
          applyLive: input.applyLive ?? true,
          verifyCommandCount: verifyCommands.length,
          postApplyVerifyCommandCount: postApplyVerifyResults.length,
          allowUnverifiedLive: input.allowUnverifiedLive ?? false,
        },
      })

      return {
        executionID,
        artifactDir,
        patchPath,
        verifyPlanPath,
        reportPath,
        summaryPath,
        shadowPath: shadow,
        verifyCommands,
        verifyResults,
        changes: shadowChanges,
        appliedLive: input.applyLive ?? true,
      }
    } finally {
      await pruneSelfEditArtifacts(executionID)
    }
  }
}
