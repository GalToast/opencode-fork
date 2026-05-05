import path from "path"
import z from "zod"
import { Patch } from "@/patch"
import { Provider } from "@/provider/provider"
import { Filesystem } from "@/util/filesystem"
import { HarnessPolicy } from "./policy"
import { resolveHarnessSourcePath } from "./paths"
import { HarnessReview } from "./review"
import { HarnessSelfEdit } from "./self-edit"
import { HarnessState } from "./state"
import {
  callerHarnessRoot,
  HarnessSessionRules,
  type HarnessModelRoute,
  pickHarnessSessionModel,
  readHarnessPreferredModel,
  readHarnessPreferredRoute,
  readHarnessModelScorecard,
  recordHarnessModelOutcome,
  runReadOnlyHarnessSession,
  sourceRoot,
  type HarnessSessionProgress,
} from "./session"
import { acquireFileLock } from "./coordination"
import { buildVerifyPlan, proposalVerifyPlanPath, writeVerifyPlan } from "./verify"
import {
  HarnessError,
  TimeoutError,
  ValidationError,
  SessionError,
  NetworkError,
  classifyError,
  isTimeoutError,
  isValidationError,
  isSessionError,
} from "./errors"
import {
  RetryExecutor,
  CircuitBreakerRegistry,
  executeWithCircuitBreaker,
  shouldRotateModel,
  type ModelRotationRecommendation,
} from "./retry"

type GenerateInput = {
  proposalID: string
  model?: string
  variant?: string
  agent?: string
  timeoutMS?: number
  onProgress?: (progress: GenerateProgress) => void | Promise<void>
}

type ReviewInput = {
  proposalID: string
  patchText?: string
  model?: string
  agent?: string
  authorModel?: string
  timeoutMS?: number
}

type AutopatchInput = {
  proposalID: string
  generateModel?: string
  generateVariant?: string
  generateAgent?: string
  reviewModel?: string
  reviewAgent?: string
  verifyCommands?: string[]
  applyLive?: boolean
  allowUnverifiedLive?: boolean
  allowReviewNonApprove?: boolean
  generateTimeoutMS?: number
  reviewTimeoutMS?: number
  verifyCommandTimeoutMS?: number
  reuseValidatedArtifacts?: boolean
}

type AutopatchStageName = "generate" | "review" | "execute"

type AutopatchStageStatus = "pending" | "running" | "completed" | "failed" | "staged"

type AutopatchStageReport = {
  stage: AutopatchStageName
  status: AutopatchStageStatus
  startedAt?: number
  endedAt?: number
  durationMS?: number
  sessionID?: string
  reportPath?: string
  patchPath?: string
  artifactDir?: string
  note?: string
  error?: string
}

type JsonRecord = Record<string, unknown>
type GeneratedPatchValidation = Awaited<ReturnType<typeof validateGeneratedPatch>>
type GeneratedAttemptSummary = {
  attempt: number
  sessionID: string
  rawPath: string
  tracePath?: string
  validationError?: string
}
type GeneratedReportData = {
  status?: "running" | "completed" | "failed"
  sessionID?: string
  model?: string
  variant?: string
  selectedModel?: string
  routing?: HarnessModelRoute
  effectiveModel?: string
  agent?: string
  attempts?: GeneratedAttemptSummary[]
  patchValidation?: GeneratedPatchValidation
}
type ReviewReportData = {
  decision?: ReviewDecision
  sessionID?: string
  model?: string
  selectedModel?: string
  routing?: HarnessModelRoute
  effectiveModel?: string
  agent?: string
  patchPath?: string
  reviewMode?: ReviewMode
}

export type GenerateProgress = {
  proposalID: string
  status: "running" | "completed" | "failed"
  attempt: number
  startedAt: number
  updatedAt: number
  sessionID?: string
  requestedModel?: string
  selectedModel?: string
  effectiveModel?: string
  rawPath: string
  tracePath?: string
  partialChars?: number
  lastProgressKind?: string
  error?: string
  routing?: Record<string, unknown>
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as JsonRecord
}

function readGeneratedReport(value: unknown): GeneratedReportData | undefined {
  return asRecord(value) as GeneratedReportData | undefined
}

function readReviewReport(value: unknown): ReviewReportData | undefined {
  return asRecord(value) as ReviewReportData | undefined
}

const GENERATION_TIMEOUT_MS = 180_000
const REVIEW_TIMEOUT_MS = 90_000
const GENERATION_MAX_ATTEMPTS = 2
const GENERATION_MAX_STARTUP_RECOVERY_ATTEMPTS = 1
const GENERATION_PROGRESS_HEARTBEAT_MS = 15_000

function authorAttemptTimeoutMS(input: {
  proposal: HarnessState.Proposal
  attempt: number
  allowTools: boolean
  requestedTimeoutMS?: number
}) {
  if (input.requestedTimeoutMS && input.requestedTimeoutMS > 0) return input.requestedTimeoutMS

  let timeoutMS = GENERATION_TIMEOUT_MS
  if (input.proposal.risk === "medium") timeoutMS = 420_000
  if (input.proposal.risk === "large" || input.proposal.risk === "core") timeoutMS = 1_200_000
  if (input.allowTools) timeoutMS = Math.max(timeoutMS, 480_000)
  if (input.attempt > 1) timeoutMS += 300_000
  return timeoutMS
}

function reviewAttemptTimeoutMS(input: {
  proposal: HarnessState.Proposal
  requestedTimeoutMS?: number
}) {
  if (input.requestedTimeoutMS && input.requestedTimeoutMS > 0) return input.requestedTimeoutMS
  if (input.proposal.risk === "medium") return 120_000
  if (input.proposal.risk === "large" || input.proposal.risk === "core") return 240_000
  return REVIEW_TIMEOUT_MS
}

function exploreAttemptTimeoutMS(input: {
  proposal: HarnessState.Proposal
  requestedTimeoutMS?: number
}) {
  if (input.requestedTimeoutMS && input.requestedTimeoutMS > 0) {
    return Math.min(input.requestedTimeoutMS, 300_000)
  }
  if (input.proposal.risk === "large" || input.proposal.risk === "core") return 300_000
  if (input.proposal.risk === "medium") return 180_000
  return 120_000
}

function patchAttemptStallMS(timeoutMS: number) {
  return Math.max(90_000, Math.min(240_000, Math.floor(timeoutMS / 2)))
}

function patchAttemptStartupStallMS(timeoutMS: number) {
  return Math.max(patchAttemptStallMS(timeoutMS), Math.max(90_000, Math.min(timeoutMS - 15_000, 480_000)))
}

function exploreAttemptStallMS(timeoutMS: number) {
  return Math.max(60_000, Math.min(180_000, Math.floor(timeoutMS / 2)))
}

function exploreAttemptStartupStallMS(timeoutMS: number) {
  return Math.max(exploreAttemptStallMS(timeoutMS), Math.max(60_000, Math.min(timeoutMS - 15_000, 300_000)))
}

const ReviewDecisionSchema = z.object({
  verdict: HarnessState.ReviewVerdict,
  summary: z.string(),
  concerns: z.array(z.string()).default([]),
  requiredChanges: z.array(z.string()).default([]),
  verifyCommands: z.array(z.string()).default([]),
})

type ReviewDecision = z.infer<typeof ReviewDecisionSchema>
type ReviewMode = "structured" | "text_fallback" | "deterministic_fallback"

type ReviewRepairInput = {
  proposalID: string
  patchText: string
  decision: ReviewDecision
  model?: string
  agent?: string
  reviewModel?: string
  timeoutMS?: number
  healerNotes?: string[]
  healerSummary?: string
}

function reviewDirectory(proposalID: string) {
  return path.join(HarnessState.reviewDir(), proposalID)
}

function generatedPatchPath(proposalID: string) {
  return path.join(reviewDirectory(proposalID), "generated.patch")
}

function generatedResponsePath(proposalID: string) {
  return path.join(reviewDirectory(proposalID), "generated.response.txt")
}

function autopatchReportPath(proposalID: string) {
  return path.join(reviewDirectory(proposalID), "autopatch.report.json")
}

function generatedReportPath(proposalID: string) {
  return path.join(reviewDirectory(proposalID), "generated.report.json")
}

function reviewReportPath(proposalID: string) {
  return path.join(reviewDirectory(proposalID), "adversarial.review.json")
}

function appendUnique(list: string[] | undefined, values: string[]) {
  return [...new Set([...(list ?? []), ...values])]
}

function extractFirstMatching(raw: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match?.[1]) return match[1].trim()
    if (match?.[0]) return match[0].trim()
  }
  return raw.trim()
}

export function extractPatchText(raw: string) {
  let extracted = extractFirstMatching(raw, [
    /```(?:patch|diff|text)?\s*(\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch)\s*```/i,
    /(\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch)/,
    /```(?:patch|diff|text)?\s*([\s\S]*?)```/i,
  ]).trim()

  if (
    extracted.includes("*** Begin Patch") &&
    !extracted.includes("*** End Patch") &&
    /(^|\n)\*\*\* (?:Update|Add|Delete) File:/m.test(extracted)
  ) {
    extracted = `${extracted}\n*** End Patch`
  }

  return extracted + "\n"
}

export function normalizeGeneratedPatch(patchText: string) {
  let normalizedUnifiedHeaders = false
  const normalizedPatchText = patchText.replace(
    /(^|\n)@@\s*-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s*@@([^\n]*)/g,
    (match, prefix: string, suffix: string) => {
      normalizedUnifiedHeaders = true
      return `${prefix}@@${suffix}`
    },
  )
  return {
    patchText: normalizedPatchText,
    normalizedUnifiedHeaders,
  }
}

function trimValidationMessage(message: string, max = 600) {
  const collapsed = message.replace(/\s+/g, " ").trim()
  return collapsed.length <= max ? collapsed : collapsed.slice(0, max - 3) + "..."
}

function trimErrorMessage(message: string, max = 1_000) {
  const collapsed = message.replace(/\s+/g, " ").trim()
  return collapsed.length <= max ? collapsed : collapsed.slice(0, max - 3) + "..."
}

export function repairGuidance(validationError: string) {
  const guidance: string[] = [
    "Copy every unchanged context line verbatim from the current source artifact. Only edit the minimal lines that truly need to change.",
  ]
  if (/tool call|no-tools patch lane/i.test(validationError)) {
    guidance.push(
      "Do not leave tool-call wrappers or narration in the final answer. Use tools if needed, then return only the apply_patch body.",
    )
  }
  if (/Failed to find expected lines in /i.test(validationError)) {
    guidance.push(
      "At least one hunk used stale or edited context. Rebuild that hunk from the current file contents instead of preserving nearby lines from the previous attempt.",
    )
  }
  if (/git diff syntax/i.test(validationError)) {
    guidance.push("Use apply_patch hunks only. Do not include diff --git, index, ---, or +++ headers.")
  }
  if (
    /contained no apply_patch hunks/i.test(validationError) ||
    /valid apply_patch body/i.test(validationError) ||
    /missing Begin\/End markers/i.test(validationError)
  ) {
    guidance.push("Return only a complete apply_patch body that starts with *** Begin Patch and ends with *** End Patch.")
  }
  return guidance
}

export function extractValidationContextPaths(message: string, root = sourceRoot()) {
  const absoluteRoot = path.resolve(root)
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern =
    process.platform === "win32"
      ? new RegExp(`${escapedRoot}[^:\\n\\r]*?\\.[A-Za-z0-9._-]+`, "gi")
      : new RegExp(`${escapedRoot}[^:\\n\\r]*?\\.[A-Za-z0-9._-]+`, "g")
  const absoluteMatches = (message.match(pattern) ?? []).map((item) => path.normalize(stripAnnotatedFilePathSuffix(item)))
  const relativePattern = /\bpackages[\\/][^:\n\r]*?\.[A-Za-z0-9._-]+(?:\s+\([^)\n\r]*\))?/g
  const relativeMatches = [...message.matchAll(relativePattern)].map((match) =>
    path.normalize(path.resolve(absoluteRoot, HarnessPolicy.normalizeHarnessRelative(stripAnnotatedFilePathSuffix(match[0])))),
  )
  return [...new Set([...absoluteMatches, ...relativeMatches])]
}

async function writeValidationContextArtifacts(input: {
  artifactDir: string
  validationError: string
  sourceFiles: string[]
}) {
  const paths = extractValidationContextPaths(input.validationError)
  if (paths.length === 0) return [] as string[]

  const artifacts: string[] = []
  for (let index = 0; index < paths.length; index += 1) {
    const file = paths[index]
    if (!input.sourceFiles.includes(file) || !Filesystem.exists(file)) continue
    const rel = path.relative(sourceRoot(), file).replaceAll("\\", "/")
    const body = await Filesystem.readText(file).catch(() => "")
    const target = path.join(input.artifactDir, `validation-context-${index + 1}.md`)
    await Filesystem.write(
      target,
      [
        "# Validation Context",
        "",
        `Validation error: ${input.validationError}`,
        "",
        `Current file: ${rel}`,
        "",
        "```text",
        body,
        "```",
        "",
      ].join("\n"),
    )
    artifacts.push(target)
  }
  return artifacts
}

function relativePatchPath(file: string, root = sourceRoot()) {
  const rel = path.relative(root, file).replaceAll("\\", "/")
  return rel || file.replaceAll("\\", "/")
}

type ExploreArtifact = {
  summary?: string
  files: string[]
  intent?: string
  risks: string[]
  nextPatch?: string
}

