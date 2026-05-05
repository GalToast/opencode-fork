// @ts-nocheck
import path from "path"
import { mkdir, readdir, rm, stat } from "fs/promises"
import { existsSync } from "fs"
import { tmpdir } from "os"
import z from "zod"
import { Identifier } from "@/id/id"
import { Provider } from "@/provider/provider"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { HarnessAnalyze } from "./analyze"
import { HarnessConfidence } from "./confidence"
import { HarnessGenerate } from "./generate"
import { HarnessState } from "./state"
import { HarnessSessionRules, runReadOnlyHarnessSession } from "./session"
import { canonicalHarnessSourceRoot } from "./paths"
import {
  runPromptTuningBenchmark,
  summarizePromptTuningRecommendations,
  type PromptTuningBenchmarkResult,
} from "./prompt-tuning-benchmark"
import type { SemanticBenchmarkModel } from "./semantic-benchmark"

type PromptRun = {
  results: PromptTuningBenchmarkResult[]
  recommendations: ReturnType<typeof summarizePromptTuningRecommendations>
}

export type ProofStatus = "improved" | "non_regressed" | "regressed" | "unproven"

export type PromptProof = {
  status: ProofStatus
  improvedModels: string[]
  regressedModels: string[]
  stableModels: string[]
}

export type RecursiveAttempt = {
  proposalID: string
  title: string
  status: "validated" | "applied" | "failed"
  retained?: boolean
  rollbackReason?: string
  error?: string
  reportPath?: string
  summaryPath?: string
  benchmarkBefore?: PromptRun
  benchmarkAfter?: PromptRun
  benchmarkDelta?: ReturnType<typeof summarizePromptDelta>
  benchmarkProof?: PromptProof
}

export type RecursiveResult = {
  cycleID: string
  startedAt: number
  completedAt: number
  applyLive: boolean
  auditedProposalCount: number
  promotedProposalCount: number
  selectedProposalIDs: string[]
  analysisProposalCount: number
  attempts: RecursiveAttempt[]
  reportPath: string
}

export type StartupRun = {
  startedAt: number
  completedAt: number
  applyLive: boolean
  workerModel?: string
  benchmarkModel?: string
  analysisProposalCount: number
  auditedProposalCount: number
  promotedProposalCount: number
  attemptedProposalIDs: string[]
  completedAttemptCount: number
  failedAttemptCount: number
  retainedAttemptCount: number
  rolledBackAttemptCount: number
  proofStatus: ProofStatus
  cycle?: RecursiveResult
  cycles: RecursiveResult[]
  reportPath: string
}

type RecursiveInput = {
  limit?: number
  proposalIDs?: string[]
  applyLive?: boolean
  audit?: boolean
  diagnose?: boolean
  workerMode?: "pipeline" | "run"
  benchmarkModel?: SemanticBenchmarkModel
  generateModel?: string
  generateVariant?: string
  generateAgent?: string
  reviewModel?: string
  reviewAgent?: string
  verifyCommandTimeoutMS?: number
}

type StartupState = {
  version: 1
  runtimeID?: string
  status: "running" | "completed" | "failed"
  startedAt: number
  completedAt?: number
  reportPath?: string
  error?: string
}

type StartupResult =
  | {
      status: "started"
      reason?: undefined
      result: StartupRun
    }
  | {
      status: "skipped"
      reason: "disabled" | "command_filtered" | "runtime_filtered" | "already_started"
      result?: undefined
    }

function conf(input: HarnessState.Proposal["confidence"]) {
  if (input === "high") return 0
  if (input === "medium") return 1
  return 2
}

function risk(input?: HarnessState.Proposal["risk"]) {
  if (input === "small" || !input) return 0
  if (input === "medium") return 1
  if (input === "large") return 2
  return 3
}

function auto(input?: HarnessState.Proposal["autonomy"]) {
  if (input === "autonomous_patch") return 0
  if (input === "stage_only") return 1
  if (input === "manual" || !input) return 2
  return 3
}

function runtimeDir() {
  const root = process.env.OPENCODE_HARNESS_ROOT || process.cwd()
  return path.join(root, ".opencode", "runtime", "harness", "recursive")
}

function startupPath() {
  return path.join(runtimeDir(), "startup.json")
}

function startupReportPath(runtimeID: string) {
  return path.join(runtimeDir(), `startup-${runtimeID}.json`)
}

function runtimeRole() {
  return (process.env.OPENCODE_RUNTIME_ROLE || "").trim().toLowerCase()
}

function startupCommand(input = process.argv.slice(2)) {
  return input.find((item) => item && !item.startsWith("-")) || ""
}

function startupEnabled() {
  const value = process.env.OPENCODE_HARNESS_STARTUP_AUTO
  if (!value) return true
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase())
}

export function shouldAutoStartRecursive(
  input: {
    cliArgs?: string[]
    role?: string
  } = {},
) {
  if (!startupEnabled()) return false
  const role = (input.role ?? runtimeRole()).trim().toLowerCase()
  if (role && role !== "supervisor_stable" && role !== "tui_supervisor" && role !== "cli_run") return false
  const command = startupCommand(input.cliArgs)
  return command === "" || command === "run"
}

async function readStartupState() {
  return Filesystem.readJson<StartupState>(startupPath()).catch(() => undefined)
}

async function writeStartupState(input: StartupState) {
  await Filesystem.writeJson(startupPath(), input)
}

async function startupModel() {
  const safe = await Provider.getSemanticExactOutputSafeFreeOpencodeModel().catch(() => undefined)
  if (safe) return `opencode/${safe.id}`
  const models = await Provider.listFreeOpencodeModels().catch(() => [])
  const first = models[0]
  if (first) return `opencode/${first.id}`
}

function benchmarkModelFor(model?: string): SemanticBenchmarkModel | undefined {
  if (!model) return
  const parsed = Provider.parseModel(model)
  if (!parsed.providerID || !parsed.modelID) return
  return {
    providerID: parsed.providerID,
    modelID: parsed.modelID,
  }
}

let startupRun: Promise<StartupResult> | undefined

