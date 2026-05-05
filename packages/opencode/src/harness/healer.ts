import path from "path"
import z from "zod"
import { Filesystem } from "@/util/filesystem"
import { HarnessState } from "./state"
import { HarnessSessionRules, runReadOnlyHarnessSession } from "./session"
import {
  HarnessError,
  TimeoutError,
  ValidationError,
  SessionError,
  classifyError,
  isTimeoutError,
  isValidationError,
  isSessionError,
} from "./errors"

/* eslint-disable @typescript-eslint/no-namespace */
const HEALER_TIMEOUT_MS = 60_000

export type HarnessHealerPhase = "generation_retry" | "review_repair"

const HealerDecisionSchema = z.object({
  mode: z.enum(["continue", "stage_only"]),
  summary: z.string(),
  promptNotes: z.array(z.string()).default([]),
  retryModel: z.string().optional(),
  preferFreshContext: z.boolean().default(false),
  suppressPreviousOutput: z.boolean().default(false),
})

export type HarnessHealerDecision = z.infer<typeof HealerDecisionSchema>

type HarnessHealerInterventionInput = {
  proposal: HarnessState.Proposal
  phase: HarnessHealerPhase
  artifacts: string[]
  currentModel?: string
  attempt?: number
  validationError?: string
  reviewDecision?: {
    verdict: string
    summary: string
    concerns?: string[]
    requiredChanges?: string[]
    verifyCommands?: string[]
  }
  timeoutMS?: number
}

type HarnessHealerIntervention = {
  decision: HarnessHealerDecision
  rawPath: string
  reportPath: string
  sessionID?: string
  selectedModel?: string
  effectiveModel?: string
  routing?: Record<string, unknown>
}

function reviewDirectory(proposalID: string) {
  return path.join(HarnessState.reviewDir(), proposalID)
}

function healerBaseName(phase: HarnessHealerPhase, attempt?: number) {
  if (phase === "generation_retry") return `healer.generation-retry.attempt-${attempt ?? 0}`
  return "healer.review-repair"
}

export function healerPromptText(input: HarnessHealerInterventionInput) {
  const lines = [
    "You are the bounded healer sidecar for an OpenCode harness self-edit proposal.",
    "",
    "You may only decide how the harness should run the NEXT recovery step.",
    "Do not propose code changes, do not widen scope, and do not rewrite the patch.",
    "",
    "Allowed outputs:",
    '- "continue": keep autonomous repair going with optional model/prompt adjustments.',
    '- "stage_only": stop autonomous repair and stage the proposal for manual follow-up.',
    "",
    "Use stage_only only when another autonomous attempt is more likely to create noise than real progress.",
    "Examples include repeated reasoning-only timeouts, repeated malformed patch output, or reviewer feedback that clearly needs broader research instead of another patch retry.",
    "",
    "Return JSON only with this exact shape:",
    "{",
    '  "mode": "continue" | "stage_only",',
    '  "summary": "short decision summary",',
    '  "promptNotes": ["up to 3 short repair notes for the next attempt"],',
    '  "retryModel": "optional exact provider/model string",',
    '  "preferFreshContext": true | false,',
    '  "suppressPreviousOutput": true | false',
    "}",
    "",
    "Constraints:",
    "- Keep promptNotes short, concrete, and non-redundant.",
    "- Set retryModel only when rotating models is meaningfully better than retrying the current one.",
    "- preferFreshContext is mainly for stale-context or anchor-drift failures.",
    "- suppressPreviousOutput is mainly for malformed or misleading prior patch text.",
    "",
    `Proposal title: ${input.proposal.title}`,
    `Proposal rationale: ${input.proposal.rationale}`,
    `Patch hint: ${input.proposal.patchHint?.summary ?? "No patch hint provided."}`,
    `Current model: ${input.currentModel ?? "unspecified"}`,
    `Phase: ${input.phase}`,
  ]

  if (input.phase === "generation_retry") {
    lines.push(`Attempt: ${input.attempt ?? 0}`)
    lines.push(`Generation failure: ${input.validationError ?? "Unknown generation failure."}`)
  } else {
    lines.push(`Review verdict: ${input.reviewDecision?.verdict ?? "unknown"}`)
    lines.push(`Review summary: ${input.reviewDecision?.summary ?? "Unknown review summary."}`)
    lines.push("")
    lines.push("Review concerns:")
    lines.push(
      ...(input.reviewDecision?.concerns?.length
        ? input.reviewDecision.concerns.map((item) => `- ${item}`)
        : ["- none"]),
    )
    lines.push("")
    lines.push("Required changes:")
    lines.push(
      ...(input.reviewDecision?.requiredChanges?.length
        ? input.reviewDecision.requiredChanges.map((item) => `- ${item}`)
        : ["- none"]),
    )
  }

  lines.push("")
  lines.push("Attached artifacts:")
  lines.push(...input.artifacts.map((artifact) => `- ${artifact}`))
  return lines.join("\n")
}

