import { Identifier } from "@/id/id"
import { ExecutionLedger } from "@/execution/ledger"
import { SchedulerControl } from "@/scheduler/control-plane"
import { HarnessState } from "./state"
import { summarizeTelemetry } from "./telemetry"

/* eslint-disable @typescript-eslint/no-namespace */
type LaneLatency = {
  count: number
  averageQueuedToRunningMS: number
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return Math.round(values.reduce((acc, value) => acc + value, 0) / values.length)
}

function summarizeQueueLatency(events: Awaited<ReturnType<typeof ExecutionLedger.list>>) {
  const queuedAt = new Map<string, number>()
  const runningAt = new Map<string, number>()

  for (const event of events) {
    if (event.phase === "queued") queuedAt.set(event.jobID, event.time)
    if (event.phase === "running") runningAt.set(event.jobID, event.time)
  }

  const byLane = new Map<string, number[]>()
  for (const event of events) {
    if (event.phase !== "running") continue
    const queued = queuedAt.get(event.jobID)
    if (queued === undefined) continue
    const delta = Math.max(0, event.time - queued)
    const list = byLane.get(event.lane) ?? []
    list.push(delta)
    byLane.set(event.lane, list)
  }

  return Object.fromEntries(
    [...byLane.entries()].map(([lane, samples]) => [
      lane,
      {
        count: samples.length,
        averageQueuedToRunningMS: average(samples),
      } satisfies LaneLatency,
    ]),
  ) as Record<string, LaneLatency>
}

function countObservations(observations: Awaited<ReturnType<typeof HarnessState.listObservations>>, kind: string) {
  return observations.filter((item) => item.kind === kind).length
}

/**
 * Compute adaptive threshold based on bootstrap factor.
 * Higher bootstrapFactor (early session) = lower threshold (more sensitive)
 * Lower bootstrapFactor (mature session) = higher threshold (more stable)
 */
function adaptiveThreshold(baseThreshold: number, bootstrapFactor: number): number {
  // Scale threshold: 0.5x at bootstrap (factor=1) to 1.0x at mature (factor=0)
  const scale = 0.5 + 0.5 * (1 - bootstrapFactor)
  return Math.max(1, Math.round(baseThreshold * scale))
}

/**
 * Determine if a signal is significant considering bootstrap context.
 * In early sessions, even small signals may indicate real issues.
 */
function isSignificantSignal(
  count: number,
  baseThreshold: number,
  bootstrapFactor: number,
): boolean {
  // In bootstrap mode (factor near 1), reduce threshold by up to 50%
  const effectiveThreshold = adaptiveThreshold(baseThreshold, bootstrapFactor)
  return count >= effectiveThreshold
}

function lower(input: unknown) {
  return typeof input === "string" ? input.trim().toLowerCase() : ""
}

function sessionStartStalls(observations: Awaited<ReturnType<typeof HarnessState.listObservations>>) {
  return observations.filter((item) => {
    if (
      item.kind !== "patch.generation_retry" &&
      item.kind !== "proposal.autopatch_failed" &&
      item.kind !== "proposal.confidence_failed"
    ) {
      return false
    }
    return lower(item.data?.validationError).includes("session_start") || lower(item.data?.error).includes("session_start")
  }).length
}

function isBootstrapMode(observations: Awaited<ReturnType<typeof HarnessState.listObservations>>) {
  // Bootstrap mode: fewer than 20 observations OR session age under 5 minutes
  const BOOTSTRAP_OBSERVATION_THRESHOLD = 20
  const BOOTSTRAP_AGE_MS = 5 * 60 * 1000

  if (observations.length < BOOTSTRAP_OBSERVATION_THRESHOLD) {
    return true
  }

  const oldestObservation = observations[observations.length - 1]
  const sessionAge = Date.now() - oldestObservation.time
  return sessionAge < BOOTSTRAP_AGE_MS
}