function parseExploreArtifact(raw: string): ExploreArtifact {
  const sections = new Map<string, string[]>()
  let current: string | undefined
  for (const line of raw.split(/\r?\n/)) {
    const heading = line.match(/^([A-Z ]+):\s*$/)
    if (heading) {
      current = heading[1].trim()
      sections.set(current, [])
      continue
    }
    if (!current) continue
    sections.get(current)?.push(line)
  }

  const bullets = (name: string) =>
    (sections.get(name) ?? [])
      .map((line) => line.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean)

  return {
    summary: bullets("EXPLORE SUMMARY")[0],
    files: bullets("FILES"),
    intent: bullets("INTENT")[0],
    risks: bullets("RISKS"),
    nextPatch: bullets("NEXT PATCH")[0],
  }
}

function normalizeExploreFile(file: string, root = sourceRoot()) {
  const trimmed = stripAnnotatedFilePathSuffix(file)
  if (!trimmed) return undefined
  if (path.isAbsolute(trimmed)) {
    const rel = path.relative(root, trimmed)
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return HarnessPolicy.normalizeHarnessRelative(rel)
    return undefined
  }
  return HarnessPolicy.normalizeHarnessRelative(trimmed)
}

function stripAnnotatedFilePathSuffix(file: string) {
  const trimmed = file.trim().replace(/^`|`$/g, "")
  const annotated = trimmed.match(/^(.*?\.[A-Za-z0-9._-]+)(?:\s+\([^)\n\r]*\)\s*)+$/)
  return (annotated?.[1] ?? trimmed).trim()
}

function resolveExploreSourceFiles(input: {
  files: string[]
  sourceFiles: string[]
}) {
  const known = new Map(
    input.sourceFiles.map((file) => [HarnessPolicy.normalizeHarnessRelative(relativePatchPath(file)), file] as const),
  )
  const relativeFiles = [...new Set(input.files.map((file) => normalizeExploreFile(file)).filter((file): file is string => !!file))]
  const inScopeAbsolute = relativeFiles
    .map((file) => known.get(file))
    .filter((file): file is string => !!file)
  return {
    relativeFiles,
    inScopeAbsolute,
  }
}

export function detectExploreScopeTransition(input: {
  proposal: HarnessState.Proposal
  exploreRaw: string
  sourceFiles: string[]
}) {
  const explore = parseExploreArtifact(input.exploreRaw)
  const exploredFiles = resolveExploreSourceFiles({
    files: explore.files,
    sourceFiles: input.sourceFiles,
  })
  const expectedFiles = new Set(
    [...(input.proposal.expectedFiles ?? []), ...(input.proposal.patchHint?.files ?? [])].map(HarnessPolicy.normalizeHarnessRelative),
  )
  const unexpectedFiles = exploredFiles.relativeFiles.filter((file) => !expectedFiles.has(file))
  const patchSourceFiles = exploredFiles.inScopeAbsolute.length > 0 ? exploredFiles.inScopeAbsolute : input.sourceFiles
  return {
    explore,
    patchSourceFiles,
    unexpectedFiles,
  }
}

export class ScopeRefinementRequestedError extends Error {
  readonly files: string[]

  constructor(message: string, files: string[]) {
    super(message)
    this.name = "ScopeRefinementRequestedError"
    this.files = files
  }
}

function isScopeRefinementRequestedError(error: unknown): error is ScopeRefinementRequestedError {
  return error instanceof ScopeRefinementRequestedError
}

async function requestScopeRefinement(input: {
  proposalID: string
  proposal: HarnessState.Proposal
  discoveredFiles: string[]
  explore: ExploreArtifact
}) {
  const currentFiles = [
    ...(input.proposal.expectedFiles ?? []),
    ...(input.proposal.patchHint?.files ?? []),
  ].map(HarnessPolicy.normalizeHarnessRelative)
  const refinedFiles = [...new Set([...currentFiles, ...input.discoveredFiles.map(HarnessPolicy.normalizeHarnessRelative)])]
  const scope = HarnessPolicy.classifyChangedFiles(refinedFiles)
  const refinedSummaryParts = [
    input.explore.summary,
    input.explore.intent,
    input.explore.nextPatch,
    `Explore discovered additional required files: ${input.discoveredFiles.join(", ")}.`,
    "Re-run confidence research against the widened scope before the next autonomous patch attempt.",
  ].filter(Boolean)
  const refinedSummary = refinedSummaryParts.join(" ")

  await HarnessState.updateProposal(input.proposalID, (current) => ({
    ...current,
    status: "open",
    autoStatus: "staged",
    reviewArtifacts: undefined,
    materializedAt: undefined,
    reviewVerdict: undefined,
    reviewSummary: undefined,
    reviewedAt: undefined,
    lastAutoExecutionError: undefined,
    confidenceOverride: HarnessState.effectiveConfidence(current) === "high" ? "medium" : current.confidenceOverride,
    confidenceResearchStatus: "idle",
    confidenceResearchSummary: refinedSummary,
    confidenceResearchAt: Date.now(),
    confidenceResearchError: undefined,
    expectedFiles: refinedFiles,
    risk: scope.risk,
    riskReasons: scope.riskReasons,
    sensitivePaths: scope.sensitivePaths,
    maxFiles: scope.maxFiles,
    maxChangedLines: scope.maxChangedLines,
    allowMove: scope.allowMove,
    allowDelete: scope.allowDelete,
    requirePriorValidation: scope.requirePriorValidation,
    patchHint: {
      summary: refinedSummary,
      files: refinedFiles,
    },
  }))

  await HarnessState.appendObservation({
    source: "analyzer",
    kind: "proposal.scope_refined",
    message: `Explore widened proposal scope for ${input.proposalID} before patch emission.`,
    data: {
      proposalID: input.proposalID,
      discoveredFiles: input.discoveredFiles,
      refinedFiles,
      intent: input.explore.intent,
      nextPatch: input.explore.nextPatch,
    },
  })

  throw new ScopeRefinementRequestedError(
    `Explore identified additional required files outside the current proposal scope: ${input.discoveredFiles.join(", ")}.`,
    input.discoveredFiles,
  )
}

function authorAttemptCanUseTools(input: { sourceFiles: string[] }) {
  return input.sourceFiles.length > 0
}

function stripPatchSectionsForFiles(input: {
  patchText: string
  root?: string
  files: string[]
}) {
  const root = input.root ?? sourceRoot()
  const targets = new Set(input.files.map((file) => path.normalize(file)))
  const lines = input.patchText.split("\n")
  const beginIdx = lines.findIndex((line) => line.trim() === "*** Begin Patch")
  const endIdx = lines.findIndex((line) => line.trim() === "*** End Patch")
  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
    return {
      patchText: input.patchText,
      removedFiles: [] as string[],
    }
  }

  const headerPattern = /^\*\*\* (Add|Delete|Update) File:\s+(.+)$/
  const movePattern = /^\*\*\* Move to:\s+(.+)$/
  const output = lines.slice(0, beginIdx + 1)
  const removedFiles: string[] = []

  let index = beginIdx + 1
  while (index < endIdx) {
    const header = lines[index].match(headerPattern)
    if (!header) {
      output.push(lines[index])
      index += 1
      continue
    }

    const filePath = header[2].trim()
    let sectionEnd = index + 1
    let movePath: string | undefined
    if (sectionEnd < endIdx) {
      const move = lines[sectionEnd].match(movePattern)
      if (move) {
        movePath = move[1].trim()
        sectionEnd += 1
      }
    }
    while (sectionEnd < endIdx && !headerPattern.test(lines[sectionEnd])) {
      sectionEnd += 1
    }

    const absolutePaths = [
      path.resolve(root, filePath),
      ...(movePath ? [path.resolve(root, movePath)] : []),
    ].map((item) => path.normalize(item))
    const shouldRemove = absolutePaths.some((item) => targets.has(item))
    if (shouldRemove) {
      removedFiles.push(relativePatchPath(path.resolve(root, filePath), root))
    } else {
      output.push(...lines.slice(index, sectionEnd))
    }
    index = sectionEnd
  }

  output.push(lines[endIdx])
  if (endIdx + 1 < lines.length) output.push(...lines.slice(endIdx + 1))
  return {
    patchText: output.join("\n"),
    removedFiles,
  }
}

async function salvageGeneratedPatch(input: {
  patchText: string
  normalizedUnifiedHeaders: boolean
  validationError: string
}) {
  if (!/Failed to find expected lines in /i.test(input.validationError)) return
  const failedFiles = extractValidationContextPaths(input.validationError)
  if (failedFiles.length === 0) return

  const stripped = stripPatchSectionsForFiles({
    patchText: input.patchText,
    files: failedFiles,
  })
  if (stripped.removedFiles.length === 0) return

  const { hunks } = Patch.parsePatch(stripped.patchText)
  if (hunks.length === 0) return

  const verified = await Patch.maybeParseApplyPatchVerified(["apply_patch", stripped.patchText], sourceRoot())
  if (verified.type !== Patch.MaybeApplyPatchVerified.Body) return

  return {
    patchText: stripped.patchText,
    hunkCount: hunks.length,
    changeCount: verified.action.changes.size,
    normalizedUnifiedHeaders: input.normalizedUnifiedHeaders,
    salvagedFiles: stripped.removedFiles,
  }
}

export function validateGeneratedPatch(patchText: string) {
  const normalized = normalizeGeneratedPatch(patchText)
  const { hunks } = Patch.parsePatch(normalized.patchText)
  if (hunks.length === 0) {
    if (/(^|\n)\s*diff --git\s+/i.test(normalized.patchText) || /(^|\n)\s*index\s+[0-9a-f]+\.\.[0-9a-f]+/i.test(normalized.patchText)) {
      throw new Error("Patch used git diff syntax instead of apply_patch hunks.")
    }
    throw new Error("Patch contained no apply_patch hunks.")
  }

  const verified = Patch.maybeParseApplyPatchVerified(["apply_patch", normalized.patchText], sourceRoot())
  return Promise.resolve(verified).then((result) => {
    if (result.type === Patch.MaybeApplyPatchVerified.CorrectnessError) {
      return salvageGeneratedPatch({
        patchText: normalized.patchText,
        normalizedUnifiedHeaders: normalized.normalizedUnifiedHeaders,
        validationError: result.error.message,
      }).then((salvaged) => {
        if (salvaged) return salvaged
        throw result.error
      })
    }
    if (result.type !== Patch.MaybeApplyPatchVerified.Body) {
      throw new Error("Patch could not be verified as a valid apply_patch body.")
    }
    return {
      patchText: normalized.patchText,
      hunkCount: hunks.length,
      changeCount: result.action.changes.size,
      normalizedUnifiedHeaders: normalized.normalizedUnifiedHeaders,
      salvagedFiles: [] as string[],
    }
  })
}

export function extractJsonText(raw: string) {
  return extractFirstMatching(raw, [
    /```json\s*([\s\S]*?)```/i,
    /```\s*([\s\S]*?)```/i,
    /(\{[\s\S]*\})/,
  ])
}

function normalizeReviewDecision(input: ReviewDecision): ReviewDecision {
  const clean = (items: string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, 12)
  return {
    verdict: input.verdict,
    summary: input.summary.trim(),
    concerns: clean(input.concerns),
    requiredChanges: clean(input.requiredChanges),
    verifyCommands: clean(input.verifyCommands),
  }
}

export function parseReviewDecision(raw: string) {
  const parsed: unknown = JSON.parse(extractJsonText(raw))
  return normalizeReviewDecision(ReviewDecisionSchema.parse(parsed))
}

async function ensureCodePatchProposal(proposalID: string) {
  const snapshot = await HarnessState.getSnapshot()
  const proposal = snapshot.proposals.find((item) => item.id === proposalID)
  if (!proposal) throw new Error(`Proposal not found: ${proposalID}`)
  if (proposal.kind !== "code_patch") throw new Error(`Proposal is not a code_patch: ${proposalID}`)
  return proposal
}

async function ensureMaterializedArtifacts(proposalID: string) {
  const proposal = await ensureCodePatchProposal(proposalID)
  if (!proposal.reviewArtifacts || proposal.reviewArtifacts.length === 0) {
    await HarnessReview.materialize({ proposalID })
  }
  const refreshed = await ensureCodePatchProposal(proposalID)
  const artifactDir = reviewDirectory(proposalID)
  return {
    proposal: refreshed,
    artifactDir,
    proposalPath: path.join(artifactDir, "proposal.json"),
    reviewPath: path.join(artifactDir, "review.md"),
    promptPath: path.join(artifactDir, "implement.prompt.md"),
    baseArtifacts: [
      path.join(artifactDir, "proposal.json"),
      path.join(artifactDir, "review.md"),
      path.join(artifactDir, "implement.prompt.md"),
    ],
  }
}

async function resolveExisting(files: string[]) {
  const keep: string[] = []
  for (const file of files) {
    if (await Filesystem.exists(file)) keep.push(file)
  }
  return keep
}

async function sourceArtifacts(input: {
  proposal: HarnessState.Proposal
  proposalPath: string
}) {
  const materialized = await Filesystem.readJson<{
    targets?: {
      relativePath?: string
      absolutePath?: string
    }[]
  }>(input.proposalPath).catch(() => undefined)
  const materializedTargets = materialized?.targets
    ?.map((target) => target.absolutePath)
    .filter((target): target is string => !!target)
  const existingMaterializedTargets = materializedTargets ? await resolveExisting(materializedTargets) : []
  if (existingMaterializedTargets.length > 0) return existingMaterializedTargets

  const files = input.proposal.expectedFiles ?? input.proposal.patchHint?.files ?? []
  return await resolveExisting(files.map((file) => resolveHarnessSourcePath(file, sourceRoot())))
}

