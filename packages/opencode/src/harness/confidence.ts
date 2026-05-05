import path from "path"
import z from "zod"
import { Filesystem } from "@/util/filesystem"
import { resolveHarnessSourcePath } from "./paths"
import { HarnessSessionRules, runReadOnlyHarnessSession, sourceRoot } from "./session"
import { HarnessState } from "./state"

/* eslint-disable @typescript-eslint/no-namespace */
const CONFIDENCE_RESEARCH_TIMEOUT_MS = 180_000
const CONFIDENCE_RESEARCH_COOLDOWN_MS = 15 * 60 * 1000
const CONFIDENCE_RESEARCH_LIMIT = 2
const CONFIDENCE_RESEARCH_MAX_ATTEMPTS = 2
const CONFIDENCE_RESEARCH_RETRY_TIMEOUT_BONUS_MS = 120_000

const ResearchDecisionSchema = z.object({
  confidence: HarnessState.ProposalConfidence,
  summary: z.string(),
  rationale: z.string(),
  evidence: z.array(z.string()),
  narrowedFiles: z.array(z.string()),
  patchSummary: z.string(),
})

type ResearchDecision = z.infer<typeof ResearchDecisionSchema>

function normalizeRelative(input: string) {
  return input.replaceAll("\\", "/").replace(/^\.\//, "")
}

function confidenceRank(value: HarnessState.ProposalConfidence) {
  switch (value) {
    case "low":
      return 0
    case "medium":
      return 1
    case "high":
      return 2
  }
}

function clampPromotedConfidence(
  current: HarnessState.ProposalConfidence,
  requested: HarnessState.ProposalConfidence,
): HarnessState.ProposalConfidence {
  const currentRank = confidenceRank(current)
  const requestedRank = confidenceRank(requested)
  if (requestedRank <= currentRank) return current
  if (current === "low" && requested === "high") return "medium"
  return requested
}

function extractResearchDecisionRaw(raw: string) {
  const trimmed = raw.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim()
  if (fenced?.startsWith("{") && fenced.endsWith("}")) return fenced
  const firstBrace = raw.indexOf("{")
  const lastBrace = raw.lastIndexOf("}")
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim()
  }
  return trimmed
}

function parseResearchDecision(raw: string) {
  return ResearchDecisionSchema.parse(JSON.parse(extractResearchDecisionRaw(raw)))
}

async function resolveExisting(files: string[]) {
  const keep: string[] = []
  for (const file of files) {
    if (await Filesystem.exists(file)) keep.push(file)
  }
  return keep
}

async function sourceArtifacts(proposal: HarnessState.Proposal) {
  const files = proposal.expectedFiles ?? proposal.patchHint?.files ?? []
  return resolveExisting(files.map((file) => resolveHarnessSourcePath(normalizeRelative(file), sourceRoot())))
}

function interestingObservation(item: HarnessState.Observation) {
  if (item.kind.startsWith("proposal.autopatch")) return true
  if (item.kind.startsWith("patch.generation")) return true
  if (item.kind.startsWith("review.")) return true
  if (item.kind.startsWith("terminal.")) return true
  if (item.kind.startsWith("session.")) return true
  if (item.kind.includes("friction")) return true
  return item.source !== "analyzer"
}

function observationDigest(observations: HarnessState.Observation[]) {
  return observations
    .filter(interestingObservation)
    .slice(-8)
    .map((item) => `- [${item.kind}] ${item.message}`)
}

function researchPrompt(input: {
  proposal: HarnessState.Proposal
  currentConfidence: HarnessState.ProposalConfidence
  sourceFiles: string[]
  observations: HarnessState.Observation[]
}) {
  const currentFiles = input.proposal.patchHint?.files ?? []
  return [
    "You are helping the harness raise or refine confidence for a staged self-improvement proposal.",
    "",
    "Your job is to research whether this proposal should stay at the same confidence, move up by one step, or narrow its scope so it can mature safely.",
    "",
    "Rules:",
    "- Base your answer only on the attached source files and the observation digest below.",
    "- Be conservative. Do not jump from low to high in one step.",
    "- Only return narrowedFiles that are a subset of the currently declared files.",
    "- If the current scope is already tight, you may return the same files unchanged.",
    "- Prefer smaller, better-specified changes over vague ambition.",
    "- Return JSON only.",
    "",
    `Current confidence: ${input.currentConfidence}`,
    `Proposal title: ${input.proposal.title}`,
    `Current rationale: ${input.proposal.rationale}`,
    `Current patch summary: ${input.proposal.patchHint?.summary ?? "none"}`,
    "",
    "Currently declared files:",
    ...(currentFiles.length > 0 ? currentFiles.map((file) => `- ${normalizeRelative(file)}`) : ["- none"]),
    "",
    "Attached current source files:",
    ...(input.sourceFiles.length > 0 ? input.sourceFiles.map((file) => `- ${file}`) : ["- none"]),
    "",
    "Recent relevant observations:",
    ...(input.observations.length > 0 ? observationDigest(input.observations) : ["- none"]),
    "",
    "Return JSON with this exact shape:",
    "{",
    '  "confidence": "low" | "medium" | "high",',
    '  "summary": "short plain-English summary of what you learned",',
    '  "rationale": "why the proposal deserves that confidence right now",',
    '  "evidence": ["specific supporting point"],',
    '  "narrowedFiles": ["subset/of/current/files.ts"],',
    '  "patchSummary": "clearer, narrower patch intent if needed"',
    "}",
  ].join("\n")
}