function healerResponseFormat() {
  return {
    type: "json_schema" as const,
    schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        mode: {
          type: "string" as const,
          enum: ["continue", "stage_only"],
        },
        summary: {
          type: "string" as const,
        },
        promptNotes: {
          type: "array" as const,
          items: {
            type: "string" as const,
          },
        },
        retryModel: {
          type: "string" as const,
        },
        preferFreshContext: {
          type: "boolean" as const,
        },
        suppressPreviousOutput: {
          type: "boolean" as const,
        },
      },
      required: ["mode", "summary", "promptNotes", "preferFreshContext", "suppressPreviousOutput"],
    },
    retryCount: 1,
  }
}

export function extractJsonText(raw: string) {
  const match = raw.match(/```json\s*([\s\S]*?)```/i) ?? raw.match(/(\{[\s\S]*\})/)
  return (match?.[1] ?? match?.[0] ?? raw).trim()
}

export function buildGenerationRetryDecision(input: HarnessHealerInterventionInput): HarnessHealerDecision {
  // Convert validationError to structured error if it's a string
  const error: HarnessError | undefined = input.validationError
    ? classifyError(input.validationError, {
        lane: "author",
        model: input.currentModel,
        attempt: input.attempt,
      })
    : undefined

  const attempt = input.attempt ?? 1
  const timedOut = error instanceof TimeoutError
  const startupOnly = error instanceof SessionError && error.isStartupFailure()
  const staleContext = error instanceof ValidationError && error.isStaleContext()
  const malformedPatch = error instanceof ValidationError && error.isMalformedPatch()

  if (timedOut && attempt >= 2 && !startupOnly) {
    return {
      mode: "stage_only",
      summary: "Repeated author stalls are creating retry noise; stage this proposal for manual follow-up instead of forcing another autonomous turn.",
      promptNotes: [],
      preferFreshContext: false,
      suppressPreviousOutput: true,
    }
  }

  if (staleContext) {
    return {
      mode: "continue",
      summary: "The retry should re-anchor on live source snapshots before emitting a fresh patch.",
      promptNotes: [
        "Copy hunk context directly from the latest source snapshot before writing any edit.",
        "Regenerate the affected hunk from scratch instead of preserving stale draft structure.",
      ],
      preferFreshContext: true,
      suppressPreviousOutput: true,
    }
  }

  if (malformedPatch) {
    return {
      mode: "continue",
      summary: "The prior attempt failed to return a valid apply_patch body; force a clean patch-only retry.",
      promptNotes: [
        "Return only a complete apply_patch body with Begin Patch and End Patch markers.",
        "Do not preserve or quote the previous malformed draft.",
      ],
      preferFreshContext: false,
      suppressPreviousOutput: true,
    }
  }

  if (timedOut) {
    return {
      mode: "continue",
      summary: "The author lane stalled before producing a usable patch; retry with a smaller, more direct patch ask.",
      promptNotes: [
        "Skip long reasoning and move directly to the smallest in-scope patch.",
        "Reuse only the live source context needed for the next hunk.",
      ],
      preferFreshContext: false,
      suppressPreviousOutput: false,
    }
  }

  return {
    mode: "continue",
    summary: "Retry with a tighter, lower-noise repair prompt and current source context.",
    promptNotes: [
      "Keep the repair narrowly scoped to the declared files.",
      "Rewrite only the hunk that failed validation.",
    ],
    preferFreshContext: false,
    suppressPreviousOutput: false,
  }
}

export function normalizeDecision(input: HarnessHealerDecision): HarnessHealerDecision {
  const promptNotes = [...new Set(input.promptNotes.map((item) => item.trim()).filter(Boolean))].slice(0, 3)
  return {
    mode: input.mode,
    summary: input.summary.trim(),
    promptNotes,
    retryModel: input.retryModel?.trim() || undefined,
    preferFreshContext: input.preferFreshContext,
    suppressPreviousOutput: input.suppressPreviousOutput,
  }
}

async function appendArtifactsToProposal(proposalID: string, files: string[]) {
  await HarnessState.updateProposal(proposalID, (current) => ({
    ...current,
    reviewArtifacts: [...new Set([...(current.reviewArtifacts ?? []), ...files])],
  }))
}

export class HealerRequestedStageOnlyError extends Error {
  readonly phase: HarnessHealerPhase
  readonly summary: string

  constructor(phase: HarnessHealerPhase, summary: string) {
    super(`Harness healer requested stage-only follow-up after ${phase}: ${summary}`)
    this.name = "HealerRequestedStageOnlyError"
    this.phase = phase
    this.summary = summary
  }
}

