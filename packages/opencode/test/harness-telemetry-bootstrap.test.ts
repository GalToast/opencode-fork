import { describe, test, expect } from "bun:test"
import { summarizeTelemetry, computeBootstrapFactor } from "../src/harness/telemetry"
import type { HarnessState } from "../src/harness/state"

// Helper to create mock observations
function createMockObservation(kind: string, data?: Record<string, unknown>): HarnessState.Observation {
  return {
    time: Date.now(),
    source: "runtime",
    kind,
    message: `Test observation: ${kind}`,
    data,
  }
}

describe("computeBootstrapFactor", () => {
  test("returns 1.0 for zero observations", () => {
    expect(computeBootstrapFactor(0)).toBe(1.0)
  })

  test("returns 0.0 for mature sessions (150+ observations)", () => {
    expect(computeBootstrapFactor(150)).toBe(0.0)
    expect(computeBootstrapFactor(200)).toBe(0.0)
    expect(computeBootstrapFactor(1000)).toBe(0.0)
  })

  test("exponential decay behavior", () => {
    // At half-life (50), factor should be ~0.37
    const factor50 = computeBootstrapFactor(50)
    expect(factor50).toBeGreaterThan(0.3)
    expect(factor50).toBeLessThan(0.4)

    // At 10 observations, should still be high (bootstrap)
    const factor10 = computeBootstrapFactor(10)
    expect(factor10).toBeGreaterThan(0.8)

    // At 100 observations, should be low (near mature)
    const factor100 = computeBootstrapFactor(100)
    expect(factor100).toBeLessThan(0.2)
  })

  test("monotonically decreasing", () => {
    for (let i = 1; i < 149; i++) {
      const current = computeBootstrapFactor(i)
      const next = computeBootstrapFactor(i + 1)
      expect(current).toBeGreaterThanOrEqual(next)
    }
  })
})

describe("summarizeTelemetry bootstrap metrics", () => {
  test("bootstrap metrics are present in telemetry summary", () => {
    const observations: HarnessState.Observation[] = [
      createMockObservation("terminal.run_completed", { errorCount: 0, toolErrorCount: 0, durationMS: 1000 }),
      createMockObservation("main.dialog_correction", { turn: 1 }),
    ]

    const telemetry = summarizeTelemetry(observations)
    expect(telemetry.bootstrap).toBeDefined()
    expect(telemetry.bootstrap.observationCount).toBe(2)
    expect(telemetry.bootstrap.bootstrapFactor).toBeGreaterThan(0.9) // Very early session
    expect(telemetry.bootstrap.isBootstrap).toBe(true)
  })

  test("mature session has low bootstrap factor", () => {
    const observations: HarnessState.Observation[] = []
    for (let i = 0; i < 200; i++) {
      observations.push(createMockObservation("terminal.run_completed", { errorCount: 0, toolErrorCount: 0, durationMS: 1000 }))
    }

    const telemetry = summarizeTelemetry(observations)
    expect(telemetry.bootstrap.bootstrapFactor).toBe(0.0)
    expect(telemetry.bootstrap.isBootstrap).toBe(false)
    expect(telemetry.bootstrap.thresholdScale).toBe(1.0) // Standard thresholds
  })

  test("bootstrap session has lower threshold scale", () => {
    const observations: HarnessState.Observation[] = [
      createMockObservation("terminal.run_completed", { errorCount: 0, toolErrorCount: 0, durationMS: 1000 }),
      createMockObservation("main.dialog_correction", { turn: 1 }),
      createMockObservation("main.dialog_frustration", { turn: 2 }),
    ]

    const telemetry = summarizeTelemetry(observations)
    expect(telemetry.bootstrap.thresholdScale).toBeLessThan(0.5) // Early session = lower thresholds
  })

  test("effective ratios are amplified in bootstrap mode", () => {
    // 1 correction in 5 turns = 20% correction ratio
    // In bootstrap mode, this should be amplified
    const observations: HarnessState.Observation[] = [
      createMockObservation("terminal.run_completed", { errorCount: 0, toolErrorCount: 0, durationMS: 1000 }),
      createMockObservation("dialog.turn_ingress", { correction: true }),
      createMockObservation("dialog.turn_ingress", { correction: false }),
      createMockObservation("dialog.turn_ingress", { correction: false }),
      createMockObservation("dialog.turn_ingress", { correction: false }),
    ]

    const telemetry = summarizeTelemetry(observations)
    // Standard ratio would be 25%, but bootstrap amplifies it
    // effectiveCorrectionRatio is 0-2 range, correctiveRatio is 0-100 percentage
    // Convert effective to percentage for comparison: effective * 100 > correctiveRatio
    const effectiveAsPercentage = telemetry.bootstrap.effectiveCorrectionRatio * 100
    expect(effectiveAsPercentage).toBeGreaterThan(telemetry.experience.correctiveRatio)
  })

  test("early warning signals detected before threshold crossing", () => {
    // Create scenario with incipient friction pattern
    const observations: HarnessState.Observation[] = [
      createMockObservation("terminal.run_completed", { errorCount: 0, toolErrorCount: 0, durationMS: 1000 }),
      createMockObservation("terminal.run_completed", { errorCount: 1, toolErrorCount: 1, durationMS: 5000 }),
      createMockObservation("terminal.run_completed", { errorCount: 2, toolErrorCount: 2, durationMS: 10000 }),
      createMockObservation("dialog.turn_ingress", { correction: true }),
      createMockObservation("dialog.turn_ingress", { ui: true }),
    ]

    const telemetry = summarizeTelemetry(observations)
    expect(telemetry.bootstrap.earlyWarningSignals).toBeGreaterThan(0)
    expect(telemetry.bootstrap.earlyWarningCategories.length).toBeGreaterThan(0)
  })

  test("no early warnings in healthy session", () => {
    const observations: HarnessState.Observation[] = []
    for (let i = 0; i < 10; i++) {
      observations.push(createMockObservation("terminal.run_completed", { errorCount: 0, toolErrorCount: 0, durationMS: 1000 }))
    }

    const telemetry = summarizeTelemetry(observations)
    expect(telemetry.bootstrap.earlyWarningSignals).toBe(0)
    expect(telemetry.bootstrap.earlyWarningCategories.length).toBe(0)
  })
})

describe("adaptive threshold behavior", () => {
  test("bootstrap mode enables earlier signal detection", () => {
    // Create scenario with 1 correction in early session
    // Standard threshold would not trigger, but bootstrap should
    // Need at least 3 dialog turns to trigger early_warning detection
    const observations: HarnessState.Observation[] = [
      createMockObservation("terminal.run_completed", { errorCount: 0, toolErrorCount: 0, durationMS: 1000 }),
      createMockObservation("dialog.turn_ingress", { correction: true }),
      createMockObservation("dialog.turn_ingress", { correction: false }),
      createMockObservation("dialog.turn_ingress", { correction: false }),
    ]

    const telemetry = summarizeTelemetry(observations)
    
    // In bootstrap mode, even 1 correction should trigger early warning
    expect(telemetry.bootstrap.isBootstrap).toBe(true)
    expect(telemetry.bootstrap.earlyWarningSignals).toBeGreaterThanOrEqual(1)
  })
})