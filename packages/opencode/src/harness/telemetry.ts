import { HarnessState } from "./state"

type Review = {
  fallback: number
  revise: number
  reject: number
  nonApprove: number
  failure: number
  noise: number
}

type Verification = {
  weakValidated: number
  unverifiedLive: number
  failure: number
  weak: number
}

type Routing = {
  staged: number
  validateOnly: number
  skipped: number
  cooldown: number
  noise: number
}

type Retry = {
  generationRetry: number
  timeout: number
  failure: number
  pressure: number
}

type Experience = {
  turns: number
  averageTurnMS: number
  slowTurns: number
  correctionContextWindow: number
  frustrationContextWindow: number
  uiCorrectionCorrelation: number
  restartCorrectionCorrelation: number
  correctionRecoveryTime: number
  frustrationRecoveryTime: number
  highFrictionWindowCount: number
  frictionSignalMomentum: number
  cumulativeFrictionScore: number
  recentFrictionTurns: number
  frictionTrend: "improving" | "stable" | "degrading"
  correctiveRatio: number
  frustrationRatio: number
  highFrictionTurns: number
  correctionStreak: number
  frustrationStreak: number
  uiInterventions: number
  restartInterventions: number
  terminalErrorRate: number
  avgTerminalErrorCount: number
  steerApplied: number
  averageSteerLatencyMS: number
  slowSteers: number
  dialogCorrections: number
  dialogFrustration: number
  uiMentions: number
  restartMentions: number
  terminalRuns: number
  degradedRuns: number
  terminalToolErrors: number
  slowTerminalRuns: number
  disruptiveDeferrals: number
}

type FrictionDetail = {
  correctionWeight: number
  frustrationWeight: number
  highFrictionWeight: number
  uiInterventionWeight: number
  restartInterventionWeight: number
}

type BootstrapMetrics = {
  /** Observation count used to compute bootstrap factor */
  observationCount: number
  /** Bootstrap factor from 0.0 (mature, >100 obs) to 1.0 (bootstrap, <10 obs) */
  bootstrapFactor: number
  /** Whether session is in bootstrap mode (observation count below threshold) */
  isBootstrap: boolean
  /** Effective correction ratio adjusted for bootstrap sensitivity */
  effectiveCorrectionRatio: number
  /** Effective frustration ratio adjusted for bootstrap sensitivity */
  effectiveFrustrationRatio: number
  /** Early warning signals detected before threshold crossing */
  earlyWarningSignals: number
  /** Categories of early warnings detected */
  earlyWarningCategories: string[]
  /** Recommended threshold scaling factor for analyze.ts */
  thresholdScale: number
}

export type TelemetrySummary = {
  kinds: Record<string, number>
  review: Review
  verification: Verification
  routing: Routing
  retry: Retry
  experience: Experience
  frictionDetail: FrictionDetail
  /** NEW: Bootstrap-aware metrics for adaptive threshold scaling */
  bootstrap: BootstrapMetrics
}

function lower(input: unknown) {
  return typeof input === "string" ? input.trim().toLowerCase() : ""
}

function int(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined
}

function countKinds(observations: HarnessState.Observation[]) {
  return observations.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1
    return acc
  }, {})
}

function hasAny(text: string, parts: string[]) {
  return parts.some((part) => text.includes(part))
}

function matchesError(item: HarnessState.Observation, parts: string[]) {
  return hasAny(lower(item.data?.error), parts)
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return Math.round(values.reduce((acc, item) => acc + item, 0) / values.length)
}

/**
 * Compute bootstrap factor using exponential decay.
 * Returns 1.0 for very early sessions (<10 obs), 0.0 for mature sessions (>100 obs).
 * Uses exponential decay: factor = exp(-observations / halfLife)
 * Half-life of 50 observations means:
 * - 10 obs -> factor ≈ 0.82 (still high sensitivity)
 * - 50 obs -> factor ≈ 0.37 (moderate sensitivity)
 * - 100 obs -> factor ≈ 0.14 (low sensitivity)
 */
