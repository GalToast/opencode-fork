import path from "path"
import z from "zod"
import { mergeDeep } from "remeda"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Lock } from "@/util/lock"
import { Identifier } from "@/id/id"

/* eslint-disable @typescript-eslint/no-namespace */
export namespace HarnessState {
  type JsonRecord = { [key: string]: unknown }
  type OverlayShape = JsonRecord
  type OverlayAllowlist = true | { [key: string]: OverlayAllowlist }

  export const Source = z.enum(["wrapper", "runtime", "analyzer", "manual"])
  export type Source = z.infer<typeof Source>

  export const ProposalConfidence = z.enum(["high", "medium", "low"])
  export type ProposalConfidence = z.infer<typeof ProposalConfidence>

  export const ProposalKind = z.enum(["config_overlay", "code_patch"])
  export type ProposalKind = z.infer<typeof ProposalKind>

  export const ProposalStatus = z.enum(["open", "materialized", "applied", "dismissed"])
  export type ProposalStatus = z.infer<typeof ProposalStatus>

  export const ProposalRisk = z.enum(["small", "medium", "large", "core"])
  export type ProposalRisk = z.infer<typeof ProposalRisk>

  export const ProposalAutonomy = z.enum(["manual", "stage_only", "autonomous_overlay", "autonomous_patch"])
  export type ProposalAutonomy = z.infer<typeof ProposalAutonomy>

  export const ProposalAutoStatus = z.enum(["idle", "running", "validated", "applied", "failed", "staged"])
  export type ProposalAutoStatus = z.infer<typeof ProposalAutoStatus>

  export const ProposalConfidenceResearchStatus = z.enum(["idle", "running", "promoted", "failed"])
  export type ProposalConfidenceResearchStatus = z.infer<typeof ProposalConfidenceResearchStatus>

  export const ReviewVerdict = z.enum(["approve", "revise", "reject"])
  export type ReviewVerdict = z.infer<typeof ReviewVerdict>

