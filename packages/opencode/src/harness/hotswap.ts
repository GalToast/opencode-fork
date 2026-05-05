import path from "path"
import { existsSync } from "fs"
import { rm } from "fs/promises"
import { Filesystem } from "@/util/filesystem"
import { canonicalHarnessSourceRoot } from "./paths"
import { launchUpgradeMessage } from "./ux"

type WorkerManifest = {
  executionID: string
  proposalID?: string
  updatedAt: number
  reportPath?: string
  summaryPath?: string
  title?: string
  detail?: string
}

type LaunchNotice = {
  executionID: string
  proposalID?: string
  updatedAt: number
  reportPath?: string
  summaryPath?: string
  title: string
  message: string
}

function sourceRoot() {
  return canonicalHarnessSourceRoot(process.env.OPENCODE_HARNESS_SOURCE_ROOT, process.cwd())
}

function harnessRoot() {
  return process.env.OPENCODE_HARNESS_ROOT || process.env.OPENCODE_CALLER_CWD || process.cwd()
}

function workerDir() {
  return path.join(harnessRoot(), ".opencode", "runtime", "harness", "worker")
}

export function activeWorkerManifestPath() {
  return path.join(workerDir(), "active.json")
}

export function pendingWorkerManifestPath() {
  return path.join(workerDir(), "pending.json")
}

export function launchNoticeEnv() {
  return "OPENCODE_HARNESS_UPGRADE_NOTICE"
}

function buildLaunchNotice(input: WorkerManifest): LaunchNotice {
  const detail = input.detail?.trim() || input.title?.trim()
  return {
    executionID: input.executionID,
    proposalID: input.proposalID,
    updatedAt: input.updatedAt,
    reportPath: input.reportPath,
    summaryPath: input.summaryPath,
    title: "Harness Upgrade Active",
    message: launchUpgradeMessage(detail),
  }
}

export function readLaunchNotice() {
  const raw = process.env[launchNoticeEnv()]
  if (!raw) return
  delete process.env[launchNoticeEnv()]
  try {
    return JSON.parse(raw) as LaunchNotice
  } catch {
    return
  }
}

export async function markPendingWorkerActivation(input: WorkerManifest) {
  const target = pendingWorkerManifestPath()
  await Filesystem.writeJson(target, input)
  return target
}

export async function promotePendingWorkerActivation() {
  const pending = pendingWorkerManifestPath()
  if (!existsSync(pending)) return undefined
  const manifest = await Filesystem.readJson<WorkerManifest>(pending).catch(() => undefined)
  if (!manifest) {
    await rm(pending, { force: true }).catch(() => undefined)
    return undefined
  }
  await Filesystem.writeJson(activeWorkerManifestPath(), manifest)
  await rm(pending, { force: true }).catch(() => undefined)
  process.env.OPENCODE_HARNESS_WORKER_GENERATION = manifest.executionID
  process.env[launchNoticeEnv()] = JSON.stringify(buildLaunchNotice(manifest))
  return manifest
}