function patchCandidatePaths(raw: string) {
  const matches = [...raw.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)]
  return matches.map((match) => resolveHarnessSourcePath(match[1].trim(), sourceRoot()))
}

function pickAttemptSourceFiles(input: {
  proposal: HarnessState.Proposal
  sourceFiles: string[]
  attempt: number
  previousRaw?: string
  validationError?: string
  previousAttemptHardFailure?: boolean
  previousAttemptStartupFailure?: boolean
}) {
  if (input.sourceFiles.length <= 1) return input.sourceFiles

  const known = new Set(input.sourceFiles)
  const validationScoped = (input.validationError ? extractValidationContextPaths(input.validationError) : []).filter((file) =>
    known.has(file),
  )
  if (validationScoped.length > 0) return validationScoped

  const patchScoped = (input.previousRaw ? patchCandidatePaths(input.previousRaw) : []).filter((file) => known.has(file))
  if (patchScoped.length > 0) return patchScoped

  const precursorMode = input.proposal.risk === "large" || input.proposal.risk === "core" || input.sourceFiles.length > 1
  if (!precursorMode) return input.sourceFiles

  if (input.attempt > 1 && input.previousAttemptHardFailure) {
    if (input.previousAttemptStartupFailure) return [input.sourceFiles[0]]
    const index = Math.min(input.attempt - 1, input.sourceFiles.length - 1)
    return [input.sourceFiles[index]]
  }

  return [input.sourceFiles[0]]
}

function shouldUseSourceFirstRetryArtifacts(validationError?: string) {
  if (!validationError) return false
  return /Failed to find expected lines in /i.test(validationError)
}

function shouldRunExplorePass(input: {
  proposal: HarnessState.Proposal
  attempt: number
  sourceFiles: string[]
  allowTools: boolean
  validationError?: string
  previousAttemptHardFailure?: boolean
  previousAttemptStartupFailure?: boolean
}) {
  if (!input.allowTools) return false
  if (input.sourceFiles.length === 0) return false
  if (input.attempt === 1) return true
  if (input.previousAttemptStartupFailure) return false
  return !!input.previousAttemptHardFailure || !!input.validationError
}

async function writeSourceSnapshotArtifacts(input: {
  artifactDir: string
  sourceFiles: string[]
  label: string
}) {
  const artifacts: string[] = []
  for (let index = 0; index < input.sourceFiles.length; index += 1) {
    const file = input.sourceFiles[index]
    if (!Filesystem.exists(file)) continue
    const rel = relativePatchPath(file)
    const body = await Filesystem.readText(file).catch(() => "")
    const target = path.join(input.artifactDir, `${input.label}.source-${index + 1}.md`)
    await Filesystem.write(
      target,
      [
        "# Attempt Source Snapshot",
        "",
        `Current file: ${rel}`,
        "",
        "```text",
        body,
        "```",
        "",
      ].join("\n"),
    )
    artifacts.push(target)
  }
  return artifacts
}

function generatePromptText(input: {
  proposal: HarnessState.Proposal
  artifacts: string[]
  sourceFiles: string[]
  allowTools: boolean
}) {
  return [
    "Generate a valid apply_patch patch for the OpenCode harness source repo.",
    "",
    "Requirements:",
    "- Output ONLY the patch text.",
    "- The patch must start with *** Begin Patch and end with *** End Patch.",
    "- Use ONLY apply_patch hunk syntax like *** Update File:, *** Add File:, *** Delete File:, @@, +, -, and leading spaces for context.",
    "- Do NOT output git diff headers such as diff --git, index, ---, or +++.",
    "- Do not wrap the patch in backticks.",
    "- Do not explain anything before or after the patch.",
    "- Only change files needed for this proposal.",
    "- Keep each hunk minimal and copy unchanged context lines verbatim from the current source file.",
    "- Before you return the patch, self-check that every context line and removed line already exists exactly in the current source artifact.",
    ...(input.allowTools
      ? [
          "- You may use read/list/grep/glob/codesearch freely to inspect, compare, and re-anchor on the exact current source before you emit the patch.",
          "- You may inspect neighboring harness files, related call sites, and module edges when that helps you land a smaller safer in-scope patch.",
          "- Take the time you need to understand the current code and then return the strongest valid patch you can.",
        ]
      : ["- Do not call tools for this patch. Use the attached artifacts as the complete source of truth."]),
    "- Do not attempt to edit files directly. Produce the patch only.",
    "- Use the attached proposal artifacts for intent and constraints.",
    "- Treat the listed current target files as the source of truth for the code that exists right now.",
    "- Prefer the smallest precursor patch that makes real progress instead of trying to finish the whole proposal in one attempt.",
    "- If the proposal hint is stale relative to the live source, adapt to the current code and return the strongest in-scope precursor patch instead of forcing brittle assumptions.",
    "- If only a subset of target files is listed for this attempt, limit the patch to that subset.",
    ...(input.allowTools
      ? ["- Use tools as needed on those target files before patching when the exact current contents matter."]
      : ["- Do not re-read the target files with tools. Patch directly from the attached artifacts."]),
    "",
    `Proposal title: ${input.proposal.title}`,
    `Proposal rationale: ${input.proposal.rationale}`,
    `Patch hint: ${input.proposal.patchHint?.summary ?? "No patch hint provided."}`,
    "",
    `Harness source root: ${sourceRoot()}`,
    `Caller harness root: ${callerHarnessRoot()}`,
    "",
    "Attached artifacts:",
    ...input.artifacts.map((artifact) => `- ${artifact}`),
    "",
    "Current target files to inspect with tools as needed:",
    ...(input.sourceFiles.length > 0 ? input.sourceFiles.map((artifact) => `- ${artifact}`) : ["- None provided"]),
  ].join("\n")
}

function explorePromptText(input: {
  proposal: HarnessState.Proposal
  artifacts: string[]
  sourceFiles: string[]
}) {
  return [
    "Prepare a harness self-edit patch with maximum useful freedom before the final patch handoff.",
    "",
    "Use read-only tools freely to inspect the listed target files, nearby call sites, and any immediately related harness files.",
    "Do not output a patch in this stage.",
    "Do not explain every thought. Just produce a compact, high-signal exploration artifact that the final patch pass can use.",
    "If the proposal hint is stale, pivot toward the strongest in-scope precursor patch that matches the current source.",
    "",
    "Return plain text with these sections exactly:",
    "EXPLORE SUMMARY:",
    "- one short summary line",
    "FILES:",
    "- exact files that should be touched in the next patch",
    "INTENT:",
    "- the concrete change to make",
    "RISKS:",
    "- any specific stale-context or behavior risks to watch",
    "NEXT PATCH:",
    "- the smallest precursor patch that should be written next",
    "",
    `Proposal title: ${input.proposal.title}`,
    `Proposal rationale: ${input.proposal.rationale}`,
    `Patch hint: ${input.proposal.patchHint?.summary ?? "No patch hint provided."}`,
    "",
    "Attached artifacts:",
    ...input.artifacts.map((artifact) => `- ${artifact}`),
    "",
    "Target files to inspect:",
    ...(input.sourceFiles.length > 0 ? input.sourceFiles.map((artifact) => `- ${artifact}`) : ["- None provided"]),
  ].join("\n")
}

function staleContextExplorePromptText(input: {
  proposal: HarnessState.Proposal
  artifacts: string[]
  sourceFiles: string[]
  validationError: string
}) {
  return [
    "Re-anchor a stale-context harness patch against the exact current source before writing another patch.",
    "",
    "Use read-only tools freely on the listed target files and any immediately adjacent call sites you truly need.",
    "Do not output a patch in this stage.",
    "Your job is to rebuild confidence in the live source, identify the exact current anchors for the next hunk, and recommend the smallest safe next patch.",
    "Prefer current source truth over any stale proposal wording or earlier draft structure.",
    "",
    "Return plain text with these sections exactly:",
    "EXPLORE SUMMARY:",
    "- one short summary line",
    "FILES:",
    "- exact files that should be touched in the next patch",
    "LIVE ANCHORS:",
    "- copy the exact current source lines or short snippets the next patch should anchor on",
    "INTENT:",
    "- the concrete change to make from the live source state",
    "RISKS:",
    "- any specific stale-context or behavior risks to watch",
    "NEXT PATCH:",
    "- the smallest precursor patch that should be written next",
    "",
    `Proposal title: ${input.proposal.title}`,
    `Proposal rationale: ${input.proposal.rationale}`,
    `Patch hint: ${input.proposal.patchHint?.summary ?? "No patch hint provided."}`,
    `Previous validation error: ${input.validationError}`,
    "",
    "Attached artifacts:",
    ...input.artifacts.map((artifact) => `- ${artifact}`),
    "",
    "Target files to inspect:",
    ...(input.sourceFiles.length > 0 ? input.sourceFiles.map((artifact) => `- ${artifact}`) : ["- None provided"]),
  ].join("\n")
}

function shouldRunFailureDiagnosis(input: {
  attempt: number
  allowTools: boolean
  previousAttemptHardFailure?: boolean
  previousAttemptStartupFailure?: boolean
}) {
  if (input.previousAttemptStartupFailure) return false
  return input.attempt > 1 && input.allowTools && !!input.previousAttemptHardFailure
}

function startupDiagnosisText(input: {
  proposal: HarnessState.Proposal
  sourceFiles: string[]
  failureReason: string
}) {
  return [
    "FAILURE:",
    "- The previous attempt stalled at session_start before any author output.",
    "LIKELY CAUSE:",
    "- This looks like startup churn or provider/session bring-up delay rather than a content failure.",
    "SELF-CORRECTION:",
    "- Skip extra diagnosis/explore hops, keep the same precursor scope, and retry the patch directly with the current source attached.",
    "NEXT PATCH:",
    `- Retry the smallest in-scope precursor patch using ${input.sourceFiles.map((file) => relativePatchPath(file)).join(", ") || "the current target files"}.`,
    "WATCHOUTS:",
    "- Do not widen scope or rotate files just because startup was slow.",
    `- Preserve proposal intent: ${input.proposal.title}.`,
    `- Previous failure: ${input.failureReason}`,
    "",
  ].join("\n")
}

function failureDiagnosisPromptText(input: {
  proposal: HarnessState.Proposal
  artifacts: string[]
  sourceFiles: string[]
  failureReason: string
}) {
  return [
    "Diagnose why the previous harness author attempt failed and identify the best self-correction path before the next patch pass.",
    "",
    "Use read-only tools freely to inspect the listed target files, nearby call sites, and any immediately related harness files.",
    "Do not output a patch in this stage.",
    "Do not narrate every thought. Produce a compact diagnosis artifact that the next exploration and patch pass can use.",
    "If the failure points to harness startup, routing, context drift, or tool strategy rather than the proposal itself, say so plainly.",
    "If the best next step is a small self-correction precursor patch that unblocks the original intent, recommend that patch.",
    "",
    "Return plain text with these sections exactly:",
    "FAILURE:",
    "- one short line naming the observed failure",
    "LIKELY CAUSE:",
    "- the most likely root cause",
    "SELF-CORRECTION:",
    "- the smallest correction or strategy shift that should unblock the next attempt",
    "NEXT PATCH:",
    "- the exact smallest patch to try next",
    "WATCHOUTS:",
    "- any concrete risk that could make the next patch invalid again",
    "",
    `Proposal title: ${input.proposal.title}`,
    `Proposal rationale: ${input.proposal.rationale}`,
    `Patch hint: ${input.proposal.patchHint?.summary ?? "No patch hint provided."}`,
    `Previous failure: ${input.failureReason}`,
    "",
    "Attached artifacts:",
    ...input.artifacts.map((artifact) => `- ${artifact}`),
    "",
    "Target files to inspect:",
    ...(input.sourceFiles.length > 0 ? input.sourceFiles.map((artifact) => `- ${artifact}`) : ["- None provided"]),
  ].join("\n")
}

function repairPromptText(input: {
  proposal: HarnessState.Proposal
  artifacts: string[]
  sourceFiles: string[]
  previousRaw: string
  validationError: string
  allowTools: boolean
  validationArtifacts?: string[]
  healerNotes?: string[]
  healerSummary?: string
  suppressPreviousOutput?: boolean
  preferFreshContext?: boolean
}) {
  const staleContextRetry = shouldUseSourceFirstRetryArtifacts(input.validationError)
  const suppressPreviousOutput = staleContextRetry || input.suppressPreviousOutput
  return [
    generatePromptText({
      proposal: input.proposal,
      artifacts: input.artifacts,
      sourceFiles: input.sourceFiles,
      allowTools: input.allowTools,
    }),
    "",
    "Your previous attempt was invalid. Repair it now.",
    "",
    `Validation error: ${input.validationError}`,
    "",
    "Repair guidance:",
    ...repairGuidance(input.validationError).map((line) => `- ${line}`),
    ...(input.validationArtifacts && input.validationArtifacts.length > 0
      ? [
          "",
          "Use the attached validation-context artifacts as the current source of truth for the file(s) that failed verification.",
          "If a previous hunk re-added code that already exists, remove or rewrite that hunk instead of preserving it.",
          "You may regenerate the patch from scratch; do not preserve stale context just because it appeared in the earlier attempt.",
        ]
      : []),
    ...(input.healerNotes && input.healerNotes.length > 0
      ? [
          "",
          `Healer summary: ${input.healerSummary ?? "Bounded retry intervention applied."}`,
          "",
          "Healer notes:",
          ...input.healerNotes.map((line) => `- ${line}`),
        ]
      : []),
    ...(input.preferFreshContext
      ? [
          "",
          "Retry emphasis:",
          "- Re-anchor from the current source snapshots and attached artifacts before you write any hunk.",
          "- Prefer a fresh patch over preserving any prior draft structure.",
        ]
      : []),
    "",
    ...(suppressPreviousOutput
      ? [
          "Previous invalid output:",
          "[omitted for stale-context repair to avoid reusing invalid hunk context]",
          "",
        ]
      : ["Previous invalid output:", input.previousRaw, ""]),
    "Return a corrected apply_patch patch only.",
  ].join("\n")
}