function canResearch(proposal: HarnessState.Proposal) {
  if (proposal.kind !== "code_patch") return false
  if (proposal.status === "applied" || proposal.status === "dismissed") return false
  if (proposal.autoStatus === "running" || proposal.autoStatus === "applied") return false
  if (HarnessState.effectiveConfidence(proposal) === "high") return false
  const files = proposal.patchHint?.files ?? proposal.expectedFiles ?? []
  return files.length > 0
}

function narrowedFiles(input: {
  declaredFiles: string[]
  responseFiles: string[]
}) {
  const declared = new Set(input.declaredFiles.map(normalizeRelative))
  const narrowed = [...new Set(input.responseFiles.map(normalizeRelative).filter((file) => declared.has(file)))]
  return narrowed.length > 0 ? narrowed : input.declaredFiles.map(normalizeRelative)
}

function confidenceResearchTimeoutMS(input: {
  proposal: HarnessState.Proposal
  requestedTimeoutMS?: number
}) {
  if (input.requestedTimeoutMS && input.requestedTimeoutMS > 0) return input.requestedTimeoutMS
  if (input.proposal.risk === "large" || input.proposal.risk === "core") return 300_000
  if (input.proposal.risk === "medium") return CONFIDENCE_RESEARCH_TIMEOUT_MS
  return 120_000
}

function sessionStartFailure(message: string | undefined) {
  return /Last progress:\s*session_start\b/i.test(message ?? "")
}

function failedHarnessModel(message: string | undefined) {
  return message?.match(/Route:\s*([^\r\n]+)/i)?.[1]?.trim().replace(/[.]+$/, "")
}

export namespace HarnessConfidence {
  export function effectiveConfidence(proposal: HarnessState.Proposal) {
    return HarnessState.effectiveConfidence(proposal)
  }