  export const Observation = z.object({
    time: z.number(),
    source: Source,
    kind: z.string(),
    message: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  export type Observation = z.infer<typeof Observation>

  export const Proposal = z.object({
    id: Identifier.schema("part"),
    kind: ProposalKind,
    title: z.string(),
    confidence: ProposalConfidence,
    rationale: z.string(),
    status: ProposalStatus,
    risk: ProposalRisk.optional(),
    autonomy: ProposalAutonomy.optional(),
    riskReasons: z.array(z.string()).optional(),
    expectedFiles: z.array(z.string()).optional(),
    sensitivePaths: z.array(z.string()).optional(),
    maxFiles: z.number().int().nonnegative().optional(),
    maxChangedLines: z.number().int().nonnegative().optional(),
    allowMove: z.boolean().optional(),
    allowDelete: z.boolean().optional(),
    requirePriorValidation: z.boolean().optional(),
    overlay: z.record(z.string(), z.unknown()).optional(),
    patchHint: z
      .object({
        summary: z.string(),
        files: z.array(z.string()).optional(),
      })
      .optional(),
    reviewArtifacts: z.array(z.string()).optional(),
    materializedAt: z.number().optional(),
    reviewVerdict: ReviewVerdict.optional(),
    reviewSummary: z.string().optional(),
    reviewedAt: z.number().optional(),
    autoStatus: ProposalAutoStatus.optional(),
    lastAutoExecutionAt: z.number().optional(),
    lastAutoExecutionError: z.string().optional(),
    lastValidatedAt: z.number().optional(),
    validatedFingerprint: z.string().optional(),
    confidenceOverride: ProposalConfidence.optional(),
    confidenceResearchStatus: ProposalConfidenceResearchStatus.optional(),
    confidenceResearchSummary: z.string().optional(),
    confidenceResearchAt: z.number().optional(),
    confidenceResearchError: z.string().optional(),
    confidenceResearchAttempts: z.number().int().nonnegative().optional(),
    fingerprint: z.string().optional(),
  })
  export type Proposal = z.infer<typeof Proposal>

  const Snapshot = z.object({
    version: z.literal(1),
    updatedAt: z.number(),
    proposals: z.array(Proposal),
  })

  type Snapshot = z.infer<typeof Snapshot>

  const overlayAllowlist: OverlayAllowlist = {
    experimental: {
      orchestration: {
        global_scheduler: {
          enabled: true,
          profile: true,
          aging_ms: true,
          fairness_penalty: true,
          lane_concurrency: {
            user_ingress: true,
            main_turns: true,
            steer_fastlane: true,
            orchestrator_swarm: true,
            adversarial_review: true,
            subagent_tasks: true,
            tool_io: true,
            longrun_jobs: true,
          },
          autoscale: {
            enabled: true,
            main_turns_min: true,
            main_turns_max: true,
            scale_up_queue_threshold: true,
            scale_down_running_threshold: true,
            cooldown_ms: true,
            steer_fastlane_enabled: true,
            steer_fastlane_min: true,
            steer_fastlane_max: true,
            steer_scale_up_queue_threshold: true,
            steer_scale_down_running_threshold: true,
            steer_cooldown_ms: true,
          },
          guardrails: {
            enabled: true,
            tool_io_starvation_ms: true,
            longrun_jobs_starvation_ms: true,
            tool_io_bias: true,
            longrun_jobs_bias: true,
          },
        },
        task_scheduler: {
          enabled: true,
          max_concurrency: true,
          aging_ms: true,
          preemption: true,
          heartbeat_ms: true,
          recovery_stuck_ms: true,
        },
      },
    },
  }

  function isPlainObject(value: unknown): value is JsonRecord {
    return !!value && typeof value === "object" && !Array.isArray(value)
  }

  function sanitizeOverlayValue(value: unknown, allowlist: OverlayAllowlist): unknown {
    if (Array.isArray(value)) return value
    if (isPlainObject(value) && ("env" in value || "file" in value)) return undefined
    if (allowlist === true) return value
    if (!isPlainObject(value)) return undefined
    const next: JsonRecord = {}
    for (const [key, childAllowlist] of Object.entries(allowlist)) {
      if (!(key in value)) continue
      const child = sanitizeOverlayValue(value[key], childAllowlist)
      if (child !== undefined) next[key] = child
    }
    return Object.keys(next).length > 0 ? next : undefined
  }

  function sanitizeOverlay(input: OverlayShape): OverlayShape {
    const sanitized = sanitizeOverlayValue(input, overlayAllowlist)
    return isPlainObject(sanitized) ? sanitized : {}
  }

  function rootDir() {
    return process.env.OPENCODE_HARNESS_ROOT || Instance.worktree || process.cwd()
  }

  function runtimeDir() {
    return path.join(rootDir(), ".opencode", "runtime", "harness")
  }

  export function observationsPath() {
    return path.join(runtimeDir(), "observations.jsonl")
  }

  export function snapshotPath() {
    return path.join(runtimeDir(), "state.json")
  }

  export function overlayPath() {
    return process.env.OPENCODE_HARNESS_OVERLAY || path.join(runtimeDir(), "overlay.json")
  }

  export function reviewDir() {
    return path.join(runtimeDir(), "review")
  }

  async function readSnapshot(): Promise<Snapshot> {
    const target = snapshotPath()
    using _ = await Lock.read(target)
    const raw = await Filesystem.readJson<Snapshot>(target).catch(() => undefined)
    if (!raw) {
      return {
        version: 1,
        updatedAt: 0,
        proposals: [],
      }
    }
    const parsed = Snapshot.safeParse(raw)
    if (!parsed.success) {
      return {
        version: 1,
        updatedAt: 0,
        proposals: [],
      }
    }
    return parsed.data
  }

  async function writeSnapshot(input: Snapshot) {
    const target = snapshotPath()
    using _ = await Lock.write(target)
    await Filesystem.writeJson(target, input)
  }

  function proposalFingerprint(input: Proposal) {
    return JSON.stringify({
      kind: input.kind,
      title: input.title,
      confidence: input.confidence,
      rationale: input.rationale,
      risk: input.risk ?? null,
      autonomy: input.autonomy ?? null,
      riskReasons: input.riskReasons ?? null,
      expectedFiles: input.expectedFiles ?? null,
      sensitivePaths: input.sensitivePaths ?? null,
      maxFiles: input.maxFiles ?? null,
      maxChangedLines: input.maxChangedLines ?? null,
      allowMove: input.allowMove ?? null,
      allowDelete: input.allowDelete ?? null,
      requirePriorValidation: input.requirePriorValidation ?? null,
      overlay: input.overlay ?? null,
      patchHint: input.patchHint ?? null,
    })
  }

  function normalizeProposal(input: Proposal): Proposal {
    return {
      ...input,
      fingerprint: proposalFingerprint(input),
    }
  }

  export function effectiveConfidence(input: Pick<Proposal, "confidence" | "confidenceOverride">) {
    return input.confidenceOverride ?? input.confidence
  }

  async function mutateSnapshot<T>(mutator: (snapshot: Snapshot) => T | Promise<T>): Promise<T> {
    const target = snapshotPath()
    using _ = await Lock.write(target)
    const raw = await Filesystem.readJson<Snapshot>(target).catch(() => undefined)
    const parsed = Snapshot.safeParse(raw)
    const snapshot = parsed.success
      ? parsed.data
      : {
          version: 1 as const,
          updatedAt: 0,
          proposals: [],
        }
    const result = await mutator(snapshot)
    await Filesystem.writeJson(target, snapshot)
    return result
  }

  export async function appendObservation(input: Omit<Observation, "time"> & { time?: number }) {
    const target = observationsPath()
    using _ = await Lock.write(target)
    const line = JSON.stringify({
      time: input.time ?? Date.now(),
      source: input.source,
      kind: input.kind,
      message: input.message,
      data: input.data,
    } satisfies Observation)
    const existing = await Bun.file(target).text().catch(() => "")
    const content = existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`
    await Filesystem.write(target, content)
  }

  export async function listObservations(limit = 50) {
    const target = observationsPath()
    using _ = await Lock.read(target)
    const text = await Bun.file(target).text().catch(() => "")
    if (!text.trim()) return [] as Observation[]
    const parsed = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => Observation.safeParse(JSON.parse(line)))
      .filter((result) => result.success)
      .map((result) => result.data)
    return parsed.slice(Math.max(0, parsed.length - limit))
  }

  export async function getSnapshot() {
    return readSnapshot()
  }

  export async function replaceProposals(proposals: Proposal[]) {
    await mutateSnapshot((snapshot) => {
      const previousByID = new Map(snapshot.proposals.map((proposal) => [proposal.id, proposal]))
      const next = proposals.map((proposal) => {
        const normalized = normalizeProposal(proposal)
        const previous = previousByID.get(proposal.id)
        if (!previous) return normalized
        const previousFingerprint = previous.fingerprint ?? proposalFingerprint(previous)
        const fingerprintChanged = previousFingerprint !== normalized.fingerprint
        const merged =
          fingerprintChanged
            ? normalized
            : {
                ...normalized,
                status: previous.status === "open" ? normalized.status : previous.status,
                reviewArtifacts: previous.reviewArtifacts ?? normalized.reviewArtifacts,
                materializedAt: previous.materializedAt ?? normalized.materializedAt,
                reviewVerdict: previous.reviewVerdict ?? normalized.reviewVerdict,
                reviewSummary: previous.reviewSummary ?? normalized.reviewSummary,
                reviewedAt: previous.reviewedAt ?? normalized.reviewedAt,
                autoStatus: previous.autoStatus ?? normalized.autoStatus,
                lastAutoExecutionAt: previous.lastAutoExecutionAt ?? normalized.lastAutoExecutionAt,
                lastAutoExecutionError: previous.lastAutoExecutionError ?? normalized.lastAutoExecutionError,
                lastValidatedAt: previous.lastValidatedAt ?? normalized.lastValidatedAt,
                validatedFingerprint: previous.validatedFingerprint ?? normalized.validatedFingerprint,
                fingerprint: previousFingerprint,
              }

        if (!previous.confidenceResearchAt) return merged
        if (fingerprintChanged && previous.status !== "open") return merged

        return {
          ...merged,
          patchHint: previous.patchHint ?? merged.patchHint,
          confidenceOverride: previous.confidenceOverride ?? merged.confidenceOverride,
          confidenceResearchStatus: previous.confidenceResearchStatus ?? merged.confidenceResearchStatus,
          confidenceResearchSummary: previous.confidenceResearchSummary ?? merged.confidenceResearchSummary,
          confidenceResearchAt: previous.confidenceResearchAt ?? merged.confidenceResearchAt,
          confidenceResearchError: previous.confidenceResearchError ?? merged.confidenceResearchError,
          confidenceResearchAttempts: previous.confidenceResearchAttempts ?? merged.confidenceResearchAttempts,
        }
      })

      for (const previous of snapshot.proposals) {
        if (next.some((proposal) => proposal.id === previous.id)) continue
        if (previous.status === "applied" || previous.status === "dismissed") continue
        next.push(previous)
      }

      snapshot.version = 1
      snapshot.updatedAt = Date.now()
      snapshot.proposals = next
    })
  }

  export async function updateProposal(
    id: string,
    updater: (proposal: Proposal) => Proposal,
  ): Promise<Proposal | undefined> {
    return mutateSnapshot((snapshot) => {
      const index = snapshot.proposals.findIndex((proposal) => proposal.id === id)
      if (index === -1) return undefined
      const nextProposal = normalizeProposal(updater(snapshot.proposals[index]))
      snapshot.proposals[index] = nextProposal
      snapshot.updatedAt = Date.now()
      return nextProposal
    })
  }

  export async function readOverlay() {
    const target = overlayPath()
    using _ = await Lock.read(target)
    return Filesystem.readJson<OverlayShape>(target).catch(() => undefined)
  }

  export async function writeOverlay(overlay: OverlayShape) {
    const target = overlayPath()
    const sanitized = sanitizeOverlay(overlay)
    using _ = await Lock.write(target)
    await Filesystem.writeJson(target, sanitized)
  }

  export async function mergeOverlay(overlay: OverlayShape) {
    const target = overlayPath()
    using _ = await Lock.write(target)
    const current = await Filesystem.readJson<OverlayShape>(target).catch(() => ({}))
    const next = mergeDeep(current, sanitizeOverlay(overlay))
    await Filesystem.writeJson(target, next)
    return next
  }
}