export function recursiveCycleID() {
  return Identifier.ascending("part")
}

export function diagnosisProposalID(slug: string) {
  const normalized = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return Identifier.ascending("part", `prt_diag_${normalized || "proposal"}`)
}

type RestoreEntry = {
  path: string
  existed: boolean
  content?: string
}

const PROMOTION_STRICT_DELTA = 0.05
const PROMOTION_LOOSE_DELTA = 0.05
const PROMOTION_LATENCY_DELTA_MS = -150
const MAX_EMPTY_CYCLES = 3
const DIAGNOSIS_TIMEOUT_MS = 240_000
const WORKER_TIMEOUT_MS = 1_200_000
const PACKAGE_ROOT = "packages/opencode"
const ROOT_FILES = ["package.json", "bunfig.toml", "bun.lock", "tsconfig.json", "opencode-steer.ps1"]
const WORKER_ALLOWED = [
  `${PACKAGE_ROOT}/src`,
  `${PACKAGE_ROOT}/test`,
  `${PACKAGE_ROOT}/script`,
  `${PACKAGE_ROOT}/migration`,
  `${PACKAGE_ROOT}/package.json`,
  `${PACKAGE_ROOT}/tsconfig.json`,
  `${PACKAGE_ROOT}/drizzle.config.ts`,
  ...ROOT_FILES,
]

const DiagnosisProposalSchema = z.object({
  slug: z.string(),
  title: z.string(),
  rationale: z.string(),
  confidence: HarnessState.ProposalConfidence.default("medium"),
  kind: HarnessState.ProposalKind.default("code_patch"),
  risk: HarnessState.ProposalRisk.optional(),
  autonomy: HarnessState.ProposalAutonomy.optional(),
  patchSummary: z.string().optional(),
  files: z.array(z.string()).default([]),
})

const DiagnosisSchema = z.object({
  summary: z.string(),
  proposals: z.array(DiagnosisProposalSchema).default([]),
})

const WorkerAttemptSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.enum(["intelligence", "performance", "efficiency", "stability", "quality"]).default("quality"),
  summary: z.string(),
  outcome: z.enum(["retained", "reverted", "failed", "skipped"]).default("skipped"),
  tests: z.array(z.string()).default([]),
  benchmarks: z.array(z.string()).default([]),
})

const WorkerReportSchema = z.object({
  summary: z.string(),
  keep: z.boolean().default(false),
  attempts: z.array(WorkerAttemptSchema).default([]),
  changedFiles: z.array(z.string()).default([]),
})

const WorkerStreamEventSchema = z.object({
  type: z.string(),
  part: z
    .object({
      text: z.string().optional(),
    })
    .passthrough()
    .optional(),
})

function workerProof(report: z.infer<typeof WorkerReportSchema>) {
  if (!report.keep) return { ok: true as const }
  const kept = report.attempts.filter((item) => item.outcome === "retained")
  if (kept.length === 0) {
    return {
      ok: false as const,
      reason: "Worker reported keep=true without any retained attempt.",
    }
  }
  const missing = kept.find((item) => item.tests.length === 0 && item.benchmarks.length === 0)
  if (!missing) return { ok: true as const }
  return {
    ok: false as const,
    reason: `Worker reported keep=true for ${missing.id} without any tests or benchmarks.`,
  }
}

function workerSummary(text: string) {
  return text
    .replace(/\*\*/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .slice(0, 400)
}

function workerStream(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      try {
        return [WorkerStreamEventSchema.parse(JSON.parse(item))]
      } catch {
        return []
      }
    })
}

function fallbackWorkerReport(input: {
  cycleID: string
  code: number
  stdout: string
  stderr: string
  reason: string
}) {
  const texts = workerStream(input.stdout)
    .filter((item) => item.type === "text")
    .map((item) => item.part?.text?.trim())
    .filter((item): item is string => !!item)
  const text = texts[texts.length - 1]
  const stderr = input.stderr.trim()
  const summary =
    workerSummary(text || "") ||
    workerSummary(stderr) ||
    `Worker ended without a structured report: ${input.reason}`
  return {
    summary,
    keep: false,
    attempts: [
      {
        id: `${input.cycleID}_worker`,
        title: "Autonomous worker run",
        category: "quality" as const,
        summary,
        outcome: input.code === 0 ? ("skipped" as const) : ("failed" as const),
        tests: [],
        benchmarks: [],
      },
    ],
    changedFiles: [],
  } satisfies WorkerReport
}

async function loadWorkerReport(input: {
  cycleID: string
  reportFile: string
  stdoutFile: string
  stderrFile: string
  code: number
}) {
  const stdout = await Filesystem.readText(input.stdoutFile).catch(() => "")
  const stderr = await Filesystem.readText(input.stderrFile).catch(() => "")
  const loaded = await Filesystem.readJson(input.reportFile).catch((error) => {
    return fallbackWorkerReport({
      cycleID: input.cycleID,
      code: input.code,
      stdout,
      stderr,
      reason: error instanceof Error ? error.message : "report missing",
    })
  })
  const report = WorkerReportSchema.safeParse(loaded)
  if (report.success) return report.data
  return fallbackWorkerReport({
    cycleID: input.cycleID,
    code: input.code,
    stdout,
    stderr,
    reason: report.error.issues.map((item) => item.message).join("; ") || "invalid report",
  })
}

function diagnosisObservation(item: HarnessState.Observation) {
  if (item.kind.startsWith("proposal.")) return true
  if (item.kind.startsWith("patch.")) return true
  if (item.kind.startsWith("review.")) return true
  if (item.kind.startsWith("recursive.")) return true
  if (item.kind.startsWith("scheduler.")) return true
  if (item.kind.startsWith("terminal.")) return true
  if (item.kind.startsWith("session.")) return true
  return item.source !== "analyzer"
}