function proposalID(slug: string) {
  return Identifier.ascending("part", `prt_harness_${slug}`)
}

export namespace HarnessAnalyze {
  export async function build() {
    const [observations, scheduler, events, currentOverlay] = await Promise.all([
      HarnessState.listObservations(200),
      SchedulerControl.getStatus().catch(() => undefined),
      ExecutionLedger.list({ order: "desc", limit: 400 }).catch(() => []),
      HarnessState.readOverlay(),
    ])

    const queueLatency = summarizeQueueLatency(events)
    const telemetry = summarizeTelemetry(observations)
    const startupStalls = sessionStartStalls(observations)
    const proposals: HarnessState.Proposal[] = []

    // Use bootstrap metrics for adaptive threshold scaling
    // Early sessions have lower thresholds to catch incipient issues sooner
    const bootstrap = telemetry.bootstrap
    const thresholdScale = bootstrap.thresholdScale // 0.2 (early) to 1.0 (mature)
    
    // Adaptive thresholds based on bootstrap factor
    const schedulerNoiseThreshold = Math.max(1, Math.round(3 * thresholdScale))
    const retryPressureThreshold = Math.max(1, Math.round(3 * thresholdScale))
    const frictionMomentumThreshold = Math.max(20, Math.round(50 * thresholdScale))
    const correlationThreshold = Math.max(20, Math.round(40 * thresholdScale))
    
    // Early warning detection: if we have early warning signals, be more proactive
    const hasEarlyWarnings = bootstrap.earlyWarningSignals >= 1

    if (scheduler) {
      const main = scheduler.lanes.find((lane) => lane.lane === "main_turns")
      const steer = scheduler.lanes.find((lane) => lane.lane === "steer_fastlane")
      const toolIO = scheduler.lanes.find((lane) => lane.lane === "tool_io")
      const longrun = scheduler.lanes.find((lane) => lane.lane === "longrun_jobs")
      const mainLatency = queueLatency["main_turns"]
      const steerLatency = queueLatency["steer_fastlane"]

      const shouldBoostProfile =
        !!main &&
        (main.health.starved ||
          (main.queued >= Math.max(2, main.concurrency) && main.health.saturation === "saturated") ||
          (mainLatency?.count ?? 0) >= 3 && (mainLatency?.averageQueuedToRunningMS ?? 0) >= 4_000)

      if (shouldBoostProfile && scheduler.profile !== "max_throughput") {
        proposals.push({
          id: proposalID("boost_scheduler_throughput"),
          kind: "config_overlay",
          title: "Boost scheduler throughput under foreground pressure",
          confidence: "high",
          rationale:
            "Foreground work is saturating the current scheduler profile. A max-throughput profile plus slightly wider autoscale ceilings should reduce main-turn and steering queue delay.",
          status: "open",
          overlay: {
            experimental: {
              orchestration: {
                global_scheduler: {
                  profile: "max_throughput",
                  autoscale: {
                    enabled: true,
                    main_turns_max: Math.max(6, (main?.concurrency ?? 1) + 2),
                    steer_fastlane_max: Math.max(10, (steer?.concurrency ?? 1) + 2),
                  },
                },
              },
            },
          },
        })
      }

      const shouldTightenGuardrails =
        !!toolIO &&
        !!longrun &&
        (toolIO.health.starved ||
          longrun.health.starved ||
          countObservations(observations, "scheduler.starved") >= 2 ||
          (steerLatency?.count ?? 0) >= 3 && (steerLatency?.averageQueuedToRunningMS ?? 0) >= 3_000)

      if (shouldTightenGuardrails) {
        proposals.push({
          id: proposalID("tighten_scheduler_guardrails"),
          kind: "config_overlay",
          title: "Tighten scheduler guardrails for tool and longrun lanes",
          confidence: toolIO.health.starved || longrun.health.starved ? "high" : "medium",
          rationale:
            "Non-foreground lanes are waiting too long relative to foreground pressure. Stronger guardrails should preserve tool responsiveness and reduce longrun starvation.",
          status: "open",
          overlay: {
            experimental: {
              orchestration: {
                global_scheduler: {
                  guardrails: {
                    enabled: true,
                    tool_io_starvation_ms: 1_000,
                    longrun_jobs_starvation_ms: 1_500,
                    tool_io_bias: 0.35,
                    longrun_jobs_bias: 0.3,
                  },
                },
              },
            },
          },
        })
      }
    }

    const binaryFallbacks = countObservations(observations, "launch.binary_fallback")
    if (binaryFallbacks > 0) {
      proposals.push({
        id: proposalID("reduce_binary_fallback_launches"),
        kind: "code_patch",
        title: "Reduce binary fallback launches",
        confidence: "medium",
        rationale:
          "The harness has fallen back to the packaged binary at least once. That bypasses source-only improvements and makes the harness less self-editable.",
        status: "open",
        patchHint: {
          summary: "Audit Bun source-launch prerequisites and make source mode the resilient default path.",
          files: ["opencode-steer.ps1", "packages/opencode/src/launcher.ts"],
        },
      })
    }

    const searxFailures =
      countObservations(observations, "searxng.start_failed") + countObservations(observations, "searxng.unhealthy")
    if (searxFailures >= 2) {
      proposals.push({
        id: proposalID("harden_searxng_recovery"),
        kind: "code_patch",
        title: "Harden SearXNG health recovery",
        confidence: "medium",
        rationale:
          "Repeated SearXNG startup or health failures suggest the wrapper should add stronger backoff, better endpoint caching, or a degraded-mode strategy.",
        status: "open",
        patchHint: {
          summary: "Improve wrapper health memory and fallback behavior around SearXNG startup/retry.",
          files: ["opencode-steer.ps1"],
        },
      })
    }

    if (telemetry.review.noise >= 3) {
      proposals.push({
        id: proposalID("reduce_review_noise"),
        kind: "code_patch",
        title: "Reduce review noise in self-edit autopatch",
        confidence: telemetry.review.noise >= 5 || telemetry.review.fallback >= 2 ? "high" : "medium",
        rationale:
          `Recent self-edits produced ${telemetry.review.fallback} structured-review fallback(s), ${telemetry.review.nonApprove} non-approve verdict(s), and ${telemetry.review.failure} review-gated autopatch failure(s). The review route likely needs tighter prompting, model selection, exact-match reuse checks, and stronger reviewer/test discipline rather than looser approval semantics.`,
        status: "open",
        patchHint: {
          summary:
            "Reduce review noise by hardening reviewer reliability, exact-match approved review reuse, and test-backed mismatch handling. Do not convert revise to approve or widen deterministic fallback for unexpected files.",
          files: ["packages/opencode/src/harness/generate.ts", "packages/opencode/src/harness/session.ts"],
        },
      })
    }

    if (telemetry.verification.weak >= 2) {
      proposals.push({
        id: proposalID("strengthen_verification_signals"),
        kind: "code_patch",
        title: "Strengthen weak verification signals before live apply",
        confidence:
          telemetry.verification.failure > 0 || telemetry.verification.weakValidated >= 3 ? "high" : "medium",
        rationale:
          `Autonomous self-edits recently produced ${telemetry.verification.weakValidated} weak validation run(s), ${telemetry.verification.unverifiedLive} unverified live apply event(s), and ${telemetry.verification.failure} verification-related failure(s). The verify-plan defaults and autonomy gate should demand stronger evidence before live apply.`,
        status: "open",
        patchHint: {
          summary: "Improve verify-plan defaults and autopatch gating so live self-edits have stronger default coverage and clearer weak-signal handling.",
          files: ["packages/opencode/src/harness/verify.ts"],
        },
      })
    }

    if (telemetry.routing.noise >= schedulerNoiseThreshold) {
      proposals.push({
        id: proposalID("tighten_autopatch_routing"),
        kind: "code_patch",
        title: "Tighten proposal routing before autopatch",
        confidence:
          telemetry.routing.cooldown >= 2 || telemetry.routing.validateOnly >= 2 ? "high" : "medium",
        rationale:
          `Autopatch routing recently staged ${telemetry.routing.staged} proposal(s), sent ${telemetry.routing.validateOnly} proposal(s) through validate-only, and skipped ${telemetry.routing.skipped} retry/cooldown attempt(s). The supervisor policy is seeing enough borderline cases that the routing thresholds should be clarified earlier.`,
        status: "open",
        patchHint: {
          summary:
            "Refine autopatch routing and the telemetry breadcrumbs that explain why a proposal was staged, validated-only, skipped, or re-queued without shrinking large-upgrade autonomy.",
          files: ["packages/opencode/src/harness/policy.ts"],
        },
      })
    }

    if (telemetry.retry.pressure >= retryPressureThreshold) {
      proposals.push({
        id: proposalID("harden_retry_and_hang_recovery"),
        kind: "code_patch",
        title: "Harden retry and hang recovery",
        confidence:
          telemetry.retry.timeout >= 2 ? "high" : "medium",
        rationale:
          `Autopatch telemetry shows ${telemetry.retry.generationRetry} generation retry event(s), ${telemetry.retry.timeout} timeout signal(s), and ${startupStalls} session_start startup stall(s). The orchestrator needs better hang detection, startup diagnostics, retry shaping, or recovery reporting.`,
        status: "open",
        patchHint: {
          summary: "Improve autopatch timeout and retry handling so hangs and repeated failures recover earlier and leave better telemetry.",
          files: ["packages/opencode/src/harness/session.ts"],
        },
      })
    }

    if (telemetry.experience.slowTurns >= 2 || telemetry.experience.slowSteers >= 2) {
      proposals.push({
        id: proposalID("preserve_foreground_continuity"),
        kind: "code_patch",
        title: "Preserve foreground continuity while autonomous upgrades run",
        confidence:
          telemetry.experience.slowTurns >= 3 || telemetry.experience.slowSteers >= 3 ? "high" : "medium",
        rationale:
          `Recent foreground turns averaged ${telemetry.experience.averageTurnMS}ms with ${telemetry.experience.slowTurns} slow turn(s), and steering averaged ${telemetry.experience.averageSteerLatencyMS}ms with ${telemetry.experience.slowSteers} slow steer application(s). The harness should keep autonomous upgrades more aware of the live terminal experience.`,
        status: "open",
        patchHint: {
          summary: "Use foreground experience telemetry to bias autonomous upgrade scheduling and continuity-safe promotion.",
          files: ["packages/opencode/src/session/prompt.ts", "packages/opencode/src/harness/session.ts"],
        },
      })
    }

    const frictionMomentumHigh =
      telemetry.experience.frictionSignalMomentum >= frictionMomentumThreshold &&
      telemetry.experience.correctionContextWindow + telemetry.experience.frustrationContextWindow >= 3

    const recoverySlow =
      (telemetry.experience.correctionRecoveryTime >= 30_000 ||
        telemetry.experience.frustrationRecoveryTime >= 30_000) &&
      (telemetry.experience.correctionContextWindow >= 1 || telemetry.experience.frustrationContextWindow >= 1)

    const correlationHigh =
      (telemetry.experience.uiCorrectionCorrelation >= correlationThreshold || telemetry.experience.restartCorrectionCorrelation >= correlationThreshold) &&
      telemetry.experience.highFrictionTurns >= 2 &&
      telemetry.experience.dialogCorrections >= 2

    if (frictionMomentumHigh) {
      proposals.push({
        id: proposalID("reduce_friction_momentum"),
        kind: "code_patch",
        title: "Reduce terminal operator friction momentum",
        confidence: "high",
        rationale:
          `Terminal friction signals show ${telemetry.experience.frictionSignalMomentum}% momentum between correction and frustration patterns across ${telemetry.experience.correctionContextWindow + telemetry.experience.frustrationContextWindow} context window turns. The harness should detect momentum earlier and intervene proactively.`,
        status: "open",
        patchHint: {
          summary: "Add friction momentum detection to trigger earlier routing adjustments before patterns compound.",
          files: ["packages/opencode/src/harness/telemetry.ts", "packages/opencode/src/harness/analyze.ts"],
        },
      })
    }

    if (recoverySlow) {
      proposals.push({
        id: proposalID("accelerate_friction_recovery"),
        kind: "code_patch",
        title: "Accelerate terminal operator friction recovery",
        confidence: "medium",
        rationale:
          `Correction recovery averages ${telemetry.experience.correctionRecoveryTime}ms and frustration recovery averages ${telemetry.experience.frustrationRecoveryTime}ms. The harness should reduce recovery latency by improving steer responsiveness or UI feedback.`,
        status: "open",
        patchHint: {
          summary: "Tune steer latency and UI feedback to reduce time-to-recovery after friction events.",
          files: ["packages/opencode/src/session/prompt.ts", "packages/opencode/src/harness/session.ts"],
        },
      })
    }

    if (correlationHigh) {
      proposals.push({
        id: proposalID("address_ui_restart_correlation"),
        kind: "code_patch",
        title: "Address UI/restart correlation with operator corrections",
        confidence: "high",
        rationale:
          `UI mentions correlate ${telemetry.experience.uiCorrectionCorrelation}% and restart mentions correlate ${telemetry.experience.restartCorrectionCorrelation}% with correction signals. The harness should reduce UI friction and restart need.`,
        status: "open",
        patchHint: {
          summary: "Reduce UI-triggered corrections by improving terminal output clarity and restart guidance.",
          files: ["packages/opencode/src/terminal/ui.ts", "packages/opencode/src/harness/session.ts"],
        },
})
    }

    // Early warning proposal: trigger on incipient friction patterns in bootstrap mode
    // This catches issues before they reach standard thresholds
    if (hasEarlyWarnings && bootstrap.isBootstrap) {
      const warningCategories = bootstrap.earlyWarningCategories.join(", ")
      proposals.push({
        id: proposalID("address_early_warning_signals"),
        kind: "code_patch",
        title: "Address early warning signals before escalation",
        confidence: bootstrap.earlyWarningSignals >= 2 ? "high" : "medium",
        rationale:
          `Bootstrap mode detected ${bootstrap.earlyWarningSignals} early warning signal(s) in categories: ${warningCategories}. Effective correction ratio ${bootstrap.effectiveCorrectionRatio.toFixed(1)}% and frustration ratio ${bootstrap.effectiveFrustrationRatio.toFixed(1)}% suggest incipient friction that should be addressed proactively before it escalates.`,
        status: "open",
        patchHint: {
          summary: "Investigate and address early warning patterns in terminal behavior, routing, or UI feedback to prevent escalation.",
          files: ["packages/opencode/src/harness/analyze.ts", "packages/opencode/src/harness/telemetry.ts"],
        },
      })
    }

    const operatorFrictionHighSignal =
      telemetry.experience.highFrictionTurns >= 1 &&
      (telemetry.experience.dialogCorrections + telemetry.experience.dialogFrustration >= 2 ||
        telemetry.experience.correctiveRatio >= 15 ||
        telemetry.experience.frustrationRatio >= 15)

    const tightFrictionSignal =
      telemetry.experience.dialogCorrections >= 1 ||
      telemetry.experience.dialogFrustration >= 1 ||
      telemetry.experience.degradedRuns >= 1 ||
      telemetry.experience.terminalToolErrors >= 1

    if (
      tightFrictionSignal
    ) {
      proposals.push({
        id: proposalID("learn_from_terminal_operator_friction"),
        kind: "code_patch",
        title: "Learn more directly from terminal operator friction",
        confidence:
          telemetry.experience.dialogFrustration >= 2 ||
          telemetry.experience.degradedRuns >= 3 ||
          operatorFrictionHighSignal
            ? "high"
            : "medium",
        rationale: telemetry.frictionDetail
          ? `Terminal friction telemetry shows correction weight ${telemetry.frictionDetail.correctionWeight}, frustration weight ${telemetry.frictionDetail.frustrationWeight}, high-friction weight ${telemetry.frictionDetail.highFrictionWeight}, UI intervention weight ${telemetry.frictionDetail.uiInterventionWeight}, and restart intervention weight ${telemetry.frictionDetail.restartInterventionWeight}. The harness should use these weighted signals to improve routing, review thresholds, or UI behavior.`
          :
          `Recent terminal usage showed ${telemetry.experience.dialogCorrections} corrective user turn(s), ${telemetry.experience.dialogFrustration} frustration signal(s), ${telemetry.experience.degradedRuns} degraded terminal run(s), and ${telemetry.experience.terminalToolErrors} terminal tool failure(s). The harness should digest operator friction more directly and improve routing, guardrails, or UI behavior from those signals.`,
        status: "open",
        patchHint: {
          summary: "Tighten terminal-experience telemetry and use it to improve harness routing, review thresholds, or friction learning behavior.",
          files: [
            "packages/opencode/src/harness/telemetry.ts",
            "packages/opencode/src/harness/analyze.ts",
          ],
        },
      })
    }

    const reviewFallbacks = countObservations(observations, "review.fallback")
    if (reviewFallbacks >= 2) {
      proposals.push({
        id: proposalID("stabilize_adversarial_review"),
        kind: "code_patch",
        title: "Stabilize adversarial review output and fallback handling",
        confidence: "medium",
        rationale:
          "Repeated structured-review fallbacks suggest the harness review lane is still too brittle and should tighten its session/output handling.",
        status: "open",
        patchHint: {
          summary: "Improve review-session reliability, structured output handling, or timeout behavior for adversarial review.",
          files: ["packages/opencode/src/harness/session.ts", "packages/opencode/src/harness/generate.ts"],
        },
      })
    }

    const generationRetries = countObservations(observations, "patch.generation_retry")
    if (generationRetries >= 2) {
      proposals.push({
        id: proposalID("improve_patch_generation_reliability"),
        kind: "code_patch",
        title: "Improve self-edit patch generation reliability",
        confidence: "medium",
        rationale:
          startupStalls >= 2
            ? `Repeated patch-generation retries include ${startupStalls} session_start startup stall(s), which suggests the harness should improve startup resilience, routing, or repair feedback before blaming patch content.`
            : "Repeated patch-generation retries suggest the harness should tighten patch prompts, routing, or repair feedback for self-edits.",
        status: "open",
        patchHint: {
          summary: "Reduce invalid patch generations and repair retries in the harness author lane.",
          files: ["packages/opencode/src/harness/generate.ts", "packages/opencode/src/harness/routing.ts"],
        },
      })
    }

    const autopatchFailures = countObservations(observations, "proposal.autopatch_failed")
    if (autopatchFailures >= 1) {
      proposals.push({
        id: proposalID("harden_autonomous_autopatch"),
        kind: "code_patch",
        title: "Harden autonomous patch promotion",
        confidence: "medium",
        rationale:
          "Autonomous self-edit failures indicate the promotion gates or verification path should be tightened before the harness retries autonomously.",
        status: "open",
        patchHint: {
          summary: "Tighten autonomous autopatch promotion, reporting, or verify requirements after autonomous failures.",
          files: ["packages/opencode/src/harness/verify.ts"],
        },
      })
    }

    return {
      generatedAt: Date.now(),
      scheduler,
      currentOverlay: currentOverlay ?? {},
      queueLatency,
      telemetry,
      observations,
      proposals,
    }
  }
}