export namespace HarnessHealer {
  export async function intervene(
    input: HarnessHealerInterventionInput,
  ): Promise<HarnessHealerIntervention | undefined> {
    const artifactDir = reviewDirectory(input.proposal.id)
    const baseName = healerBaseName(input.phase, input.attempt)
    const rawPath = path.join(artifactDir, `${baseName}.txt`)
    const reportPath = path.join(artifactDir, `${baseName}.json`)

    if (input.phase === "generation_retry") {
      const decision = normalizeDecision(buildGenerationRetryDecision(input))
      const intervention = {
        decision,
        rawPath,
        reportPath,
      }
      await Filesystem.write(
        rawPath,
        [
          `mode: ${decision.mode}`,
          `summary: ${decision.summary}`,
          ...(decision.promptNotes.length > 0
            ? ["promptNotes:", ...decision.promptNotes.map((item) => `- ${item}`)]
            : []),
          `preferFreshContext: ${decision.preferFreshContext}`,
          `suppressPreviousOutput: ${decision.suppressPreviousOutput}`,
        ].join("\n") + "\n",
      )
      await Filesystem.writeJson(reportPath, {
        proposalID: input.proposal.id,
        phase: input.phase,
        deterministic: true,
        decision,
        updatedAt: Date.now(),
      })
      await appendArtifactsToProposal(input.proposal.id, [rawPath, reportPath])
      await HarnessState.appendObservation({
        source: "analyzer",
        kind: "healer.intervention",
        message: `Harness healer proposed a bounded intervention for ${input.proposal.id}.`,
        data: {
          proposalID: input.proposal.id,
          phase: input.phase,
          deterministic: true,
          mode: decision.mode,
          retryModel: decision.retryModel,
          preferFreshContext: decision.preferFreshContext,
          suppressPreviousOutput: decision.suppressPreviousOutput,
          promptNotes: decision.promptNotes,
        },
      })
      return intervention
    }

    try {
      const requestedModel = input.currentModel ?? "auto/quality"
      const result = await runReadOnlyHarnessSession({
        title: `Harness healer ${input.proposal.id} (${input.phase})`,
        prompt: healerPromptText(input),
        artifactFiles: input.artifacts,
        model: requestedModel,
        lane: "healer",
        stage: "research",
        permission: HarnessSessionRules.readOnly(),
        format: healerResponseFormat(),
        timeoutMS: input.timeoutMS ?? HEALER_TIMEOUT_MS,
      })
      const decision = normalizeDecision(HealerDecisionSchema.parse(JSON.parse(extractJsonText(result.raw))))
      const intervention = {
        decision,
        rawPath,
        reportPath,
        sessionID: result.sessionID,
        selectedModel: result.selectedModel,
        effectiveModel: result.resolvedModel ?? result.selectedModel,
        routing: result.routing,
      }
      await Filesystem.write(rawPath, result.raw)
      await Filesystem.writeJson(reportPath, {
        proposalID: input.proposal.id,
        phase: input.phase,
        sessionID: result.sessionID,
        model: requestedModel,
        selectedModel: result.selectedModel,
        effectiveModel: result.resolvedModel ?? result.selectedModel,
        routing: result.routing,
        decision,
        updatedAt: Date.now(),
      })
      await appendArtifactsToProposal(input.proposal.id, [rawPath, reportPath])
      await HarnessState.appendObservation({
        source: "analyzer",
        kind: "healer.intervention",
        message: `Harness healer proposed a bounded intervention for ${input.proposal.id}.`,
        data: {
          proposalID: input.proposal.id,
          phase: input.phase,
          mode: decision.mode,
          retryModel: decision.retryModel,
          preferFreshContext: decision.preferFreshContext,
          suppressPreviousOutput: decision.suppressPreviousOutput,
          promptNotes: decision.promptNotes,
        },
      })
      return intervention
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await Filesystem.write(rawPath, `HEALER ERROR: ${message}\n`)
      await Filesystem.writeJson(reportPath, {
        proposalID: input.proposal.id,
        phase: input.phase,
        error: message,
        updatedAt: Date.now(),
      })
      await appendArtifactsToProposal(input.proposal.id, [rawPath, reportPath])
      await HarnessState.appendObservation({
        source: "analyzer",
        kind: "healer.fallback",
        message: `Harness healer fell back to default retry behavior for ${input.proposal.id}.`,
        data: {
          proposalID: input.proposal.id,
          phase: input.phase,
          error: message,
        },
      })
      return undefined
    }
  }

  export async function stageProposal(input: {
    proposalID: string
    phase: HarnessHealerPhase
    summary: string
    artifacts?: string[]
  }) {
    await HarnessState.updateProposal(input.proposalID, (current) => ({
      ...current,
      autonomy: "stage_only",
      autoStatus: "staged",
      lastAutoExecutionAt: Date.now(),
      lastAutoExecutionError: undefined,
      confidenceOverride: current.confidenceOverride ?? "medium",
      confidenceResearchStatus: "idle",
      confidenceResearchSummary: input.summary,
      confidenceResearchAt: Date.now(),
      reviewArtifacts: [...new Set([...(current.reviewArtifacts ?? []), ...(input.artifacts ?? [])])],
    }))
    await HarnessState.appendObservation({
      source: "analyzer",
      kind: "proposal.autopatch_staged_by_healer",
      message: `Harness healer staged proposal for manual follow-up: ${input.proposalID}`,
      data: {
        proposalID: input.proposalID,
        phase: input.phase,
        summary: input.summary,
      },
    })
  }
}