function reviewRepairPromptText(input: {
  proposal: HarnessState.Proposal
  artifacts: string[]
  sourceFiles: string[]
  patchText: string
  decision: ReviewDecision
  reviewModel?: string
  healerNotes?: string[]
  healerSummary?: string
}) {
  return [
    generatePromptText({
      proposal: input.proposal,
      artifacts: input.artifacts,
      sourceFiles: input.sourceFiles,
      allowTools: true,
    }),
    "",
    "Your previous patch validated, but adversarial review returned REVISE.",
    "Revise the patch so it answers the reviewer directly, then return the stronger patch only.",
    "Keep the patch in declared scope and only widen behavior when the review feedback truly requires it.",
    "If the reviewer asks for verification support or tests, incorporate the smallest in-scope change that addresses that gap.",
    "",
    `Reviewer model: ${input.reviewModel ?? "auto/quality"}`,
    `Reviewer summary: ${input.decision.summary}`,
    "",
    "Reviewer concerns:",
    ...(input.decision.concerns.length > 0 ? input.decision.concerns.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Required changes:",
    ...(input.decision.requiredChanges.length > 0
      ? input.decision.requiredChanges.map((item) => `- ${item}`)
      : ["- none"]),
    "",
    "Suggested verification commands:",
    ...(input.decision.verifyCommands.length > 0
      ? input.decision.verifyCommands.map((item) => `- ${item}`)
      : ["- none"]),
    ...(input.healerNotes && input.healerNotes.length > 0
      ? [
          "",
          `Healer summary: ${input.healerSummary ?? "Bounded retry intervention applied."}`,
          "",
          "Healer notes:",
          ...input.healerNotes.map((item) => `- ${item}`),
        ]
      : []),
    "",
    "Previous reviewed patch:",
    input.patchText,
    "",
    "Return a revised apply_patch patch only.",
  ].join("\n")
}

function reviewPromptText(input: {
  proposal: HarnessState.Proposal
  artifacts: string[]
  authorModel?: string
  patchPath: string
}) {
  return [
    "You are the adversarial review gate for an autonomous self-edit to the OpenCode harness.",
    "",
    "Review the proposal, generated patch, and implementation context.",
    "Your job is to be skeptical and concrete.",
    "Prefer REVISE over APPROVE if there are meaningful unanswered questions, missing tests, weak verification, or risky changes.",
    "Use REJECT only when the proposal or patch is unsound enough that it should not continue in its current direction.",
    "",
    "Return JSON ONLY with this exact shape:",
    "{",
    '  "verdict": "approve" | "revise" | "reject",',
    '  "summary": "short verdict summary",',
    '  "concerns": ["specific risk or gap"],',
    '  "requiredChanges": ["specific change needed before apply"],',
    '  "verifyCommands": ["concrete verification command to run from packages/opencode, or none if no suitable command exists"]',
    "}",
    "",
    "Constraints:",
    "- Do not wrap the JSON in markdown fences.",
    "- Do not include extra prose before or after the JSON.",
    "- If you are not confident the patch should land, choose revise.",
    "",
    `Proposal title: ${input.proposal.title}`,
    `Proposal rationale: ${input.proposal.rationale}`,
    `Patch hint: ${input.proposal.patchHint?.summary ?? "No patch hint provided."}`,
    `Author model: ${input.authorModel ?? "unspecified"}`,
    `Generated patch path: ${input.patchPath}`,
    "",
    "Attached artifacts:",
    ...input.artifacts.map((artifact) => `- ${artifact}`),
  ].join("\n")
}

function reviewResponseFormat() {
  return {
    type: "json_schema" as const,
    schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        verdict: {
          type: "string" as const,
          enum: ["approve", "revise", "reject"],
        },
        summary: {
          type: "string" as const,
        },
        concerns: {
          type: "array" as const,
          items: { type: "string" as const },
        },
        requiredChanges: {
          type: "array" as const,
          items: { type: "string" as const },
        },
        verifyCommands: {
          type: "array" as const,
          items: { type: "string" as const },
        },
      },
      required: ["verdict", "summary", "concerns", "requiredChanges", "verifyCommands"],
    },
    retryCount: 1,
  }
}

function buildDeterministicReviewDecision(input: {
  proposal: HarnessState.Proposal
  patchText: string
  failureReason: string
  reviewAttempts?: number
}) {
  const patchScope = HarnessPolicy.validatePatchAgainstProposal(input.proposal, input.patchText)
  const strategicConcerns = HarnessPolicy.strategicPatchConcerns(input.proposal, input.patchText)
  if (strategicConcerns.length > 0) {
    return {
      decision: normalizeReviewDecision({
        verdict: "reject",
        summary: "Deterministic fallback rejected a patch that retreats harness autonomy instead of improving execution.",
        concerns: [
          ...strategicConcerns,
          `Fallback reason: ${trimErrorMessage(input.failureReason, 300)}`,
        ],
        requiredChanges: [
          "Keep large upgrades autonomous and tighten routing, decomposition, or verification instead of forcing them back to staged-only handling.",
        ],
        verifyCommands: [],
      }),
      patchScope,
    }
  }
  const expectedFiles = new Set(input.proposal.expectedFiles ?? [])
  const fullyDeclared =
    expectedFiles.size > 0 && patchScope.changedFiles.every((file) => expectedFiles.has(file))
  const tinyPatch =
    patchScope.fileCount <= 1 &&
    patchScope.changedLineCount <= 12 &&
    !patchScope.hasMove &&
    !patchScope.hasDelete
  const shadowSafePatch = fullyDeclared && !patchScope.hasMove && !patchScope.hasDelete
  const timeoutLabel = input.reviewAttempts === 1 ? "timed out" : "timed out twice"

  if (shadowSafePatch) {
    return {
      decision: normalizeReviewDecision({
        verdict: "approve",
        summary: tinyPatch
          ? `Model review ${timeoutLabel}; deterministic fallback approved a tiny in-scope patch for validation.`
          : `Model review ${timeoutLabel}; deterministic fallback approved an in-scope patch for shadow validation.`,
        concerns: tinyPatch
          ? [
              `Model-based adversarial review ${timeoutLabel}.`,
              "Treat this approval as suitable for shadow or validate-only execution, not direct live apply.",
            ]
          : [
              `Model-based adversarial review ${timeoutLabel}.`,
              "Patch is larger than a tiny fallback approval, so shadow validation must succeed before any live apply.",
              "Treat this approval as suitable for shadow or validate-only execution, not direct live apply.",
            ],
        requiredChanges: [],
        verifyCommands: [],
      }),
      patchScope,
    }
  }

  return {
    decision: normalizeReviewDecision({
      verdict: "revise",
      summary: "Model review timed out and deterministic fallback could not safely approve the patch.",
      concerns: [
        `Model-based adversarial review ${timeoutLabel}.`,
        `Fallback reason: ${trimErrorMessage(input.failureReason, 300)}`,
        "Patch was not small and fully in declared scope, so deterministic approval would be too risky.",
      ],
      requiredChanges: ["Retry review with a stronger or faster reviewer model before execution."],
      verifyCommands: [],
    }),
    patchScope,
  }
}

function buildDeterministicReviewText(input: {
  decision: ReviewDecision
  failureReason: string
  patchScope: ReturnType<typeof HarnessPolicy.validatePatchAgainstProposal>
}) {
  return [
    "DETERMINISTIC REVIEW FALLBACK",
    `FAILURE: ${trimErrorMessage(input.failureReason, 500)}`,
    `VERDICT: ${input.decision.verdict.toUpperCase()}`,
    `SUMMARY: ${input.decision.summary}`,
    "CONCERNS:",
    ...(input.decision.concerns.length > 0 ? input.decision.concerns.map((item) => `- ${item}`) : ["- none"]),
    "REQUIRED CHANGES:",
    ...(input.decision.requiredChanges.length > 0
      ? input.decision.requiredChanges.map((item) => `- ${item}`)
      : ["- none"]),
    "VERIFY:",
    ...(input.decision.verifyCommands.length > 0
      ? input.decision.verifyCommands.map((item) => `- ${item}`)
      : ["- none"]),
    "PATCH SCOPE:",
    `- files: ${input.patchScope.fileCount}`,
    `- changedLines: ${input.patchScope.changedLineCount}`,
    `- hasMove: ${input.patchScope.hasMove}`,
    `- hasDelete: ${input.patchScope.hasDelete}`,
  ].join("\n")
}

async function writeAutopatchReport(input: {
  proposalID: string
  reportPath: string
  startedAt: number
  stages: AutopatchStageReport[]
  status: "running" | "completed" | "failed" | "staged"
  generation?: Record<string, unknown>
  review?: Record<string, unknown>
  verifyPlan?: Record<string, unknown>
  execution?: Record<string, unknown>
  error?: string
}) {
  await Filesystem.writeJson(input.reportPath, {
    proposalID: input.proposalID,
    startedAt: input.startedAt,
    updatedAt: Date.now(),
    status: input.status,
    stages: input.stages,
    generation: input.generation,
    review: input.review,
    verifyPlan: input.verifyPlan,
    execution: input.execution,
    error: input.error,
  })
}

async function writeGeneratedReport(input: {
  proposalID: string
  reportPath: string
  status: "running" | "completed" | "failed"
  sessionID?: string
  model?: string
  variant?: string
  selectedModel?: string
  routing?: Record<string, unknown>
  effectiveModel?: string
  agent?: string
  rawPath?: string
  tracePath?: string
  patchPath?: string
  attempts?: GeneratedAttemptSummary[]
  patchValidation?: GeneratedPatchValidation
  patchScope?: Record<string, unknown>
  generatedAt?: number
  currentStage?: "diagnosis" | "explore" | "patch"
  currentStageArtifactPath?: string
  currentAttempt?: number
  currentAttemptStartedAt?: number
  currentAttemptTracePath?: string
  lastProgressKind?: string
  lastProgressAt?: number
  partialChars?: number
  error?: string
}) {
  await Filesystem.writeJson(input.reportPath, {
    proposalID: input.proposalID,
    sessionID: input.sessionID,
    model: input.model,
    variant: input.variant,
    selectedModel: input.selectedModel,
    routing: input.routing,
    effectiveModel: input.effectiveModel,
    agent: input.agent,
    sourceRoot: sourceRoot(),
    status: input.status,
    generatedAt: input.generatedAt,
    updatedAt: Date.now(),
    rawPath: input.rawPath,
    tracePath: input.tracePath,
    patchPath: input.patchPath,
    reportPath: input.reportPath,
    attempts: input.attempts,
    patchValidation: input.patchValidation,
    patchScope: input.patchScope,
    currentStage: input.currentStage,
    currentStageArtifactPath: input.currentStageArtifactPath,
    currentAttempt: input.currentAttempt,
    currentAttemptStartedAt: input.currentAttemptStartedAt,
    currentAttemptTracePath: input.currentAttemptTracePath,
    lastProgressKind: input.lastProgressKind,
    lastProgressAt: input.lastProgressAt,
    partialChars: input.partialChars,
    error: input.error,
  })
}

function resolvedHarnessModel(result: {
  resolvedModel?: string
  selectedModel?: string
  requestedModel?: string
}) {
  return result.resolvedModel ?? result.selectedModel ?? result.requestedModel
}