  export async function researchProposal(input: {
    proposal: HarnessState.Proposal
    observations?: HarnessState.Observation[]
    force?: boolean
    timeoutMS?: number
  }) {
    const proposal = input.proposal
    if (!canResearch(proposal)) {
      return {
        changed: false,
        promoted: false,
        skipped: "not_researchable" as const,
      }
    }

    if (
      !input.force &&
      proposal.confidenceResearchAt &&
      Date.now() - proposal.confidenceResearchAt < CONFIDENCE_RESEARCH_COOLDOWN_MS
    ) {
      return {
        changed: false,
        promoted: false,
        skipped: "cooldown" as const,
      }
    }

    const sourceFiles = await sourceArtifacts(proposal)
    if (sourceFiles.length === 0) {
      return {
        changed: false,
        promoted: false,
        skipped: "missing_source_files" as const,
      }
    }

    const observations = input.observations ?? (await HarnessState.listObservations(80))
    const currentConfidence = HarnessState.effectiveConfidence(proposal)

    await HarnessState.updateProposal(proposal.id, (current) => ({
      ...current,
      confidenceResearchStatus: "running",
      confidenceResearchAt: Date.now(),
      confidenceResearchError: undefined,
      confidenceResearchAttempts: (current.confidenceResearchAttempts ?? 0) + 1,
    }))

    try {
      const baseTimeout = confidenceResearchTimeoutMS({
        proposal,
        requestedTimeoutMS: input.timeoutMS,
      })
      let result: Awaited<ReturnType<typeof runReadOnlyHarnessSession>> | undefined
      let avoid: string | undefined
      for (let attempt = 1; attempt <= CONFIDENCE_RESEARCH_MAX_ATTEMPTS; attempt += 1) {
        try {
          result = await runReadOnlyHarnessSession({
            title: `Harness confidence research ${proposal.id}`,
            prompt: researchPrompt({
              proposal,
              currentConfidence,
              sourceFiles,
              observations,
            }),
            artifactFiles: sourceFiles,
            lane: "healer",
            avoidModel: avoid,
            permission: HarnessSessionRules.readOnly(),
            timeoutMS: attempt === 1 ? baseTimeout : baseTimeout + CONFIDENCE_RESEARCH_RETRY_TIMEOUT_BONUS_MS,
          })
          break
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (!sessionStartFailure(message) || attempt >= CONFIDENCE_RESEARCH_MAX_ATTEMPTS) throw error
          avoid = failedHarnessModel(message) ?? avoid
          await HarnessState.appendObservation({
            source: "analyzer",
            kind: "proposal.confidence_retry",
            message: `Retrying confidence research after a startup stall: ${proposal.title}`,
            data: {
              proposalID: proposal.id,
              attempt,
              avoidModel: avoid,
              error: message,
            },
          })
        }
      }
      if (!result) {
        throw new Error("Confidence research produced no result.")
      }

      const structured: ResearchDecision = result.structured
        ? ResearchDecisionSchema.parse(result.structured)
        : parseResearchDecision(result.raw)
      const nextConfidence = clampPromotedConfidence(currentConfidence, structured.confidence)
      const promoted = confidenceRank(nextConfidence) > confidenceRank(currentConfidence) && structured.evidence.length >= 2
      const declaredFiles = proposal.patchHint?.files ?? proposal.expectedFiles ?? []
      const nextFiles = narrowedFiles({
        declaredFiles,
        responseFiles: structured.narrowedFiles,
      })
      const patchSummary = structured.patchSummary.trim() || proposal.patchHint?.summary || proposal.title

      const updated = await HarnessState.updateProposal(proposal.id, (current) => ({
        ...current,
        confidenceOverride: promoted ? nextConfidence : current.confidenceOverride,
        confidenceResearchStatus: promoted ? "promoted" : "idle",
        confidenceResearchSummary: structured.summary.trim(),
        confidenceResearchAt: Date.now(),
        confidenceResearchError: undefined,
        rationale: promoted ? `${current.rationale}\n\nResearch note: ${structured.rationale.trim()}` : current.rationale,
        patchHint: current.patchHint
          ? {
              summary: patchSummary,
              files: nextFiles,
            }
          : current.patchHint,
      }))

      await HarnessState.appendObservation({
        source: "analyzer",
        kind: promoted ? "proposal.confidence_promoted" : "proposal.confidence_researched",
        message: promoted
          ? `Raised proposal confidence through research: ${proposal.title}`
          : `Researched staged proposal for stronger evidence: ${proposal.title}`,
        data: {
          proposalID: proposal.id,
          previousConfidence: currentConfidence,
          nextConfidence,
          promoted,
          model: result.selectedModel ?? result.requestedModel,
          narrowedFiles: nextFiles,
        },
      })

      return {
        changed: !!updated,
        promoted,
        skipped: undefined,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await HarnessState.updateProposal(proposal.id, (current) => ({
        ...current,
        confidenceResearchStatus: "failed",
        confidenceResearchAt: Date.now(),
        confidenceResearchError: message,
      }))
      await HarnessState.appendObservation({
        source: "analyzer",
        kind: "proposal.confidence_failed",
        message: `Confidence research failed for staged proposal: ${proposal.title}`,
        data: {
          proposalID: proposal.id,
          error: message,
        },
      })
      return {
        changed: false,
        promoted: false,
        skipped: "failed" as const,
      }
    }
  }

  export async function matureProposals(input: {
    proposals: HarnessState.Proposal[]
    force?: boolean
    observations?: HarnessState.Observation[]
  }) {
    const candidates = input.proposals
      .filter(canResearch)
      .sort((a, b) => confidenceRank(HarnessState.effectiveConfidence(b)) - confidenceRank(HarnessState.effectiveConfidence(a)))
      .slice(0, CONFIDENCE_RESEARCH_LIMIT)

    const results = await Promise.all(
      candidates.map((proposal) =>
        researchProposal({
          proposal,
          force: input.force,
          observations: input.observations,
        }),
      ),
    )
    const researched = results.filter(
      (result) =>
        result.skipped !== "cooldown" && result.skipped !== "missing_source_files" && result.skipped !== "not_researchable",
    ).length
    const promoted = results.filter((result) => result.promoted).length
    return {
      researched,
      promoted,
    }
  }
}