function diagnosisPrompt(input: { observations: HarnessState.Observation[]; proposals: HarnessState.Proposal[] }) {
  const open = input.proposals
    .filter((item) => item.status !== "applied" && item.status !== "dismissed")
    .slice(0, 8)
    .map((item) => `- ${item.id}: ${item.title} [${item.kind}/${item.confidence}/${item.risk ?? "small"}]`)
  const notes = input.observations
    .filter(diagnosisObservation)
    .slice(-12)
    .map((item) => `- [${item.kind}] ${item.message}`)
  return [
    "You are the single recursive harness improvement worker.",
    "",
    "Inspect the current harness state and suggest a small set of bounded self-improvement proposals.",
    "",
    "Rules:",
    "- Return JSON only.",
    "- Prefer narrow code_patch proposals that are likely to improve intelligence, efficiency, performance, or stability.",
    "- Keep file scope tight and testable.",
    "- Use config_overlay only when code changes are unnecessary.",
    "- If signal is too weak, return an empty proposals array.",
    "",
    "Current open proposals:",
    ...(open.length > 0 ? open : ["- none"]),
    "",
    "Recent observations:",
    ...(notes.length > 0 ? notes : ["- none"]),
    "",
    "Return JSON with this exact shape:",
    "{",
    '  "summary": "short diagnosis summary",',
    '  "proposals": [',
    "    {",
    '      "slug": "short_stable_slug",',
    '      "title": "proposal title",',
    '      "rationale": "why this should help",',
    '      "confidence": "low" | "medium" | "high",',
    '      "kind": "code_patch" | "config_overlay",',
    '      "risk": "small" | "medium" | "large" | "core",',
    '      "autonomy": "manual" | "stage_only" | "autonomous_overlay" | "autonomous_patch",',
    '      "patchSummary": "narrow patch intent",',
    '      "files": ["packages/opencode/src/example.ts"]',
    "    }",
    "  ]",
    "}",
  ].join("\n")
}

function extractDiagnosis(raw: string) {
  const trimmed = raw.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim()
  if (fenced?.startsWith("{") && fenced.endsWith("}")) return fenced
  const first = raw.indexOf("{")
  const last = raw.lastIndexOf("}")
  if (first !== -1 && last > first) return raw.slice(first, last + 1).trim()
  return trimmed
}