function normalizedGenerationValidationError(raw: string, message: string) {
  if (/\[TOOL_CALL\]|\{tool\s*=>/i.test(raw)) {
    return "Attempted tool calls instead of returning an apply_patch body."
  }
  return trimValidationMessage(message)
}

function isSessionStartFailure(message: string | undefined) {
  return /Last progress:\s*session_start\b/i.test(message ?? "")
}

function failedHarnessModel(message: string | undefined) {
  return message?.match(/Route:\s*([^\r\n]+)/i)?.[1]?.trim().replace(/[.]+$/, "")
}

const harnessGenerateExtractPatchText = extractPatchText
const harnessGenerateExtractJsonText = extractJsonText
const harnessGenerateParseReviewDecision = parseReviewDecision
const harnessGenerateValidateGeneratedPatch = validateGeneratedPatch
const harnessGenerateExtractValidationContextPaths = extractValidationContextPaths
const harnessGenerateRepairGuidance = repairGuidance
const harnessGenerateDeterministicReviewDecision = buildDeterministicReviewDecision
const harnessGenerateIsScopeRefinementRequestedError = isScopeRefinementRequestedError

/* eslint-disable @typescript-eslint/no-namespace, @typescript-eslint/no-shadow */
export namespace HarnessGenerate {
  export const extractPatchText = harnessGenerateExtractPatchText
  export const extractJsonText = harnessGenerateExtractJsonText
  export const parseReviewDecision = harnessGenerateParseReviewDecision
  export const validateGeneratedPatch = harnessGenerateValidateGeneratedPatch
  export const extractValidationContextPaths = harnessGenerateExtractValidationContextPaths
  export const repairGuidance = harnessGenerateRepairGuidance
  export const deterministicReviewDecision = harnessGenerateDeterministicReviewDecision
  export const isScopeRefinementRequestedError = harnessGenerateIsScopeRefinementRequestedError

  export async function generate(input: GenerateInput) {
    const { proposal, artifactDir, proposalPath, promptPath } = await ensureMaterializedArtifacts(input.proposalID)
    const rawPath = generatedResponsePath(input.proposalID)
    const patchPath = generatedPatchPath(input.proposalID)
    const reportPath = path.join(artifactDir, "generated.report.json")
    const generationStartedAt = Date.now()
    const preferred = await readHarnessPreferredRoute("author").catch(() => undefined)
    const model =
      input.model ??
      preferred?.model ??
      pickHarnessSessionModel({
        lane: "author",
        providers: await Provider.list().catch(() => ({})),
        scorecard: await readHarnessModelScorecard().catch(() => undefined),
        requestedModel: "auto/quality",
        preferredModel: preferred?.model ?? (await readHarnessPreferredModel("author").catch(() => undefined)),
      })?.selectedModel ??
      "auto/quality"
    const variant = input.variant ?? preferred?.variant

    const sourceFiles = await sourceArtifacts({
      proposal,
      proposalPath,
    })
    const allowTools = sourceFiles.length === 0
    const baseArtifacts = await resolveExisting([proposalPath, promptPath])
    let result:
      | Awaited<ReturnType<typeof runReadOnlyHarnessSession>>
      | undefined
    let patchText = ""
    let patchValidation:
      | GeneratedPatchValidation
      | undefined
    let patchScope:
      | ReturnType<typeof HarnessPolicy.validatePatchAgainstProposal>
      | undefined
    const attempts: {
      attempt: number
      sessionID: string
      rawPath: string
      tracePath?: string
      validationError?: string
    }[] = []
    let previousRaw = ""
    let validationError: string | undefined
    let previousAttemptModel: string | undefined
    let previousAttemptHardFailure: string | undefined
    let previousAttemptStartupFailure = false
    let generationAttemptLimit = GENERATION_MAX_ATTEMPTS
    let currentAttempt = 0
    let currentAttemptStartedAt = generationStartedAt
    let currentAttemptRawPath = rawPath
    let currentAttemptTracePath = path.join(artifactDir, "generated.attempt-0.events.jsonl")
    let currentAttemptSessionID: string | undefined
    let currentStage: "diagnosis" | "explore" | "patch" = "patch"
    let currentStageArtifactPath = rawPath
    let currentStageTracePath = currentAttemptTracePath
    let lastProgressKind = "session_start"
    let lastProgressAt = generationStartedAt
    let partialChars = 0
    let lastProgressWriteAt = 0
    let lastProgressFingerprint = ""
    let progressWrite = Promise.resolve()
    let progressHeartbeat: ReturnType<typeof setInterval> | undefined
    const queueGeneratedProgressWrite = (snapshot?: Partial<GenerateProgress>) => {
      progressWrite = progressWrite
        .then(async () => {
          await writeGeneratedReport({
            proposalID: input.proposalID,
            reportPath,
            status: snapshot?.status ?? "running",
            sessionID: snapshot?.sessionID ?? currentAttemptSessionID,
            model,
            variant,
            selectedModel: snapshot?.selectedModel,
            routing: snapshot?.routing,
            effectiveModel: snapshot?.effectiveModel,
            agent: input.agent,
            rawPath: snapshot?.rawPath ?? currentStageArtifactPath ?? currentAttemptRawPath,
            tracePath: snapshot?.tracePath ?? currentStageTracePath ?? currentAttemptTracePath,
            patchPath: snapshot?.status === "completed" ? patchPath : undefined,
            attempts,
            patchValidation: snapshot?.status === "completed" ? patchValidation : undefined,
            patchScope: snapshot?.status === "completed" ? patchScope : undefined,
            generatedAt: snapshot?.status === "completed" ? Date.now() : undefined,
            currentStage,
            currentStageArtifactPath,
            currentAttempt,
            currentAttemptStartedAt,
            currentAttemptTracePath: currentStageTracePath ?? currentAttemptTracePath,
            lastProgressKind,
            lastProgressAt,
            partialChars: snapshot?.partialChars ?? partialChars,
            error: snapshot?.error,
          })
          if (input.onProgress) {
            await input.onProgress({
              proposalID: input.proposalID,
              status: snapshot?.status ?? "running",
              attempt: currentAttempt,
              startedAt: currentAttemptStartedAt,
              updatedAt: Date.now(),
              sessionID: snapshot?.sessionID ?? currentAttemptSessionID,
              requestedModel: model,
              selectedModel: snapshot?.selectedModel,
              effectiveModel: snapshot?.effectiveModel,
              rawPath: snapshot?.rawPath ?? currentStageArtifactPath ?? currentAttemptRawPath,
              tracePath: snapshot?.tracePath ?? currentStageTracePath ?? currentAttemptTracePath,
              partialChars: snapshot?.partialChars ?? partialChars,
              lastProgressKind,
              error: snapshot?.error,
              routing: snapshot?.routing,
            })
          }
        })
        .catch(() => {})
      return progressWrite
    }

    await queueGeneratedProgressWrite({
      status: "running",
      attempt: 0,
      startedAt: generationStartedAt,
      updatedAt: generationStartedAt,
      rawPath,
      lastProgressKind,
    })

    for (let attempt = 1; attempt <= generationAttemptLimit; attempt += 1) {
      currentAttempt = attempt
      currentAttemptStartedAt = Date.now()
      currentAttemptRawPath = path.join(artifactDir, `generated.attempt-${attempt}.response.txt`)
      currentAttemptTracePath = path.join(artifactDir, `generated.attempt-${attempt}.events.jsonl`)
      currentAttemptSessionID = undefined
      currentStage = "patch"
      currentStageArtifactPath = currentAttemptRawPath
      currentStageTracePath = currentAttemptTracePath
      lastProgressKind = "session_start"
      lastProgressAt = currentAttemptStartedAt
      partialChars = 0
      await Filesystem.write(currentAttemptRawPath, "")
      const attemptSourceFiles = pickAttemptSourceFiles({
        proposal,
        sourceFiles,
        attempt,
        previousRaw,
        validationError,
        previousAttemptHardFailure: !!previousAttemptHardFailure,
        previousAttemptStartupFailure,
      })
      const attemptAllowTools = allowTools || authorAttemptCanUseTools({ sourceFiles: attemptSourceFiles })
      const runExploreFirst = shouldRunExplorePass({
        proposal,
        attempt,
        sourceFiles: attemptSourceFiles,
        allowTools: attemptAllowTools,
        validationError,
        previousAttemptHardFailure: !!previousAttemptHardFailure,
        previousAttemptStartupFailure,
      })
      const validationArtifacts =
        attempt === 1 || !validationError
          ? []
          : await writeValidationContextArtifacts({
              artifactDir,
              validationError,
              sourceFiles: attemptSourceFiles,
            })
      const sourceFirstRetryArtifacts =
        attempt > 1 && shouldUseSourceFirstRetryArtifacts(validationError)
      const baseAttemptArtifacts = sourceFirstRetryArtifacts ? [] : baseArtifacts
      const exploreArtifacts = await resolveExisting([
        ...baseAttemptArtifacts,
        ...attemptSourceFiles,
        ...validationArtifacts,
      ])
      const attemptRawPath = path.join(artifactDir, `generated.attempt-${attempt}.response.txt`)
      const attemptTracePath = path.join(artifactDir, `generated.attempt-${attempt}.events.jsonl`)
      currentAttemptRawPath = attemptRawPath
      const requestedAttemptModel =
        attempt === 1
          ? model
          : input.model ?? (previousAttemptHardFailure ? "auto/quality" : previousAttemptModel ?? model)
      const preferRepairFallback = attempt > 1 && !input.model && !!previousAttemptHardFailure
      const attemptTimeoutMS = authorAttemptTimeoutMS({
        proposal,
        attempt,
        allowTools: attemptAllowTools,
        requestedTimeoutMS: input.timeoutMS,
      })
      const runFailureDiagnosis = shouldRunFailureDiagnosis({
        attempt,
        allowTools: attemptAllowTools,
        previousAttemptHardFailure: !!previousAttemptHardFailure,
        previousAttemptStartupFailure,
      })
      let diagnosisArtifactPath: string | undefined
      await queueGeneratedProgressWrite({
        status: "running",
      })
      if (progressHeartbeat) clearInterval(progressHeartbeat)
      progressHeartbeat = setInterval(() => {
        void queueGeneratedProgressWrite({
          status: "running",
        })
      }, GENERATION_PROGRESS_HEARTBEAT_MS)
      progressHeartbeat.unref?.()
      if (!runFailureDiagnosis && attempt > 1 && validationError && previousAttemptStartupFailure) {
        diagnosisArtifactPath = path.join(artifactDir, `generated.attempt-${attempt}.diagnosis.txt`)
        await Filesystem.write(
          diagnosisArtifactPath,
          startupDiagnosisText({
            proposal,
            sourceFiles: attemptSourceFiles,
            failureReason: validationError,
          }),
        )
      }
      if (runFailureDiagnosis && validationError) {
        try {
          const diagnosisArtifacts = await resolveExisting([
            ...baseAttemptArtifacts,
            ...attemptSourceFiles,
            ...attempts.slice(-2).map((item) => item.rawPath),
          ])
          const diagnosisResult = await runReadOnlyHarnessSession({
            title: `Harness patch diagnosis ${input.proposalID} (attempt ${attempt})`,
            prompt: failureDiagnosisPromptText({
              proposal,
              artifacts: diagnosisArtifacts,
              sourceFiles: attemptSourceFiles,
              failureReason: validationError,
            }),
            artifactFiles: diagnosisArtifacts,
            model: requestedAttemptModel,
            avoidModel: preferRepairFallback ? previousAttemptHardFailure : undefined,
            variant,
            lane: "author",
            stage: "research",
            agent: input.agent,
            permission: HarnessSessionRules.readOnly(),
            timeoutMS: Math.min(attemptTimeoutMS, 300_000),
            stallMS: undefined,
          })
          diagnosisArtifactPath = path.join(artifactDir, `generated.attempt-${attempt}.diagnosis.txt`)
          await Filesystem.write(diagnosisArtifactPath, diagnosisResult.raw)
        } catch (error) {
          if (error instanceof ScopeRefinementRequestedError) throw error
        }
      }
      let exploreArtifactPath: string | undefined
      let patchAttemptSourceFiles = attemptSourceFiles
      const patchStageAllowTools = attemptAllowTools
      if (runExploreFirst) {
        try {
          const exploreTimeoutMS = exploreAttemptTimeoutMS({
            proposal,
            requestedTimeoutMS: input.timeoutMS,
          })
          exploreArtifactPath = path.join(artifactDir, `generated.attempt-${attempt}.explore.txt`)
          const exploreTracePath = path.join(artifactDir, `generated.attempt-${attempt}.explore.events.jsonl`)
          currentStage = "explore"
          currentStageArtifactPath = exploreArtifactPath
          currentStageTracePath = exploreTracePath
          lastProgressKind = "session_start"
          lastProgressAt = Date.now()
          partialChars = 0
          await Filesystem.write(exploreArtifactPath, "")
          await queueGeneratedProgressWrite({
            status: "running",
            rawPath: exploreArtifactPath,
            tracePath: exploreTracePath,
            partialChars: 0,
          })
          const exploreResult = await runReadOnlyHarnessSession({
            title: `Harness patch exploration ${input.proposalID} (attempt ${attempt})`,
            prompt:
              validationError && shouldUseSourceFirstRetryArtifacts(validationError)
                ? staleContextExplorePromptText({
                    proposal,
                    artifacts: exploreArtifacts,
                    sourceFiles: attemptSourceFiles,
                    validationError,
                  })
                : explorePromptText({
                    proposal,
                    artifacts: exploreArtifacts,
                    sourceFiles: attemptSourceFiles,
                  }),
            artifactFiles: exploreArtifacts,
            model: requestedAttemptModel,
            avoidModel: preferRepairFallback ? previousAttemptHardFailure : undefined,
            variant,
            lane: "author",
            stage: "explore",
            agent: input.agent,
            tracePath: exploreTracePath,
            permission: HarnessSessionRules.readOnly(),
            timeoutMS: exploreTimeoutMS,
            stallMS: undefined,
            startupStallMS: exploreAttemptStartupStallMS(exploreTimeoutMS),
            onProgress(progress: HarnessSessionProgress) {
              currentAttemptSessionID = progress.sessionID ?? currentAttemptSessionID
              lastProgressKind = progress.kind
              lastProgressAt = progress.timestamp
              const nextPartialChars = progress.partialChars ?? progress.reasoningChars ?? partialChars
              const nextRaw = progress.partialRaw ?? progress.reasoningRaw
              const fingerprint = `explore:${progress.kind}:${nextPartialChars}`
              const now = Date.now()
              if (nextRaw !== undefined) {
                partialChars = nextPartialChars
                void Filesystem.write(exploreArtifactPath!, nextRaw).catch(() => {})
              }
              if (
                fingerprint === lastProgressFingerprint &&
                now - lastProgressWriteAt < 5_000 &&
                progress.kind !== "session_completed" &&
                progress.kind !== "session_error"
              ) {
                return
              }
              lastProgressFingerprint = fingerprint
              lastProgressWriteAt = now
              void queueGeneratedProgressWrite({
                status: "running",
                sessionID: progress.sessionID,
                selectedModel: progress.selectedModel,
                effectiveModel: progress.resolvedModel,
                rawPath: exploreArtifactPath,
                tracePath: exploreTracePath,
                partialChars: nextPartialChars,
              })
            },
          })
          await Filesystem.write(exploreArtifactPath, exploreResult.raw)
          const scopeTransition = detectExploreScopeTransition({
            proposal,
            exploreRaw: exploreResult.raw,
            sourceFiles,
          })
          const unexpectedExploreFiles = scopeTransition.unexpectedFiles
          if (unexpectedExploreFiles.length > 0) {
            if (progressHeartbeat) {
              clearInterval(progressHeartbeat)
              progressHeartbeat = undefined
            }
            lastProgressKind = "scope_refinement_requested"
            lastProgressAt = Date.now()
            partialChars = exploreResult.raw.length
            await queueGeneratedProgressWrite({
              status: "failed",
              sessionID: exploreResult.sessionID,
              selectedModel: exploreResult.selectedModel,
              effectiveModel: exploreResult.resolvedModel,
              rawPath: exploreArtifactPath,
              tracePath: exploreTracePath,
              partialChars,
              error: `Explore requested scope refinement: ${unexpectedExploreFiles.join(", ")}`,
            })
            await requestScopeRefinement({
              proposalID: input.proposalID,
              proposal,
              discoveredFiles: unexpectedExploreFiles,
              explore: scopeTransition.explore,
            })
          }
          patchAttemptSourceFiles = scopeTransition.patchSourceFiles
          partialChars = exploreResult.raw.length
          await queueGeneratedProgressWrite({
            status: "running",
            sessionID: exploreResult.sessionID,
            selectedModel: exploreResult.selectedModel,
            effectiveModel: exploreResult.resolvedModel,
            rawPath: exploreArtifactPath,
            tracePath: exploreTracePath,
            partialChars,
          })
          currentStage = "patch"
          currentStageArtifactPath = currentAttemptRawPath
          currentStageTracePath = currentAttemptTracePath
          lastProgressKind = "session_start"
          lastProgressAt = Date.now()
          partialChars = 0
          await queueGeneratedProgressWrite({
            status: "running",
            rawPath: currentAttemptRawPath,
            tracePath: currentAttemptTracePath,
            partialChars: 0,
          })
        } catch (error) {
          if (error instanceof ScopeRefinementRequestedError) throw error
        }
      }
      const includeSourceSnapshots =
        runExploreFirst || !patchStageAllowTools || validationArtifacts.length > 0 || previousAttemptStartupFailure
      const snapshotArtifacts = includeSourceSnapshots
        ? await writeSourceSnapshotArtifacts({
            artifactDir,
            sourceFiles: patchAttemptSourceFiles,
            label: `generated.attempt-${attempt}`,
          })
        : []
      const attemptArtifacts = await resolveExisting([
        ...baseAttemptArtifacts,
        ...snapshotArtifacts,
        ...(diagnosisArtifactPath ? [diagnosisArtifactPath] : []),
        ...(exploreArtifactPath ? [exploreArtifactPath] : []),
        ...validationArtifacts,
      ])
      try {
        result = await runReadOnlyHarnessSession({
          title: `Harness patch ${input.proposalID} (attempt ${attempt})`,
          prompt:
            attempt === 1
              ? generatePromptText({
                  proposal,
                  artifacts: attemptArtifacts,
                  sourceFiles: patchAttemptSourceFiles,
                  allowTools: patchStageAllowTools,
                })
              : repairPromptText({
                  proposal,
                  artifacts: attemptArtifacts,
                  sourceFiles: patchAttemptSourceFiles,
                  previousRaw,
                  validationError: validationError ?? "Unknown validation failure.",
                  allowTools: patchStageAllowTools,
                  validationArtifacts,
                }),
          artifactFiles: attemptArtifacts,
          model: requestedAttemptModel,
          avoidModel: preferRepairFallback ? previousAttemptHardFailure : undefined,
          variant,
          lane: "author",
          stage: "patch",
          agent: input.agent,
          tracePath: attemptTracePath,
          permission: HarnessSessionRules.readOnly(),
          timeoutMS: attemptTimeoutMS,
          stallMS: undefined,
          startupStallMS: patchAttemptStartupStallMS(attemptTimeoutMS),
            onProgress(progress: HarnessSessionProgress) {
              currentAttemptSessionID = progress.sessionID ?? currentAttemptSessionID
              lastProgressKind = progress.kind
              lastProgressAt = progress.timestamp
              const nextPartialChars = progress.partialChars ?? progress.reasoningChars ?? partialChars
              const nextRaw = progress.partialRaw ?? progress.reasoningRaw
              const fingerprint = `${progress.kind}:${nextPartialChars}`
              const now = Date.now()
              if (nextRaw !== undefined) {
                partialChars = nextPartialChars
                void Filesystem.write(attemptRawPath, nextRaw).catch(() => {})
              }
            if (
              fingerprint === lastProgressFingerprint &&
              now - lastProgressWriteAt < 5_000 &&
              progress.kind !== "session_completed" &&
              progress.kind !== "session_error"
            ) {
              return
            }
            lastProgressFingerprint = fingerprint
            lastProgressWriteAt = now
            void queueGeneratedProgressWrite({
              status: "running",
              sessionID: progress.sessionID,
              selectedModel: progress.selectedModel,
              effectiveModel: progress.resolvedModel,
              partialChars: nextPartialChars,
            })
          },
        })
      } catch (error) {
        if (progressHeartbeat) {
          clearInterval(progressHeartbeat)
          progressHeartbeat = undefined
        }

        // Convert to structured error
        const structuredError = error instanceof HarnessError
          ? error
          : classifyError(error, {
              lane: "author",
              model: requestedAttemptModel,
              attempt,
              proposalID: input.proposalID,
            })

        const failureReason = trimValidationMessage(structuredError.message)
        const sessionStartFailure =
          isSessionStartFailure(structuredError.message) ||
          (isSessionError(structuredError) && structuredError.isStartupFailure())
        const hardFailureModel = failedHarnessModel(failureReason)
        validationError = `Harness author session failed before returning a patch: ${failureReason}`
        await Filesystem.write(attemptRawPath, `SESSION ERROR: ${validationError}\n`)
        previousAttemptHardFailure = hardFailureModel ?? requestedAttemptModel
        previousAttemptStartupFailure = sessionStartFailure

        // Circuit breaker tracking
        if (requestedAttemptModel) {
          CircuitBreakerRegistry.get("author", requestedAttemptModel).recordFailure(structuredError)
        }

        if (
          sessionStartFailure &&
          generationAttemptLimit < GENERATION_MAX_ATTEMPTS + GENERATION_MAX_STARTUP_RECOVERY_ATTEMPTS
        ) {
          generationAttemptLimit += 1
        }

        await recordHarnessModelOutcome({
          lane: "author",
          model: requestedAttemptModel,
          success: false,
          repair: attempt > 1,
        })
        attempts.push({
          attempt,
          sessionID: "",
          rawPath: attemptRawPath,
          tracePath: attemptTracePath,
          validationError,
        })
        previousRaw = ""
        await HarnessState.appendObservation({
          source: "analyzer",
          kind: "patch.generation_retry",
          message: `Generated patch attempt ${attempt} for proposal ${input.proposalID} was invalid and needs repair.`,
          data: {
            proposalID: input.proposalID,
            attempt,
            model: requestedAttemptModel,
            validationError,
            sessionStartFailure,
          },
        })
        await queueGeneratedProgressWrite({
          status: "failed",
          error: validationError,
          partialChars,
        })
        if (attempt === generationAttemptLimit) {
          throw new Error(`Generated patch failed validation after ${attempt} attempt(s): ${validationError}`)
        }
        continue
      }
      await Filesystem.write(attemptRawPath, result.raw)
      if (progressHeartbeat) {
        clearInterval(progressHeartbeat)
        progressHeartbeat = undefined
      }
      previousAttemptModel = resolvedHarnessModel(result) ?? previousAttemptModel
      previousAttemptHardFailure = undefined
      previousAttemptStartupFailure = false

      try {
        patchText = extractPatchText(result.raw)
        patchValidation = await validateGeneratedPatch(patchText)
        patchText = patchValidation.patchText
        patchScope = HarnessPolicy.validatePatchAgainstProposal(proposal, patchText)
        HarnessPolicy.validatePatchStrategy(proposal, patchText)
        attempts.push({
          attempt,
          sessionID: result.sessionID,
          rawPath: attemptRawPath,
          tracePath: attemptTracePath,
        })
        break
      } catch (error) {
        const structuredError = error instanceof HarnessError
          ? error
          : new ValidationError(error instanceof Error ? error.message : String(error), {
              lane: "author",
              model: resolvedHarnessModel(result) ?? requestedAttemptModel,
              proposalID: input.proposalID,
              patchText: result.raw,
            })

        validationError = normalizedGenerationValidationError(result.raw, structuredError.message)

        // Circuit breaker tracking for validation errors
        const modelRef = resolvedHarnessModel(result) ?? requestedAttemptModel
        if (modelRef) {
          CircuitBreakerRegistry.get("author", modelRef).recordFailure(structuredError)
        }

        await recordHarnessModelOutcome({
          lane: "author",
          model: resolvedHarnessModel(result),
          success: false,
          repair: true,
        })
        attempts.push({
          attempt,
          sessionID: result.sessionID,
          rawPath: attemptRawPath,
          tracePath: attemptTracePath,
          validationError,
        })
        previousRaw = result.raw
        previousAttemptStartupFailure = false
        await HarnessState.appendObservation({
          source: "analyzer",
          kind: "patch.generation_retry",
          message: `Generated patch attempt ${attempt} for proposal ${input.proposalID} was invalid and needs repair.`,
          data: {
            proposalID: input.proposalID,
            attempt,
            sessionID: result.sessionID,
            model,
            validationError,
          },
        })
        await queueGeneratedProgressWrite({
          status: "running",
          sessionID: result.sessionID,
          selectedModel: result.selectedModel,
          effectiveModel: resolvedHarnessModel(result),
          routing: result.routing,
          partialChars: result.raw.length,
        })
        if (attempt === generationAttemptLimit) {
          throw new Error(`Generated patch failed validation after ${attempt} attempt(s): ${validationError}`)
        }
      }
    }

    if (!result || !patchValidation) {
      if (progressHeartbeat) clearInterval(progressHeartbeat)
      throw new Error(`Failed to generate a valid patch for proposal ${input.proposalID}.`)
    }
    await recordHarnessModelOutcome({
      lane: "author",
      model: resolvedHarnessModel(result),
      success: true,
    })

    await Filesystem.write(rawPath, result.raw)
    await Filesystem.write(patchPath, patchText)
    await queueGeneratedProgressWrite({
      status: "completed",
      sessionID: result.sessionID,
      selectedModel: result.selectedModel,
      effectiveModel: resolvedHarnessModel(result),
      routing: result.routing,
      rawPath,
      partialChars: result.raw.length,
    })

    await HarnessState.updateProposal(input.proposalID, (current) => ({
      ...current,
      reviewArtifacts: appendUnique(
        current.reviewArtifacts,
        [rawPath, patchPath, reportPath, ...attempts.flatMap((attempt) => [attempt.rawPath, attempt.tracePath].filter(Boolean) as string[])],
      ),
    }))

    await HarnessState.appendObservation({
      source: "analyzer",
      kind: "patch.generated",
      message: `Generated patch for proposal ${input.proposalID}.`,
      data: {
        proposalID: input.proposalID,
        sessionID: result.sessionID,
        model: resolvedHarnessModel(result),
        patchPath,
        patchValidation,
        patchScope,
        attempts: attempts.length,
      },
    })
    return {
      proposalID: input.proposalID,
      sessionID: result.sessionID,
      model,
      variant,
      selectedModel: result.selectedModel,
      routing: result.routing,
      effectiveModel: resolvedHarnessModel(result),
      agent: input.agent,
      rawPath,
      patchPath,
      reportPath,
      patchText,
      attempts,
      patchValidation,
      patchScope,
    }
  }

  export async function review(input: ReviewInput) {
    const { proposal, artifactDir, proposalPath } = await ensureMaterializedArtifacts(input.proposalID)
    const patchPath = generatedPatchPath(input.proposalID)
    const generationRawPath = generatedResponsePath(input.proposalID)
    const rawPath = path.join(artifactDir, "adversarial.review.txt")
    const reportPath = path.join(artifactDir, "adversarial.review.json")
    const reviewModel = input.model ?? "auto/quality"
    const reviewAgent = input.agent ?? "build"

    const patchText = input.patchText ?? (await Filesystem.readText(patchPath).catch(() => ""))
    if (!patchText.trim()) {
      throw new Error(
        `No generated patch found for proposal ${input.proposalID}. Run debug harness generate first or pass patch text explicitly.`,
      )
    }

    Patch.parsePatch(patchText)
    await Filesystem.write(patchPath, patchText)

    const reviewArtifacts = await resolveExisting([proposalPath, patchPath, generationRawPath])
    const reviewPrompt = reviewPromptText({
      proposal,
      artifacts: reviewArtifacts,
      authorModel: input.authorModel,
      patchPath,
    })
    let reviewMode: ReviewMode = "structured"
    let fallbackReason: string | undefined

    let result:
      | Awaited<ReturnType<typeof runReadOnlyHarnessSession>>
      | undefined
    let decision: ReviewDecision
    let effectiveReviewModel: string | undefined
    let patchScope: ReturnType<typeof HarnessPolicy.validatePatchAgainstProposal> | undefined

    try {
      result = await runReadOnlyHarnessSession({
        title: `Harness review ${input.proposalID}`,
        prompt: reviewPrompt,
        artifactFiles: reviewArtifacts,
        model: reviewModel,
        lane: "reviewer",
        avoidModel: input.authorModel,
        agent: reviewAgent,
        permission: HarnessSessionRules.readOnly(),
        format: reviewResponseFormat(),
        timeoutMS: reviewAttemptTimeoutMS({
          proposal,
          requestedTimeoutMS: input.timeoutMS,
        }),
      })
      effectiveReviewModel = resolvedHarnessModel(result) ?? reviewModel
      decision = parseReviewDecision(result.raw)
      const strategicConcerns = HarnessPolicy.strategicPatchConcerns(proposal, patchText)
      if (strategicConcerns.length > 0) {
        decision = normalizeReviewDecision({
          verdict: "reject",
          summary: "Rejected a patch that retreats harness autonomy instead of improving execution.",
          concerns: appendUnique(decision.concerns, strategicConcerns),
          requiredChanges: appendUnique(decision.requiredChanges, [
            "Keep large upgrades autonomous and tighten routing, decomposition, or verification instead of forcing them back to staged-only handling.",
          ]),
          verifyCommands: decision.verifyCommands,
        })
      }
      await recordHarnessModelOutcome({
        lane: "reviewer",
        model: effectiveReviewModel,
        success: true,
        fallback: false,
      })
      await Filesystem.write(rawPath, result.raw)
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : String(error)
      const fastDeterministic = buildDeterministicReviewDecision({
        proposal,
        patchText,
        failureReason: fallbackReason,
        reviewAttempts: 1,
      })
      if (/timed out/i.test(fallbackReason) && fastDeterministic.decision.verdict === "approve") {
        reviewMode = "deterministic_fallback"
        decision = fastDeterministic.decision
        patchScope = fastDeterministic.patchScope
        effectiveReviewModel = undefined
        await Filesystem.write(
          rawPath,
          buildDeterministicReviewText({
            decision,
            failureReason: fallbackReason,
            patchScope,
          }),
        )
      } else {
      reviewMode = "text_fallback"
      await HarnessState.appendObservation({
        source: "analyzer",
        kind: "review.fallback",
        message: `Structured adversarial review fell back to plain JSON for proposal ${input.proposalID}.`,
        data: {
          proposalID: input.proposalID,
          model: reviewModel,
          reason: fallbackReason,
        },
      })

      try {
        result = await runReadOnlyHarnessSession({
          title: `Harness review ${input.proposalID} (fallback)`,
          prompt: reviewPrompt,
          artifactFiles: reviewArtifacts,
          model: reviewModel,
          lane: "reviewer",
          avoidModel: input.authorModel,
          agent: reviewAgent,
          permission: HarnessSessionRules.readOnly(),
          timeoutMS: reviewAttemptTimeoutMS({
            proposal,
            requestedTimeoutMS: input.timeoutMS,
          }),
        })
        effectiveReviewModel = resolvedHarnessModel(result) ?? reviewModel
        decision = parseReviewDecision(result.raw)
        const strategicConcerns = HarnessPolicy.strategicPatchConcerns(proposal, patchText)
        if (strategicConcerns.length > 0) {
          decision = normalizeReviewDecision({
            verdict: "reject",
            summary: "Rejected a patch that retreats harness autonomy instead of improving execution.",
            concerns: appendUnique(decision.concerns, strategicConcerns),
            requiredChanges: appendUnique(decision.requiredChanges, [
              "Keep large upgrades autonomous and tighten routing, decomposition, or verification instead of forcing them back to staged-only handling.",
            ]),
            verifyCommands: decision.verifyCommands,
          })
        }
        await recordHarnessModelOutcome({
          lane: "reviewer",
          model: effectiveReviewModel,
          success: true,
          fallback: true,
        })
        await Filesystem.write(rawPath, result.raw)
      } catch (fallbackError) {
        const failureReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          const deterministic = buildDeterministicReviewDecision({
            proposal,
            patchText,
            failureReason,
            reviewAttempts: 2,
          })
          reviewMode = "deterministic_fallback"
          fallbackReason = failureReason
          decision = deterministic.decision
          patchScope = deterministic.patchScope
        effectiveReviewModel = undefined
        await Filesystem.write(
          rawPath,
          buildDeterministicReviewText({
            decision,
            failureReason,
            patchScope,
          }),
        )
      }
      }
    }

    await Filesystem.writeJson(reportPath, {
      proposalID: input.proposalID,
      sessionID: result?.sessionID,
      model: reviewModel,
      selectedModel: result?.selectedModel,
      routing: result?.routing,
      effectiveModel: effectiveReviewModel,
      agent: reviewAgent,
      reviewedAt: Date.now(),
      reviewMode,
      fallbackReason,
      decision,
      patchPath,
      rawPath,
      patchScope,
    })

    await HarnessState.updateProposal(input.proposalID, (current) => ({
      ...current,
      reviewArtifacts: appendUnique(current.reviewArtifacts, [patchPath, rawPath, reportPath]),
      reviewVerdict: decision.verdict,
      reviewSummary: decision.summary,
      reviewedAt: Date.now(),
    }))

    await HarnessState.appendObservation({
      source: "analyzer",
      kind: "review.completed",
      message: `Completed adversarial review for proposal ${input.proposalID} with verdict ${decision.verdict}.`,
      data: {
        proposalID: input.proposalID,
        sessionID: result?.sessionID,
        model: effectiveReviewModel,
        reviewMode,
        verdict: decision.verdict,
      },
    })

    return {
      proposalID: input.proposalID,
      sessionID: result?.sessionID,
      model: reviewModel,
      selectedModel: result?.selectedModel,
      routing: result?.routing,
      effectiveModel: effectiveReviewModel,
      agent: reviewAgent,
      rawPath,
      reportPath,
      patchPath,
      decision,
      reviewMode,
    }
  }

  async function loadExistingGeneration(proposalID: string): Promise<Awaited<ReturnType<typeof generate>> | undefined> {
    const reportPath = generatedReportPath(proposalID)
    const patchPath = generatedPatchPath(proposalID)
    const rawPath = generatedResponsePath(proposalID)
    const reportPromise: Promise<unknown> = Bun.file(reportPath).json().catch(() => undefined)
    const [rawReport, patchText] = await Promise.all([
      reportPromise,
      Filesystem.readText(patchPath).catch(() => ""),
    ])
    const report = readGeneratedReport(rawReport)
    if (!report || report.status === "running" || report.status === "failed" || !patchText.trim()) return undefined
    if (
      !report.sessionID ||
      !report.model ||
      !report.selectedModel ||
      !report.routing ||
      !report.effectiveModel ||
      !report.agent ||
      !report.patchValidation
    ) {
      return undefined
    }
    const proposal = await ensureCodePatchProposal(proposalID)
    const patchScope = HarnessPolicy.validatePatchAgainstProposal(proposal, patchText)
    return {
      proposalID,
      sessionID: report.sessionID,
      model: report.model,
      variant: report.variant,
      selectedModel: report.selectedModel,
      routing: report.routing,
      effectiveModel: report.effectiveModel,
      agent: report.agent,
      rawPath,
      patchPath,
      reportPath,
      patchText,
      attempts: report.attempts ?? [],
      patchValidation: report.patchValidation,
      patchScope,
    }
  }

  async function loadExistingReview(proposalID: string): Promise<Awaited<ReturnType<typeof review>> | undefined> {
    const reportPath = reviewReportPath(proposalID)
    const rawPath = path.join(reviewDirectory(proposalID), "adversarial.review.txt")
    const rawReport: unknown = await Bun.file(reportPath).json().catch(() => undefined)
    const report = readReviewReport(rawReport)
    if (!report?.decision) return undefined
    if (!report.sessionID || !report.model || !report.selectedModel || !report.routing || !report.effectiveModel || !report.agent) {
      return undefined
    }
    return {
      proposalID,
      sessionID: report.sessionID,
      model: report.model,
      selectedModel: report.selectedModel,
      routing: report.routing,
      effectiveModel: report.effectiveModel,
      agent: report.agent,
      rawPath,
      reportPath,
      patchPath: report.patchPath ?? generatedPatchPath(proposalID),
      decision: normalizeReviewDecision(report.decision),
      reviewMode: report.reviewMode ?? "structured",
    }
  }

  async function revisePatchAfterReview(input: ReviewRepairInput) {
    const { proposal, artifactDir, proposalPath } = await ensureMaterializedArtifacts(input.proposalID)
    const patchPath = generatedPatchPath(input.proposalID)
    const generationRawPath = generatedResponsePath(input.proposalID)
    const reviewRawPath = path.join(artifactDir, "adversarial.review.txt")
    const reviewReport = reviewReportPath(input.proposalID)
    const sourceFiles = await sourceArtifacts({
      proposal,
      proposalPath,
    })
    const snapshotArtifacts = await writeSourceSnapshotArtifacts({
      artifactDir,
      sourceFiles,
      label: "review-repair",
    })
    const artifactFiles = await resolveExisting([
      proposalPath,
      patchPath,
      generationRawPath,
      reviewRawPath,
      reviewReport,
      ...snapshotArtifacts,
    ])
    const rawPath = path.join(artifactDir, "generated.review-repair.response.txt")
    const requestedModel = input.model ?? "auto/quality"
    const authorAgent = input.agent ?? "build"
    const allowTools = authorAttemptCanUseTools({ sourceFiles })
    let result:
      | Awaited<ReturnType<typeof runReadOnlyHarnessSession>>
      | undefined
    let effectiveModel: string | undefined

    try {
      result = await runReadOnlyHarnessSession({
        title: `Harness review repair ${input.proposalID}`,
        prompt: reviewRepairPromptText({
          proposal,
          artifacts: artifactFiles,
          sourceFiles,
          patchText: input.patchText,
          decision: input.decision,
          reviewModel: input.reviewModel,
          healerNotes: input.healerNotes,
          healerSummary: input.healerSummary,
        }),
        artifactFiles,
        model: requestedModel,
        lane: "author",
        permission: HarnessSessionRules.readOnly(),
        agent: authorAgent,
        stage: "patch",
        timeoutMS: authorAttemptTimeoutMS({
          proposal,
          attempt: 2,
          allowTools,
          requestedTimeoutMS: input.timeoutMS,
        }),
      })
      effectiveModel = resolvedHarnessModel(result) ?? requestedModel
      const patchText = extractPatchText(result.raw)
      const patchValidation = await validateGeneratedPatch(patchText)
      const patchScope = HarnessPolicy.validatePatchAgainstProposal(proposal, patchValidation.patchText)
      HarnessPolicy.validatePatchStrategy(proposal, patchValidation.patchText)
      await Filesystem.write(rawPath, result.raw)
      await Filesystem.write(patchPath, patchValidation.patchText)
      await recordHarnessModelOutcome({
        lane: "author",
        model: effectiveModel,
        success: true,
        repair: true,
      })
      return {
        sessionID: result.sessionID,
        model: requestedModel,
        selectedModel: result.selectedModel,
        routing: result.routing,
        effectiveModel,
        agent: authorAgent,
        rawPath,
        patchPath,
        patchText: patchValidation.patchText,
        patchValidation,
        patchScope,
      }
    } catch (error) {
      await recordHarnessModelOutcome({
        lane: "author",
        model: effectiveModel ?? requestedModel,
        success: false,
        repair: true,
      })
      throw error
    }
  }

  export async function autopatch(input: AutopatchInput) {
    const startedAt = Date.now()
    const proposal = await ensureCodePatchProposal(input.proposalID)
    
    // Prevent concurrent autopatch executions for the same proposal
    using _lock = await acquireFileLock(`autopatch:${input.proposalID}`, { timeoutMS: 10_000 })
    
    const reportPath = autopatchReportPath(input.proposalID)
    const stages: AutopatchStageReport[] = [
      { stage: "generate", status: "pending" },
      { stage: "review", status: "pending" },
      { stage: "execute", status: "pending" },
    ]

    const updateStage = async (
      stage: AutopatchStageName,
      patch: Partial<AutopatchStageReport>,
      extra?: {
        status?: "running" | "completed" | "failed"
        generation?: Record<string, unknown>
        review?: Record<string, unknown>
        verifyPlan?: Record<string, unknown>
        execution?: Record<string, unknown>
        error?: string
      },
    ) => {
      const current = stages.find((item) => item.stage === stage)
      if (!current) throw new Error(`Unknown autopatch stage: ${stage}`)
      Object.assign(current, patch)
      await writeAutopatchReport({
        proposalID: input.proposalID,
        reportPath,
        startedAt,
        stages,
        status: extra?.status ?? "running",
        generation: extra?.generation,
        review: extra?.review,
        verifyPlan: extra?.verifyPlan,
        execution: extra?.execution,
        error: extra?.error,
      })
    }

    let generation:
      | Awaited<ReturnType<typeof generate>>
      | undefined
    let reviewResult:
      | Awaited<ReturnType<typeof review>>
      | undefined
    let verifyPlan:
      | ReturnType<typeof buildVerifyPlan>
      | undefined
    let execution:
      | Awaited<ReturnType<typeof HarnessSelfEdit.execute>>
      | undefined

    await writeAutopatchReport({
      proposalID: input.proposalID,
      reportPath,
      startedAt,
      stages,
      status: "running",
    })

    try {
      const reusedGeneration =
        (input.reuseValidatedArtifacts ?? (input.applyLive ?? true)) ? await loadExistingGeneration(input.proposalID) : undefined
      if (reusedGeneration) {
        generation = reusedGeneration
        await updateStage(
          "generate",
          {
            status: "completed",
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMS: 0,
            sessionID: generation.sessionID,
            reportPath: generation.reportPath,
            patchPath: generation.patchPath,
            note: "Reused an existing validated generated patch.",
          },
          {
            generation: {
              sessionID: generation.sessionID,
              model: generation.model,
              effectiveModel: generation.effectiveModel,
              agent: generation.agent,
              rawPath: generation.rawPath,
              patchPath: generation.patchPath,
              reportPath: generation.reportPath,
              attempts: generation.attempts,
              patchValidation: generation.patchValidation,
            },
          },
        )
      } else {
        const generateStartedAt = Date.now()
        await updateStage("generate", {
          status: "running",
          startedAt: generateStartedAt,
          note: "Generating candidate self-edit patch.",
        })
        generation = await generate({
          proposalID: input.proposalID,
          model: input.generateModel,
          variant: input.generateVariant,
          agent: input.generateAgent,
          timeoutMS: input.generateTimeoutMS,
          onProgress: async (progress) => {
            await updateStage(
              "generate",
              {
                status: "running",
                sessionID: progress.sessionID,
                reportPath: generatedReportPath(input.proposalID),
                patchPath: progress.status === "completed" ? generatedPatchPath(input.proposalID) : undefined,
                note:
                  progress.status === "failed"
                    ? `Generate attempt ${progress.attempt} failed after ${progress.lastProgressKind ?? "unknown progress"}.`
                    : `Generate attempt ${progress.attempt} active. Last progress: ${progress.lastProgressKind ?? "session_start"}${progress.partialChars ? ` (${progress.partialChars} chars captured)` : ""}.`,
              },
              {
                generation: {
                  sessionID: progress.sessionID,
                  model: progress.requestedModel,
                  effectiveModel: progress.effectiveModel,
                  rawPath: progress.rawPath,
                  reportPath: generatedReportPath(input.proposalID),
                  attempt: progress.attempt,
                  lastProgressKind: progress.lastProgressKind,
                  partialChars: progress.partialChars,
                  error: progress.error,
                },
              },
            )
          },
        })
        await updateStage(
          "generate",
          {
            status: "completed",
            endedAt: Date.now(),
            durationMS: Date.now() - generateStartedAt,
            sessionID: generation.sessionID,
            reportPath: generation.reportPath,
            patchPath: generation.patchPath,
            note: `Generated a validated patch in ${generation.attempts.length} attempt(s).`,
          },
          {
            generation: {
              sessionID: generation.sessionID,
              model: generation.model,
              effectiveModel: generation.effectiveModel,
              agent: generation.agent,
              rawPath: generation.rawPath,
              patchPath: generation.patchPath,
              reportPath: generation.reportPath,
              attempts: generation.attempts,
              patchValidation: generation.patchValidation,
            },
          },
        )
      }

      const reusedReview =
        (input.reuseValidatedArtifacts ?? (input.applyLive ?? true)) ? await loadExistingReview(input.proposalID) : undefined
      if (reusedReview && reusedReview.decision.verdict === "approve") {
        reviewResult = reusedReview
        await updateStage(
          "review",
          {
            status: "completed",
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMS: 0,
            sessionID: reviewResult.sessionID,
            reportPath: reviewResult.reportPath,
            patchPath: reviewResult.patchPath,
            note: `Reused existing review verdict: ${reviewResult.decision.verdict}.`,
          },
          {
            generation: {
              sessionID: generation.sessionID,
              model: generation.model,
              effectiveModel: generation.effectiveModel,
              agent: generation.agent,
              rawPath: generation.rawPath,
              patchPath: generation.patchPath,
              reportPath: generation.reportPath,
              attempts: generation.attempts,
              patchValidation: generation.patchValidation,
            },
            review: {
              sessionID: reviewResult.sessionID,
              model: reviewResult.model,
              effectiveModel: reviewResult.effectiveModel,
              agent: reviewResult.agent,
              rawPath: reviewResult.rawPath,
              reportPath: reviewResult.reportPath,
              decision: reviewResult.decision,
              reviewMode: reviewResult.reviewMode,
            },
          },
        )
      } else {
        const reviewStartedAt = Date.now()
        await updateStage(
          "review",
          {
            status: "running",
            startedAt: reviewStartedAt,
            patchPath: generation.patchPath,
            note: "Running adversarial review over the generated patch.",
          },
          {
            generation: {
              sessionID: generation.sessionID,
              model: generation.model,
              effectiveModel: generation.effectiveModel,
              agent: generation.agent,
              rawPath: generation.rawPath,
              patchPath: generation.patchPath,
              reportPath: generation.reportPath,
              attempts: generation.attempts,
              patchValidation: generation.patchValidation,
            },
          },
        )
        reviewResult = await review({
          proposalID: input.proposalID,
          patchText: generation.patchText,
          model: input.reviewModel,
          agent: input.reviewAgent,
          authorModel: generation.effectiveModel ?? generation.model,
          timeoutMS: input.reviewTimeoutMS,
        })
        await updateStage(
          "review",
          {
            status: "completed",
            endedAt: Date.now(),
            durationMS: Date.now() - reviewStartedAt,
            sessionID: reviewResult.sessionID,
            reportPath: reviewResult.reportPath,
            patchPath: reviewResult.patchPath,
            note: `Review verdict: ${reviewResult.decision.verdict}.`,
          },
          {
            generation: {
              sessionID: generation.sessionID,
              model: generation.model,
              effectiveModel: generation.effectiveModel,
              agent: generation.agent,
              rawPath: generation.rawPath,
              patchPath: generation.patchPath,
              reportPath: generation.reportPath,
              attempts: generation.attempts,
              patchValidation: generation.patchValidation,
            },
            review: {
              sessionID: reviewResult.sessionID,
              model: reviewResult.model,
              effectiveModel: reviewResult.effectiveModel,
              agent: reviewResult.agent,
              rawPath: reviewResult.rawPath,
              reportPath: reviewResult.reportPath,
              decision: reviewResult.decision,
              reviewMode: reviewResult.reviewMode,
            },
          },
        )
      }

      if (!input.allowReviewNonApprove && reviewResult.decision.verdict !== "approve") {
        throw new Error(`Adversarial review returned ${reviewResult.decision.verdict}. Refusing to apply self-edit without explicit override.`)
      }
      if ((input.applyLive ?? true) && reviewResult.reviewMode === "deterministic_fallback") {
        const currentProposal = await ensureCodePatchProposal(input.proposalID)
        const previouslyValidated =
          !!currentProposal.fingerprint && currentProposal.validatedFingerprint === currentProposal.fingerprint
        if (!previouslyValidated) {
          throw new Error(
            "Deterministic fallback review cannot authorize first-time live self-apply. Re-run in validate-only mode or obtain a model review verdict.",
          )
        }
      }

      const verifyPlanPath = proposalVerifyPlanPath(input.proposalID)
      verifyPlan = buildVerifyPlan({
        proposalID: input.proposalID,
        patchText: generation.patchText,
        patchPath: generation.patchPath,
        reviewReportPath: reviewResult.reportPath,
        explicitCommands: input.verifyCommands,
        reviewCommands: reviewResult.decision.verifyCommands,
        risk: generation.patchScope?.risk ?? (await ensureCodePatchProposal(input.proposalID)).risk,
      })
      await writeVerifyPlan(verifyPlanPath, verifyPlan)
      await HarnessState.updateProposal(input.proposalID, (current) => ({
        ...current,
        reviewArtifacts: appendUnique(current.reviewArtifacts, [verifyPlanPath]),
      }))

      const executeStartedAt = Date.now()
      await updateStage(
        "execute",
        {
          status: "running",
          startedAt: executeStartedAt,
          patchPath: generation.patchPath,
          note: "Executing patch through the shadow/live self-edit path.",
        },
        {
          generation: {
            sessionID: generation.sessionID,
            model: generation.model,
            effectiveModel: generation.effectiveModel,
            agent: generation.agent,
            rawPath: generation.rawPath,
            patchPath: generation.patchPath,
            reportPath: generation.reportPath,
            attempts: generation.attempts,
            patchValidation: generation.patchValidation,
          },
          review: {
            sessionID: reviewResult.sessionID,
            model: reviewResult.model,
            effectiveModel: reviewResult.effectiveModel,
            agent: reviewResult.agent,
            rawPath: reviewResult.rawPath,
            reportPath: reviewResult.reportPath,
            decision: reviewResult.decision,
            reviewMode: reviewResult.reviewMode,
          },
          verifyPlan: verifyPlan
            ? {
                path: proposalVerifyPlanPath(input.proposalID),
                ...verifyPlan,
              }
            : undefined,
        },
      )
      execution = await HarnessSelfEdit.execute({
        proposalID: input.proposalID,
        patchText: generation.patchText,
        verifyPlan,
        verifyCommands: verifyPlan?.commands ?? [],
        applyLive: input.applyLive ?? true,
        allowUnverifiedLive: input.allowUnverifiedLive,
        verifyCommandTimeoutMS: input.verifyCommandTimeoutMS,
      })
      await updateStage(
        "execute",
        {
          status: "completed",
          endedAt: Date.now(),
          durationMS: Date.now() - executeStartedAt,
          reportPath: execution.reportPath,
          artifactDir: execution.artifactDir,
          note: `Execution completed with ${execution.verifyResults.length} verification result(s).`,
        },
        {
          status: "completed",
          generation: {
            sessionID: generation.sessionID,
            model: generation.model,
            effectiveModel: generation.effectiveModel,
            agent: generation.agent,
            rawPath: generation.rawPath,
            patchPath: generation.patchPath,
            reportPath: generation.reportPath,
            attempts: generation.attempts,
            patchValidation: generation.patchValidation,
          },
          review: {
            sessionID: reviewResult.sessionID,
            model: reviewResult.model,
            agent: reviewResult.agent,
            rawPath: reviewResult.rawPath,
            reportPath: reviewResult.reportPath,
            decision: reviewResult.decision,
            reviewMode: reviewResult.reviewMode,
          },
          verifyPlan: verifyPlan
            ? {
                path: proposalVerifyPlanPath(input.proposalID),
                ...verifyPlan,
              }
            : undefined,
          execution: {
            artifactDir: execution.artifactDir,
            patchPath: execution.patchPath,
            verifyPlanPath: execution.verifyPlanPath,
            reportPath: execution.reportPath,
            summaryPath: execution.summaryPath,
            shadowPath: execution.shadowPath,
            verifyCommands: execution.verifyCommands,
            verifyResults: execution.verifyResults,
            changes: execution.changes,
            appliedLive: execution.appliedLive,
          },
        },
      )
    } catch (error) {
      const message = trimErrorMessage(error instanceof Error ? error.message : String(error))
      const currentStage = [...stages].reverse().find((item) => item.status === "running")
      if (currentStage) {
        currentStage.status = "failed"
        currentStage.endedAt = Date.now()
        currentStage.durationMS = currentStage.startedAt ? currentStage.endedAt - currentStage.startedAt : undefined
        currentStage.error = message
      }
      await writeAutopatchReport({
        proposalID: input.proposalID,
        reportPath,
        startedAt,
        stages,
        status: "failed",
        generation: generation
          ? {
              sessionID: generation.sessionID,
              model: generation.model,
              effectiveModel: generation.effectiveModel,
              agent: generation.agent,
              rawPath: generation.rawPath,
              patchPath: generation.patchPath,
              reportPath: generation.reportPath,
              attempts: generation.attempts,
              patchValidation: generation.patchValidation,
            }
          : undefined,
        review: reviewResult
          ? {
              sessionID: reviewResult.sessionID,
              model: reviewResult.model,
              effectiveModel: reviewResult.effectiveModel,
              agent: reviewResult.agent,
              rawPath: reviewResult.rawPath,
              reportPath: reviewResult.reportPath,
              decision: reviewResult.decision,
              reviewMode: reviewResult.reviewMode,
            }
          : undefined,
        verifyPlan: verifyPlan
          ? {
              path: proposalVerifyPlanPath(input.proposalID),
              ...verifyPlan,
            }
          : undefined,
        execution: execution
          ? {
              artifactDir: execution.artifactDir,
              patchPath: execution.patchPath,
              verifyPlanPath: execution.verifyPlanPath,
              reportPath: execution.reportPath,
              summaryPath: execution.summaryPath,
              shadowPath: execution.shadowPath,
              verifyCommands: execution.verifyCommands,
              verifyResults: execution.verifyResults,
              changes: execution.changes,
              appliedLive: execution.appliedLive,
            }
          : undefined,
        error: message,
      })
      throw error
    }

    return {
      proposalID: input.proposalID,
      reportPath,
      stages,
      generation: {
        sessionID: generation.sessionID,
        model: generation.model,
        effectiveModel: generation.effectiveModel,
        agent: generation.agent,
        rawPath: generation.rawPath,
        patchPath: generation.patchPath,
        reportPath: generation.reportPath,
      },
      review: {
        sessionID: reviewResult.sessionID,
        model: reviewResult.model,
        effectiveModel: reviewResult.effectiveModel,
        agent: reviewResult.agent,
        rawPath: reviewResult.rawPath,
        reportPath: reviewResult.reportPath,
        decision: reviewResult.decision,
        reviewMode: reviewResult.reviewMode,
      },
      execution,
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace, @typescript-eslint/no-shadow */