export function computeBootstrapFactor(observationCount: number): number {
  const halfLife = 50
  if (observationCount <= 0) return 1.0
  if (observationCount >= 150) return 0.0
  return Math.exp(-observationCount / halfLife)
}

/**
 * Compute threshold scale based on bootstrap factor.
 * Early sessions get lower thresholds (more sensitive to signals).
 * Mature sessions use standard thresholds.
 * Returns a multiplier from 0.2 (early) to 1.0 (mature).
 */
export function computeThresholdScale(bootstrapFactor: number): number {
  // Early sessions: bootstrapFactor ≈ 1.0, thresholdScale ≈ 0.2 (lower thresholds)
  // Mature sessions: bootstrapFactor ≈ 0.0, thresholdScale ≈ 1.0 (standard thresholds)
  return 0.2 + 0.8 * (1 - bootstrapFactor)
}

/**
 * Detect early warning signals that haven't crossed thresholds yet.
 * These are patterns that suggest incipient issues before they become severe.
 */
function detectEarlyWarnings(
  dialogTurns: HarnessState.Observation[],
  terminalRuns: HarnessState.Observation[],
  bootstrapFactor: number,
): { signals: number; categories: string[] } {
  const categories: string[] = []
  let signals = 0

  // Only detect early warnings in bootstrap phase (high bootstrapFactor)
  if (bootstrapFactor < 0.3) {
    return { signals: 0, categories: [] }
  }

  // Early correction pattern: any correction in first 10 turns is significant
  const earlyTurns = dialogTurns.slice(0, 10)
  const earlyCorrections = earlyTurns.filter((t) => t.data?.correction === true).length
  if (earlyCorrections >= 1 && earlyTurns.length >= 3) {
    signals++
    categories.push("early_correction_pattern")
  }

  // Correction momentum: corrections appearing in consecutive turns
  for (let i = 0; i < dialogTurns.length - 1; i++) {
    if (dialogTurns[i].data?.correction === true && dialogTurns[i + 1].data?.correction === true) {
      signals++
      categories.push("correction_momentum")
      break
    }
  }

  // Frustration without correction: pure frustration signals
  const pureFrustration = dialogTurns.filter(
    (t) => t.data?.frustration === true && t.data?.correction !== true,
  ).length
  if (pureFrustration >= 1 && dialogTurns.length >= 5) {
    signals++
    categories.push("pure_frustration_signal")
  }

  // Terminal degradation pattern: errors appearing in recent runs
  const recentTerminalRuns = terminalRuns.slice(-3)
  const recentErrors = recentTerminalRuns.filter(
    (r) => (int(r.data?.errorCount) ?? 0) > 0 || (int(r.data?.toolErrorCount) ?? 0) > 0,
  ).length
  if (recentErrors >= 1 && recentTerminalRuns.length >= 2) {
    signals++
    categories.push("terminal_degradation_pattern")
  }

  // High friction correlation: correction + ui/restart in same turn
  const highFrictionTurns = dialogTurns.filter(
    (t) => (t.data?.correction === true || t.data?.frustration === true) &&
           (t.data?.ui === true || t.data?.restart === true),
  ).length
  if (highFrictionTurns >= 1 && dialogTurns.length >= 3) {
    signals++
    categories.push("high_friction_correlation")
  }

  return { signals, categories }
}