function diagnosisFiles(files: string[]) {
  return [...new Set(files.map((item) => item.replaceAll("\\", "/").replace(/^\.\//, "").trim()).filter(Boolean))]
}

function workerConfig() {
  const base = (() => {
    const raw = process.env.OPENCODE_CONFIG_CONTENT
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === "object" ? parsed : {}
    } catch {
      return {}
    }
  })()
  const agent = "agent" in base && base.agent && typeof base.agent === "object" ? base.agent : {}
  const build = "build" in agent && agent.build && typeof agent.build === "object" ? agent.build : {}
  const nextBuild = Object.fromEntries(Object.entries(build).filter(([key]) => key !== "steps"))
  return JSON.stringify({
    ...base,
    $schema: "https://opencode.ai/config.json",
    lsp: false,
    agent: {
      ...agent,
      build: {
        ...nextBuild,
        permission: {
          ...("permission" in build && build.permission && typeof build.permission === "object" ? build.permission : {}),
          task: "deny",
        },
      },
    },
  })
}

function sourceRoot() {
  return canonicalHarnessSourceRoot(process.env.OPENCODE_HARNESS_SOURCE_ROOT, process.cwd())
}

function workerDir(cycleID: string) {
  return path.join(runtimeDir(), "worker", cycleID)
}

function workerReport(cycleID: string) {
  return path.join(workerDir(cycleID), "worker-report.json")
}

function workerStdout(cycleID: string) {
  return path.join(workerDir(cycleID), "stdout.jsonl")
}

function workerStderr(cycleID: string) {
  return path.join(workerDir(cycleID), "stderr.txt")
}

function workerRel(file: string) {
  return file.replaceAll("\\", "/").replace(/^\.\//, "").trim()
}

function workerAllowed(file: string) {
  const rel = workerRel(file)
  return WORKER_ALLOWED.some((prefix) => rel === prefix || rel.startsWith(prefix + "/"))
}

function workerFilter(sourcePath: string) {
  const rel = workerRel(path.relative(sourceRoot(), sourcePath))
  if (!rel || rel === ".") return true
  if (!workerAllowed(rel) && !WORKER_ALLOWED.some((prefix) => prefix.startsWith(rel + "/"))) return false
  const parts = rel.split("/")
  return !parts.some((part) => ["node_modules", "dist", ".opencode", "reports", "coverage", "tmp", "nul"].includes(part))
}

async function listWorkerFiles(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!workerFilter(target)) continue
      files.push(...(await listWorkerFiles(root, target)))
      continue
    }
    if (!entry.isFile()) continue
    const rel = workerRel(path.relative(root, target))
    if (!workerAllowed(rel)) continue
    files.push(rel)
  }
  return files
}

async function snapshotWorkerFiles() {
  const root = sourceRoot()
  const files = new Set<string>()
  for (const rel of ROOT_FILES) {
    const target = path.join(root, rel)
    if (!existsSync(target)) continue
    files.add(workerRel(rel))
  }
  const pkg = path.join(root, PACKAGE_ROOT)
  if (existsSync(pkg)) {
    for (const rel of await listWorkerFiles(root, pkg)) {
      files.add(rel)
    }
  }
  const backups: RestoreEntry[] = []
  for (const rel of [...files].sort()) {
    const target = path.join(root, rel)
    backups.push({
      path: target,
      existed: true,
      content: await Filesystem.readText(target).catch(() => ""),
    })
  }
  return backups
}

async function writeWorkerBackup(artifactDir: string) {
  const backups = await snapshotWorkerFiles()
  await Filesystem.writeJson(path.join(artifactDir, "backup.json"), backups)
  return backups
}

async function cleanupWorkerNewFiles(backups: RestoreEntry[]) {
  const root = sourceRoot()
  const known = new Set(backups.map((item) => path.normalize(item.path)))
  const current = new Set<string>()
  for (const rel of await listWorkerFiles(root, path.join(root, PACKAGE_ROOT)).catch(() => [])) {
    current.add(path.normalize(path.join(root, rel)))
  }
  for (const rel of ROOT_FILES) {
    const target = path.join(root, rel)
    if (!existsSync(target)) continue
    current.add(path.normalize(target))
  }
  for (const file of current) {
    if (known.has(file)) continue
    await rm(file, { recursive: true, force: true }).catch(() => undefined)
  }
}

function workerPrompt(input: {
  reportPath: string
  limit: number
  benchmarkModel?: SemanticBenchmarkModel
  proposals: HarnessState.Proposal[]
  observations: HarnessState.Observation[]
}) {
  const proposals = input.proposals
    .filter((item) => item.status !== "dismissed" && item.status !== "applied")
    .slice(0, 10)
    .map((item) => {
      const files = item.patchHint?.files?.slice(0, 6).join(", ")
      return `- ${item.id}: ${item.title} [${item.kind}/${item.confidence}/${item.risk ?? "small"}]${files ? ` files=${files}` : ""}`
    })
  const notes = input.observations
    .filter(diagnosisObservation)
    .slice(-16)
    .map((item) => `- [${item.kind}] ${item.message}`)
  const benchmark = input.benchmarkModel
    ? `${input.benchmarkModel.providerID}/${input.benchmarkModel.modelID}`
    : "none specified"
  return [
    "You are a single non-interactive opencode self-improvement worker operating directly on the live experimental source tree.",
    "",
    "Mission:",
    `- Audit the opencode harness and attempt up to ${Math.max(1, input.limit)} bounded improvements.`,
    "- Prefer small, testable edits that improve intelligence, performance, efficiency, or stability.",
    "- You own the full loop: inspect, hypothesize, edit, test, benchmark, and decide whether to retain or revert each attempt.",
    "- If an attempt fails, regresses, or is unproven, revert it before moving on.",
    "- Leave the source tree containing only the final retained changes, if any.",
    "",
    "Constraints:",
    `- Keep edits inside ${PACKAGE_ROOT} or the small allowed root files when necessary.`,
    "- Stay single-agent. Do not use the task tool and do not spawn subagents.",
    "- Prefer read, grep, structural_read, shell, edit, and write before heavier tooling.",
    "- Use focused tests first; broaden only if needed.",
    `- Preferred benchmark model: ${benchmark}.`,
    "- Use existing harness/benchmark commands where they already exist.",
    "- Do not ask questions. Do not enter plan mode. Just do the work.",
    "",
    "Current candidate proposals:",
    ...(proposals.length > 0 ? proposals : ["- none"]),
    "",
    "Recent observations:",
    ...(notes.length > 0 ? notes : ["- none"]),
    "",
    "Before finishing, write a JSON report to this exact absolute path:",
    input.reportPath,
    "",
    "Report schema:",
    "{",
    '  "summary": "short overall summary",',
    '  "keep": true | false,',
    '  "attempts": [',
    "    {",
    '      "id": "stable_id",',
    '      "title": "attempt title",',
    '      "category": "intelligence" | "performance" | "efficiency" | "stability" | "quality",',
    '      "summary": "what happened",',
    '      "outcome": "retained" | "reverted" | "failed" | "skipped",',
    '      "tests": ["bun test ..."],',
    '      "benchmarks": ["bun run ..."]',
    "    }",
    "  ],",
    '  "changedFiles": ["packages/opencode/src/example.ts"]',
    "}",
    "",
    "Important:",
    '- Set "keep": true only if the final retained workspace changes are worth promoting and you actually ran proof commands.',
    '- Every retained attempt must list at least one concrete test or benchmark command in "tests" or "benchmarks".',
    '- "changedFiles" must list only the final retained changed files relative to repo root.',
    '- If nothing should be promoted, set keep=false and changedFiles=[].',
  ].join("\n")
}

type WorkerReport = z.infer<typeof WorkerReportSchema>

async function runWorkerCycle(input: {
  cycleID: string
  limit: number
  applyLive: boolean
  model?: string
  variant?: string
  benchmarkModel?: SemanticBenchmarkModel
  proposals: HarnessState.Proposal[]
  observations: HarnessState.Observation[]
}) {
  const root = workerDir(input.cycleID)
  const reportFile = workerReport(input.cycleID)
  const stdoutFile = workerStdout(input.cycleID)
  const stderrFile = workerStderr(input.cycleID)
  await mkdir(root, { recursive: true })
  const backups = await writeWorkerBackup(root)
  const argv = [
    process.execPath,
    "run",
    "./src/index.ts",
    "run",
    "--dir",
    sourceRoot(),
    "--autonomous",
    "--format",
    "json",
  ]
  if (input.model) {
    argv.push("--model", input.model)
  }
  if (input.variant) {
    argv.push("--variant", input.variant)
  }
  argv.push(workerPrompt({
    reportPath: reportFile,
    limit: input.limit,
    benchmarkModel: input.benchmarkModel,
    proposals: input.proposals,
    observations: input.observations,
  }))
  const result = await Process.run(argv, {
    cwd: path.join(sourceRoot(), PACKAGE_ROOT),
    env: {
      OPENCODE_HARNESS_STARTUP_AUTO: "0",
      OPENCODE_HARNESS_ROOT: sourceRoot(),
      OPENCODE_HARNESS_SOURCE_ROOT: sourceRoot(),
      OPENCODE_RUNTIME_ROLE: "cli_run",
      OPENCODE_AUTO_SHARE: "0",
      OPENCODE_CONFIG_CONTENT: workerConfig(),
    },
    timeout: WORKER_TIMEOUT_MS,
    nothrow: true,
  })
  await Filesystem.write(stdoutFile, result.stdout.toString("utf8"))
  await Filesystem.write(stderrFile, result.stderr.toString("utf8"))
  const report = await loadWorkerReport({
    cycleID: input.cycleID,
    reportFile,
    stdoutFile,
    stderrFile,
    code: result.code,
  })
  const proof = workerProof(report)
  if (!proof.ok) {
    await rollbackExecutionArtifacts(root).catch(() => undefined)
    await cleanupWorkerNewFiles(backups)
    throw new Error(proof.reason)
  }
  const failed = result.code !== 0
  if (failed || !input.applyLive || !report.keep) {
    await rollbackExecutionArtifacts(root)
    await cleanupWorkerNewFiles(backups)
  }
  return {
    root,
    reportFile,
    stdoutFile,
    stderrFile,
    report,
    failed,
    exitCode: result.code,
  }
}

function mergeDiagnosis(current: HarnessState.Proposal[], diagnosis: z.infer<typeof DiagnosisSchema>) {
  const ids = new Map(current.map((item) => [item.id, item]))
  const added: HarnessState.Proposal[] = []
  for (const item of diagnosis.proposals) {
    const id = diagnosisProposalID(item.slug)
    if (ids.has(id)) continue
    const files = diagnosisFiles(item.files)
    added.push({
      id,
      kind: item.kind,
      title: item.title,
      confidence: item.confidence,
      rationale: item.rationale,
      status: "open",
      risk: item.risk ?? "small",
      autonomy: item.autonomy ?? (item.kind === "code_patch" ? "autonomous_patch" : "autonomous_overlay"),
      patchHint:
        item.kind === "code_patch"
          ? {
              summary: item.patchSummary?.trim() || item.title,
              files,
            }
          : undefined,
      expectedFiles: item.kind === "code_patch" && files.length > 0 ? files : undefined,
    })
  }
  return {
    proposals: [...current, ...added],
    added,
  }
}

export function pickRecursiveProposals(
  proposals: HarnessState.Proposal[],
  input?: {
    limit?: number
    proposalIDs?: string[]
  },
) {
  const picked = proposals
    .filter((item) => item.kind === "code_patch" && item.status === "open")
    .filter((item) => item.autoStatus !== "running" && item.autoStatus !== "applied" && item.autoStatus !== "failed")
    .filter((item) => !input?.proposalIDs?.length || input.proposalIDs.includes(item.id))
    .sort((a, b) => {
      const confDelta = conf(a.confidence) - conf(b.confidence)
      if (confDelta !== 0) return confDelta
      const autoDelta = auto(a.autonomy) - auto(b.autonomy)
      if (autoDelta !== 0) return autoDelta
      const riskDelta = risk(a.risk) - risk(a.risk)
      if (riskDelta !== 0) return riskDelta
      const aFiles = a.patchHint?.files?.length ?? 0
      const bFiles = b.patchHint?.files?.length ?? 0
      if (aFiles !== bFiles) return aFiles - bFiles
      return a.title.localeCompare(b.title)
    })
  return picked.slice(0, Math.max(1, input?.limit ?? 1))
}

export function summarizePromptDelta(before: PromptRun, after: PromptRun) {
  const prior = new Map(
    before.results.map((item) => [`${item.benchmarkModel.providerID}/${item.benchmarkModel.modelID}`, item]),
  )
  return after.results.map((item) => {
    const key = `${item.benchmarkModel.providerID}/${item.benchmarkModel.modelID}`
    const prev = prior.get(key)
    return {
      model: key,
      strictDelta: Number(((item.accuracy ?? 0) - (prev?.accuracy ?? 0)).toFixed(4)),
      looseDelta: Number(((item.looseAccuracy ?? 0) - (prev?.looseAccuracy ?? 0)).toFixed(4)),
      latencyDeltaMS: item.averageLatencyMS - (prev?.averageLatencyMS ?? 0),
    }
  })
}

export function assessPromptProof(delta: ReturnType<typeof summarizePromptDelta> | undefined): PromptProof {
  if (!delta || delta.length === 0) {
    return {
      status: "unproven",
      improvedModels: [],
      regressedModels: [],
      stableModels: [],
    }
  }
  const improvedModels = delta
    .filter(
      (item) =>
        item.strictDelta > 0 ||
        item.looseDelta > 0 ||
        (item.latencyDeltaMS < 0 && item.strictDelta >= 0 && item.looseDelta >= 0),
    )
    .map((item) => item.model)
  const regressedModels = delta.filter((item) => item.strictDelta < 0 || item.looseDelta < 0).map((item) => item.model)
  const stableModels = delta
    .filter((item) => !improvedModels.includes(item.model) && !regressedModels.includes(item.model))
    .map((item) => item.model)
  return {
    status: regressedModels.length > 0 ? "regressed" : improvedModels.length > 0 ? "improved" : "non_regressed",
    improvedModels,
    regressedModels,
    stableModels,
  }
}

export function promptPromotionDecision(delta: ReturnType<typeof summarizePromptDelta> | undefined) {
  if (!delta || delta.length === 0) {
    return {
      keep: false,
      reason: "No benchmark delta was captured for the live patch.",
    }
  }
  const regressed = delta.filter((item) => item.strictDelta < 0 || item.looseDelta < 0)
  if (regressed.length > 0) {
    return {
      keep: false,
      reason: `Benchmark regressed for ${regressed.map((item) => item.model).join(", ")}.`,
    }
  }
  const improved = delta.filter(
    (item) =>
      item.strictDelta >= PROMOTION_STRICT_DELTA ||
      item.looseDelta >= PROMOTION_LOOSE_DELTA ||
      (item.latencyDeltaMS <= PROMOTION_LATENCY_DELTA_MS && item.strictDelta >= 0 && item.looseDelta >= 0),
  )
  if (improved.length === 0) {
    return {
      keep: false,
      reason: "Benchmark changes were too small to count as a marked improvement.",
    }
  }
  return {
    keep: true,
    reason: `Marked improvement confirmed for ${improved.map((item) => item.model).join(", ")}.`,
  }
}

async function rollbackExecutionArtifacts(artifactDir: string) {
  const backupPath = path.join(artifactDir, "backup.json")
  const loaded = await Filesystem.readJson<RestoreEntry[]>(backupPath).catch(() => [])
  const backups = Array.isArray(loaded) ? loaded : []
  for (const backup of backups) {
    if (!backup.existed) {
      await rm(backup.path, { recursive: true, force: true }).catch(() => undefined)
      continue
    }
    await Filesystem.write(backup.path, backup.content ?? "")
  }
}

function aggregateProofStatus(cycles: RecursiveResult[]): ProofStatus {
  const attempts = cycles.flatMap((item) => item.attempts)
  const retained = attempts.filter((item) => item.retained)
  if (retained.some((item) => item.benchmarkProof?.status === "improved")) return "improved"
  if (retained.some((item) => item.benchmarkProof?.status === "non_regressed")) return "non_regressed"
  if (attempts.some((item) => item.benchmarkProof?.status === "regressed")) return "regressed"
  if (attempts.length > 0) return "unproven"
  return "non_regressed"
}

async function diagnose(input: {
  observations: HarnessState.Observation[]
  proposals: HarnessState.Proposal[]
  model?: string
  agent?: string
}) {
  const result = await runReadOnlyHarnessSession({
    title: "Harness recursive diagnosis",
    prompt: diagnosisPrompt(input),
    lane: "healer",
    stage: "research",
    model: input.model,
    agent: input.agent,
    permission: HarnessSessionRules.full(),
    timeoutMS: DIAGNOSIS_TIMEOUT_MS,
  })
  const parsed = result.structured
    ? DiagnosisSchema.parse(result.structured)
    : DiagnosisSchema.parse(JSON.parse(extractDiagnosis(result.raw)))
  return {
    diagnosis: parsed,
    model: result.selectedModel ?? result.requestedModel,
  }
}

async function runPrompt(input: SemanticBenchmarkModel) {
  const result = await runPromptTuningBenchmark({ benchmarkModel: input })
  return {
    results: [result],
    recommendations: summarizePromptTuningRecommendations([result]),
  } satisfies PromptRun
}

async function writeReport(input: RecursiveResult) {
  const reportPath = input.reportPath
  await Filesystem.writeJson(reportPath, input)
}

async function writeStartupReport(input: StartupRun) {
  await Filesystem.writeJson(input.reportPath, input)
}

export namespace HarnessRecursive {
  export async function cycle(input: RecursiveInput = {}): Promise<RecursiveResult> {
    const startedAt = Date.now()
    const cycleID = recursiveCycleID()
    const reportPath = path.join(runtimeDir(), `${cycleID}.json`)
    const workerMode = input.workerMode ?? "pipeline"

    const analysis = await HarnessAnalyze.build()
    let proposals = analysis.proposals
    if ((input.diagnose ?? true) && proposals.length === 0) {
      const snapshot = await HarnessState.getSnapshot()
      const seeded = await diagnose({
        observations: analysis.observations,
        proposals: snapshot.proposals,
        model: input.generateModel,
        agent: input.generateAgent,
      }).catch(() => undefined)
      if (seeded) {
        const merged = mergeDiagnosis(snapshot.proposals, seeded.diagnosis)
        proposals = merged.proposals
        await HarnessState.appendObservation({
          source: "analyzer",
          kind: "recursive.diagnosis_completed",
          message: seeded.diagnosis.summary || "Recursive diagnosis seeded proposals.",
          data: {
            cycleID,
            model: seeded.model,
            addedProposalIDs: merged.added.map((item) => item.id),
          },
        })
      }
    }
    await HarnessState.replaceProposals(proposals)
    let snapshot = await HarnessState.getSnapshot()
    let auditedProposalCount = 0
    let promotedProposalCount = 0
    if (workerMode === "pipeline" && (input.audit ?? true)) {
      const audit = await HarnessConfidence.matureProposals({
        proposals: snapshot.proposals,
        observations: analysis.observations,
        model: input.generateModel,
        agent: input.generateAgent,
      })
      auditedProposalCount = audit.researched
      promotedProposalCount = audit.promoted
      snapshot = await HarnessState.getSnapshot()
      await HarnessState.appendObservation({
        source: "analyzer",
        kind: "recursive.audit_completed",
        message: `Audited recursive proposal queue before self-edit selection.`,
        data: {
          cycleID,
          researched: auditedProposalCount,
          promoted: promotedProposalCount,
        },
      })
    }
    const applyLive = input.applyLive ?? false
    const attempts: RecursiveAttempt[] = []
    const selected =
      workerMode === "pipeline"
        ? pickRecursiveProposals(snapshot.proposals, {
            limit: input.limit,
            proposalIDs: input.proposalIDs,
          })
        : []

    await HarnessState.appendObservation({
      source: "analyzer",
      kind: "recursive.cycle_started",
      message: `Started recursive harness cycle for ${selected.length} proposal(s).`,
      data: {
        cycleID,
        applyLive,
        proposalIDs: selected.map((item) => item.id),
        benchmarkModel: input.benchmarkModel
          ? `${input.benchmarkModel.providerID}/${input.benchmarkModel.modelID}`
          : undefined,
        workerMode,
      },
    })

    if (workerMode === "run") {
      const before = input.benchmarkModel && applyLive ? await runPrompt(input.benchmarkModel) : undefined
      const worker = await runWorkerCycle({
        cycleID,
        limit: Math.max(1, input.limit ?? 1),
        applyLive,
        model: input.generateModel,
        variant: input.generateVariant,
        benchmarkModel: input.benchmarkModel,
        proposals: snapshot.proposals,
        observations: analysis.observations,
      })
      const attempt: RecursiveAttempt = {
        proposalID: worker.report.attempts[0]?.id ?? `${cycleID}_worker`,
        title: worker.report.summary,
        status: worker.failed ? "failed" : applyLive && worker.report.keep ? "applied" : "validated",
        retained: !worker.failed && applyLive && worker.report.keep,
        reportPath: worker.reportFile,
        summaryPath: worker.stdoutFile,
      }
      const selectedProposalIDs = worker.report.attempts.map((item) => item.id)
      if (worker.failed) {
        attempt.error = `Worker exited with code ${worker.exitCode}.`
      }
      if (input.benchmarkModel && applyLive && worker.report.keep && worker.report.changedFiles.length > 0) {
        attempt.benchmarkBefore = before
        attempt.benchmarkAfter = await runPrompt(input.benchmarkModel)
        attempt.benchmarkDelta = summarizePromptDelta(before!, attempt.benchmarkAfter)
        attempt.benchmarkProof = assessPromptProof(attempt.benchmarkDelta)
        const decision = promptPromotionDecision(attempt.benchmarkDelta)
        if (!decision.keep) {
          await rollbackExecutionArtifacts(worker.root)
          await cleanupWorkerNewFiles(await Filesystem.readJson(path.join(worker.root, "backup.json")).catch(() => []))
          attempt.status = "failed"
          attempt.retained = false
          attempt.rollbackReason = decision.reason
          attempt.error = `Benchmark gate rejected live apply: ${decision.reason}`
        }
      }
      if (worker.report.keep && worker.report.changedFiles.length === 0) {
        attempt.status = "failed"
        attempt.retained = false
        attempt.error = "Worker reported keep=true but left no retained changed files."
      }
      if (!worker.report.keep) {
        attempt.retained = false
        attempt.status = "validated"
      }
      attempts.push(attempt)
      const completedAt = Date.now()
      const result = {
        cycleID,
        startedAt,
        completedAt,
        applyLive,
        auditedProposalCount,
        promotedProposalCount,
        selectedProposalIDs,
        analysisProposalCount: proposals.length,
        attempts,
        reportPath,
      } satisfies RecursiveResult
      await writeReport(result)
      await HarnessState.appendObservation({
        source: "analyzer",
        kind: "recursive.cycle_completed",
        message: `Completed recursive harness cycle for ${selectedProposalIDs.length} worker attempt(s).`,
        data: {
          cycleID,
          applyLive,
          workerMode,
          selectedProposalIDs,
          attemptCount: attempts.length,
          failureCount: attempts.filter((item) => item.status === "failed").length,
          proofStatuses: attempts.map((item) => item.benchmarkProof?.status).filter(Boolean),
          reportPath,
          workerReportPath: worker.reportFile,
          workerStdoutPath: worker.stdoutFile,
          workerStderrPath: worker.stderrFile,
        },
      })
      return result
    }

    for (const proposal of selected) {
      const attempt: RecursiveAttempt = {
        proposalID: proposal.id,
        title: proposal.title,
        status: applyLive ? "applied" : "validated",
      }

      if (input.benchmarkModel) {
        attempt.benchmarkBefore = await runPrompt(input.benchmarkModel)
      }

      await HarnessState.appendObservation({
        source: "analyzer",
        kind: "recursive.proposal_started",
        message: `Started recursive adaptation attempt for ${proposal.id}.`,
        data: {
          cycleID,
          proposalID: proposal.id,
          applyLive,
          title: proposal.title,
        },
      })

      try {
        const result = await HarnessGenerate.autopatch({
          proposalID: proposal.id,
          applyLive,
          generateModel: input.generateModel,
          generateVariant: input.generateVariant,
          generateAgent: input.generateAgent,
          reviewModel: input.reviewModel ?? input.generateModel,
          reviewAgent: input.reviewAgent ?? input.generateAgent,
          verifyCommandTimeoutMS: input.verifyCommandTimeoutMS,
        })

        attempt.reportPath = result.reportPath
        attempt.summaryPath = result.execution.summaryPath
        attempt.retained = result.execution.appliedLive

        if (input.benchmarkModel && applyLive) {
          attempt.benchmarkAfter = await runPrompt(input.benchmarkModel)
          attempt.benchmarkDelta = summarizePromptDelta(attempt.benchmarkBefore!, attempt.benchmarkAfter)
          attempt.benchmarkProof = assessPromptProof(attempt.benchmarkDelta)
          const decision = promptPromotionDecision(attempt.benchmarkDelta)
          if (!decision.keep) {
            await rollbackExecutionArtifacts(result.execution.artifactDir)
            attempt.status = "failed"
            attempt.retained = false
            attempt.rollbackReason = decision.reason
            attempt.error = `Benchmark gate rejected live apply: ${decision.reason}`
            await HarnessState.updateProposal(proposal.id, (current) => ({
              ...current,
              status: "open",
              autoStatus: "failed",
              lastAutoExecutionAt: Date.now(),
              lastAutoExecutionError: attempt.error,
            }))
            await HarnessState.appendObservation({
              source: "analyzer",
              kind: "recursive.proposal_rolled_back",
              message: `Rolled back recursive adaptation attempt for ${proposal.id}.`,
              data: {
                cycleID,
                proposalID: proposal.id,
                reason: decision.reason,
                artifactDir: result.execution.artifactDir,
              },
            })
          }
        }

        await HarnessState.appendObservation({
          source: "analyzer",
          kind: "recursive.proposal_completed",
          message: `Completed recursive adaptation attempt for ${proposal.id}.`,
          data: {
            cycleID,
            proposalID: proposal.id,
            applyLive,
            reportPath: result.reportPath,
            benchmarkDelta: attempt.benchmarkDelta,
            benchmarkProof: attempt.benchmarkProof,
          },
        })
      } catch (error) {
        attempt.status = "failed"
        attempt.error = error instanceof Error ? error.message : String(error)
        await HarnessState.appendObservation({
          source: "analyzer",
          kind: "recursive.proposal_failed",
          message: `Recursive adaptation attempt failed for ${proposal.id}.`,
          data: {
            cycleID,
            proposalID: proposal.id,
            applyLive,
            error: attempt.error,
          },
        })
      }

      attempts.push(attempt)
    }

    const completedAt = Date.now()
    const result = {
      cycleID,
      startedAt,
      completedAt,
      applyLive,
      auditedProposalCount,
      promotedProposalCount,
      selectedProposalIDs: selected.map((item) => item.id),
      analysisProposalCount: proposals.length,
      attempts,
      reportPath,
    } satisfies RecursiveResult

    await writeReport(result)
    await HarnessState.appendObservation({
      source: "analyzer",
      kind: "recursive.cycle_completed",
      message: `Completed recursive harness cycle for ${selected.length} proposal(s).`,
      data: {
        cycleID,
        applyLive,
        auditedProposalCount,
        promotedProposalCount,
        selectedProposalIDs: result.selectedProposalIDs,
        attemptCount: attempts.length,
        failureCount: attempts.filter((item) => item.status === "failed").length,
        proofStatuses: attempts.map((item) => item.benchmarkProof?.status).filter(Boolean),
        reportPath,
        workerMode,
      },
    })
    return result
  }

  export async function startup(
    input: RecursiveInput & { cliArgs?: string[]; role?: string } = {},
  ): Promise<StartupResult> {
    if (!startupEnabled()) {
      return {
        status: "skipped",
        reason: "disabled",
      }
    }
    if (!shouldAutoStartRecursive({ cliArgs: input.cliArgs, role: input.role })) {
      const role = (input.role ?? runtimeRole()).trim().toLowerCase()
      return {
        status: "skipped",
        reason:
          role && role !== "supervisor_stable" && role !== "tui_supervisor" && role !== "cli_run"
            ? "runtime_filtered"
            : "command_filtered",
      }
    }
    const runtimeID = process.env.OPENCODE_RUNTIME_ID || "unknown"
    const existing = await readStartupState()
    if (existing?.runtimeID === runtimeID && (existing.status === "running" || existing.status === "completed")) {
      return {
        status: "skipped",
        reason: "already_started",
      }
    }

    const startedAt = Date.now()
    const reportPath = startupReportPath(runtimeID)
    await writeStartupState({
      version: 1,
      runtimeID,
      status: "running",
      startedAt,
    })
    await HarnessState.appendObservation({
      source: "runtime",
      kind: "recursive.startup_started",
      message: "Started one bounded recursive startup improvement.",
      data: {
        runtimeID,
        runtimeRole: input.role ?? runtimeRole(),
      },
    })

    try {
      const model = input.generateModel ?? (await startupModel())
      const benchmarkModel = input.benchmarkModel ?? benchmarkModelFor(model)
      let emptyCycleCount = 0
      const cycles: RecursiveResult[] = []
      while (true) {
        const cycle = await HarnessRecursive.cycle({
          ...input,
          limit: 1,
          applyLive: input.applyLive ?? true,
          audit: input.audit ?? true,
          benchmarkModel,
          generateModel: model,
          reviewModel: input.reviewModel ?? model,
        })
        cycles.push(cycle)
        if (cycle.selectedProposalIDs.length === 0) {
          emptyCycleCount++
          await HarnessState.appendObservation({
            source: "runtime",
            kind: "recursive.empty_cycle_detected",
            message: `Recursive cycle completed with 0 proposals (${emptyCycleCount}/${MAX_EMPTY_CYCLES}).`,
            data: {
              runtimeID,
              cycleID: cycle.cycleID,
              emptyCycleCount,
              maxEmptyCycles: MAX_EMPTY_CYCLES,
              analysisProposalCount: cycle.analysisProposalCount,
              auditedProposalCount: cycle.auditedProposalCount,
              promotedProposalCount: cycle.promotedProposalCount,
            },
          })
          if (emptyCycleCount >= MAX_EMPTY_CYCLES) {
            await HarnessState.appendObservation({
              source: "runtime",
              kind: "recursive.empty_cycle_threshold_reached",
              message: `Empty cycle threshold reached (${emptyCycleCount}/${MAX_EMPTY_CYCLES}). No viable proposals found.`,
              data: {
                runtimeID,
                emptyCycleCount,
                totalCycles: cycles.length,
              },
            })
            break
          }
        } else {
          emptyCycleCount = 0
        }
      }
      const attempts = cycles.flatMap((item) => item.attempts)
      const proofStatus = aggregateProofStatus(cycles)
      const result = {
        startedAt,
        completedAt: Date.now(),
        applyLive: input.applyLive ?? true,
        workerModel: model,
        benchmarkModel: benchmarkModel ? `${benchmarkModel.providerID}/${benchmarkModel.modelID}` : undefined,
        analysisProposalCount: cycles.reduce((max, item) => Math.max(max, item.analysisProposalCount), 0),
        auditedProposalCount: cycles.reduce((sum, item) => sum + item.auditedProposalCount, 0),
        promotedProposalCount: cycles.reduce((sum, item) => sum + item.promotedProposalCount, 0),
        attemptedProposalIDs: [...new Set(cycles.flatMap((item) => item.selectedProposalIDs))],
        completedAttemptCount: attempts.filter((item) => item.status !== "failed").length,
        failedAttemptCount: attempts.filter((item) => item.status === "failed").length,
        retainedAttemptCount: attempts.filter((item) => item.retained).length,
        rolledBackAttemptCount: attempts.filter((item) => item.rollbackReason).length,
        proofStatus,
        cycle: cycles.at(-1),
        cycles,
        reportPath,
      } satisfies StartupRun
      await writeStartupReport(result)
      await writeStartupState({
        version: 1,
        runtimeID,
        status: "completed",
        startedAt,
        completedAt: Date.now(),
        reportPath,
      })
      await HarnessState.appendObservation({
        source: "runtime",
        kind: "recursive.startup_completed",
        message: "Completed one bounded recursive startup improvement.",
        data: {
          runtimeID,
          workerModel: result.workerModel,
          benchmarkModel: result.benchmarkModel,
          proofStatus,
          reportPath,
          selectedProposalIDs: result.attemptedProposalIDs,
          completedAttemptCount: result.completedAttemptCount,
          failedAttemptCount: result.failedAttemptCount,
        },
      })
      return {
        status: "started",
        result,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await writeStartupState({
        version: 1,
        runtimeID,
        status: "failed",
        startedAt,
        completedAt: Date.now(),
        error: message,
      })
      await HarnessState.appendObservation({
        source: "runtime",
        kind: "recursive.startup_failed",
        message: "Recursive startup cycle failed.",
        data: {
          runtimeID,
          error: message,
        },
      })
      throw error
    }
  }

  export function scheduleStartup(input: RecursiveInput & { cliArgs?: string[]; role?: string } = {}) {
    if (startupRun) return startupRun
    startupRun = startup(input).finally(() => {
      startupRun = undefined
    })
    return startupRun
  }
}