export function summarizeTelemetry(observations: HarnessState.Observation[]): TelemetrySummary {
  const kinds = countKinds(observations)
  const revise = observations.filter(
    (item) => item.kind === "review.completed" && lower(item.data?.verdict) === "revise",
  ).length
  const reject = observations.filter(
    (item) => item.kind === "review.completed" && lower(item.data?.verdict) === "reject",
  ).length
  const reviewFailure = observations.filter((item) =>
    item.kind === "proposal.autopatch_failed" && matchesError(item, ["adversarial review returned", "review returned"]),
  ).length
  const weakValidated = observations.filter((item) => {
    if (item.kind !== "self_edit.validated") return false
    const verify = int(item.data?.verifyCommandCount) ?? 0
    return verify <= 1
  }).length
  const unverifiedLive = observations.filter(
    (item) => item.kind === "self_edit.applied" && item.data?.allowUnverifiedLive === true,
  ).length
  const verificationFailure = observations.filter((item) =>
    item.kind === "proposal.autopatch_failed" &&
    matchesError(item, ["verification", "verify", "unverified live", "no verification command"]),
  ).length
  const cooldown = observations.filter(
    (item) => item.kind === "proposal.autopatch_skipped" && lower(item.data?.reason) === "failure_cooldown",
  ).length
  const timeout = observations.filter((item) =>
    item.kind === "proposal.autopatch_failed" && matchesError(item, ["timed out", "timeout"]),
  ).length

  const review = {
    fallback: kinds["review.fallback"] ?? 0,
    revise,
    reject,
    nonApprove: revise + reject,
    failure: reviewFailure,
    noise: (kinds["review.fallback"] ?? 0) + revise + reject + reviewFailure,
  } satisfies Review

  const verification = {
    weakValidated,
    unverifiedLive,
    failure: verificationFailure,
    weak: weakValidated + unverifiedLive + verificationFailure,
  } satisfies Verification

  const routing = {
    staged: kinds["proposal.staged"] ?? 0,
    validateOnly: observations.filter(
      (item) => item.kind === "proposal.autopatch_routed" && lower(item.data?.mode) === "validate_only",
    ).length,
    skipped: kinds["proposal.autopatch_skipped"] ?? 0,
    cooldown,
    noise:
      (kinds["proposal.staged"] ?? 0) +
      observations.filter(
        (item) => item.kind === "proposal.autopatch_routed" && lower(item.data?.mode) === "validate_only",
      ).length +
      (kinds["proposal.autopatch_skipped"] ?? 0),
  } satisfies Routing

  const retry = {
    generationRetry: kinds["patch.generation_retry"] ?? 0,
    timeout,
    failure: kinds["proposal.autopatch_failed"] ?? 0,
    pressure: (kinds["patch.generation_retry"] ?? 0) + timeout,
  } satisfies Retry

  const turnDurations = observations
    .filter((item) => item.kind === "main.turn_completed")
    .map((item) => int(item.data?.elapsedMS))
    .filter((item): item is number => item !== undefined)
  const steerLatencies = observations
    .filter((item) => item.kind === "main.steer_applied")
    .map((item) => int(item.data?.latencyMS))
    .filter((item): item is number => item !== undefined)
  const dialogTurns = observations.filter((item) => item.kind === "dialog.turn_ingress")
  const dialogCorrections = observations.filter(
    (item) => item.kind === "dialog.turn_ingress" && item.data?.correction === true,
  )
  const dialogFrustrations = observations.filter(
    (item) => item.kind === "dialog.turn_ingress" && item.data?.frustration === true,
  )
  const uiMentions = observations.filter((item) => item.kind === "dialog.turn_ingress" && item.data?.ui === true)
  const restartMentions = observations.filter(
    (item) => item.kind === "dialog.turn_ingress" && item.data?.restart === true,
  )
  const terminalRuns = observations.filter((item) => item.kind === "terminal.run_completed")
  const recentTurns = dialogTurns.slice(-5)
  const olderTurns = dialogTurns.slice(0, -5)

  let correctionStreak = 0
  let maxCorrectionStreak = 0
  let frustrationStreak = 0
  let maxFrustrationStreak = 0
  let highFrictionCount = 0
  for (const turn of dialogTurns) {
    if (turn.data?.correction) {
      correctionStreak++
      maxCorrectionStreak = Math.max(maxCorrectionStreak, correctionStreak)
    } else {
      correctionStreak = 0
    }
    if (turn.data?.frustration) {
      frustrationStreak++
      maxFrustrationStreak = Math.max(maxFrustrationStreak, frustrationStreak)
    } else {
      frustrationStreak = 0
    }
    if (
      (turn.data?.correction === true || turn.data?.frustration === true) &&
      (turn.data?.ui === true || turn.data?.restart === true)
    ) {
      highFrictionCount++
    }
  }

  const correctionTimes: number[] = []
  const frustrationTimes: number[] = []
  let uiCorrectionCount = 0
  let restartCorrectionCount = 0
  let correctionRecoverySum = 0
  let correctionRecoveryCount = 0
  let frustrationRecoverySum = 0
  let frustrationRecoveryCount = 0

  for (let i = 1; i < dialogTurns.length; i++) {
    const prev = dialogTurns[i - 1]
    const curr = dialogTurns[i]
    const prevTime = int(prev.data?.elapsedMS) ?? 0
    const currTime = int(curr.data?.elapsedMS) ?? 0
    const delta = currTime - prevTime

    if (prev.data?.correction) {
      correctionTimes.push(i)
      if (curr.data?.ui) uiCorrectionCount++
      if (curr.data?.restart) restartCorrectionCount++
      if (delta > 0) {
        correctionRecoverySum += delta
        correctionRecoveryCount++
      }
    }
    if (prev.data?.frustration) {
      frustrationTimes.push(i)
      if (delta > 0) {
        frustrationRecoverySum += delta
        frustrationRecoveryCount++
      }
    }
  }

  const frictionWindowSize = 5
  let highFrictionWindowCount = 0
  for (let i = 0; i <= dialogTurns.length - frictionWindowSize; i++) {
    const window = dialogTurns.slice(i, i + frictionWindowSize)
    const windowFriction = window.filter(
      (t) => t.data?.correction === true || t.data?.frustration === true,
    ).length
    if (windowFriction >= 3) highFrictionWindowCount++
  }

  const frictionSignalMomentum =
    correctionTimes.length > 0 && frustrationTimes.length > 0
      ? Math.min(correctionTimes.length, frustrationTimes.length) /
        Math.max(correctionTimes.length, frustrationTimes.length)
      : 0

  const recentFrictionScore = recentTurns.reduce((sum, turn) => {
    const hasCorrection = turn.data?.correction === true
    const hasFrustration = turn.data?.frustration === true
    const hasHighFriction = (turn.data?.correction === true || turn.data?.frustration === true) &&
      (turn.data?.ui === true || turn.data?.restart === true)
    return sum + (hasCorrection ? 1 : 0) + (hasFrustration ? 2 : 0) + (hasHighFriction ? 3 : 0)
  }, 0)

  const olderFrictionScore = olderTurns.reduce((sum, turn) => {
    const hasCorrection = turn.data?.correction === true
    const hasFrustration = turn.data?.frustration === true
    const hasHighFriction = (turn.data?.correction === true || turn.data?.frustration === true) &&
      (turn.data?.ui === true || turn.data?.restart === true)
    return sum + (hasCorrection ? 1 : 0) + (hasFrustration ? 2 : 0) + (hasHighFriction ? 3 : 0)
  }, 0)

  const totalErrors = terminalRuns.reduce((sum, run) => sum + (int(run.data?.toolErrorCount) ?? 0), 0)
  const runsWithErrors = terminalRuns.filter(
    (run) => (int(run.data?.errorCount) ?? 0) > 0 || (int(run.data?.toolErrorCount) ?? 0) > 0,
  ).length
  const experience = {
    turns: kinds["main.turn_completed"] ?? 0,
    averageTurnMS: average(turnDurations),
    correctionContextWindow: correctionTimes.length,
    frustrationContextWindow: frustrationTimes.length,
    uiCorrectionCorrelation: correctionTimes.length > 0 ? Math.round((uiCorrectionCount / correctionTimes.length) * 100) : 0,
    restartCorrectionCorrelation: correctionTimes.length > 0 ? Math.round((restartCorrectionCount / correctionTimes.length) * 100) : 0,
    correctionRecoveryTime: correctionRecoveryCount > 0 ? Math.round(correctionRecoverySum / correctionRecoveryCount) : 0,
    frustrationRecoveryTime: frustrationRecoveryCount > 0 ? Math.round(frustrationRecoverySum / frustrationRecoveryCount) : 0,
    highFrictionWindowCount,
    frictionSignalMomentum: Math.round(frictionSignalMomentum * 100),
    cumulativeFrictionScore: recentFrictionScore + olderFrictionScore,
    recentFrictionTurns: recentFrictionScore > 0 ? recentTurns.length : 0,
    frictionTrend: recentFrictionScore > olderFrictionScore ? "degrading" : recentFrictionScore < olderFrictionScore ? "improving" : "stable",
    slowTurns: turnDurations.filter((item) => item >= 30_000).length,
    correctiveRatio: dialogTurns.length > 0 ? Math.round((dialogCorrections.length / dialogTurns.length) * 100) : 0,
    frustrationRatio: dialogTurns.length > 0 ? Math.round((dialogFrustrations.length / dialogTurns.length) * 100) : 0,
    highFrictionTurns: highFrictionCount,
    correctionStreak: maxCorrectionStreak,
    frustrationStreak: maxFrustrationStreak,
    uiInterventions: uiMentions.length,
    restartInterventions: restartMentions.length,
    terminalErrorRate: terminalRuns.length > 0 ? Math.round((runsWithErrors / terminalRuns.length) * 100) : 0,
    avgTerminalErrorCount: terminalRuns.length > 0 ? Math.round((totalErrors / terminalRuns.length) * 10) / 10 : 0,
    steerApplied: kinds["main.steer_applied"] ?? 0,
    averageSteerLatencyMS: average(steerLatencies),
    slowSteers: steerLatencies.filter((item) => item >= 2_500).length,
    dialogCorrections: dialogCorrections.length,
    dialogFrustration: dialogFrustrations.length,
    uiMentions: uiMentions.length,
    restartMentions: restartMentions.length,
    terminalRuns: terminalRuns.length,
    degradedRuns: observations.filter((item) => {
      if (item.kind !== "terminal.run_completed") return false
      return (int(item.data?.errorCount) ?? 0) > 0 || (int(item.data?.toolErrorCount) ?? 0) > 0
    }).length,
    terminalToolErrors: observations.reduce((acc, item) => {
      if (item.kind !== "terminal.run_completed") return acc
      return acc + (int(item.data?.toolErrorCount) ?? 0)
    }, 0),
    slowTerminalRuns: observations.filter((item) => {
      if (item.kind !== "terminal.run_completed") return false
      return (int(item.data?.durationMS) ?? 0) >= 30_000
    }).length,
    disruptiveDeferrals: kinds["proposal.autopatch_deferred"] ?? 0,
  } satisfies Experience

  // Compute bootstrap metrics for adaptive threshold scaling
  const observationCount = observations.length
  const bootstrapFactor = computeBootstrapFactor(observationCount)
  const thresholdScale = computeThresholdScale(bootstrapFactor)
  const earlyWarnings = detectEarlyWarnings(dialogTurns, terminalRuns, bootstrapFactor)

  // Effective ratios adjusted for bootstrap sensitivity
  // In early sessions, lower correction/frustration counts are more significant
  const effectiveCorrectionRatio =
    dialogTurns.length > 0
      ? (dialogCorrections.length / dialogTurns.length) * (1 + bootstrapFactor)
      : 0
  const effectiveFrustrationRatio =
    dialogTurns.length > 0
      ? (dialogFrustrations.length / dialogTurns.length) * (1 + bootstrapFactor)
      : 0

  return {
    kinds,
    review,
    verification: {
      ...verification,
    },
    routing,
    retry: {
      ...retry,
    },
    experience,
    frictionDetail: {
      correctionWeight: dialogCorrections.length,
      frustrationWeight: dialogFrustrations.length,
      highFrictionWeight: highFrictionCount,
      uiInterventionWeight: uiMentions.length,
      restartInterventionWeight: restartMentions.length,
    } as FrictionDetail,
    bootstrap: {
      observationCount,
      bootstrapFactor,
      isBootstrap: observationCount < 50,
      effectiveCorrectionRatio,
      effectiveFrustrationRatio,
      earlyWarningSignals: earlyWarnings.signals,
      earlyWarningCategories: earlyWarnings.categories,
      thresholdScale,
    } satisfies BootstrapMetrics,
  }
}

export function computeFrictionScore(detail: FrictionDetail): number {
  return (
    detail.correctionWeight * 1 +
    detail.frustrationWeight * 1 +
    detail.highFrictionWeight * 1 +
    detail.uiInterventionWeight * 3 +
    detail.restartInterventionWeight * 3
  )
}
