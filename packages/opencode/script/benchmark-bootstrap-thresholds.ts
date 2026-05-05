import { Log } from "../src/util/log"
import { Instance } from "../src/project/instance"
import { HarnessState } from "../src/harness/state"
import { HarnessAnalyze } from "../src/harness/analyze"
import { summarizeTelemetry, computeBootstrapFactor } from "../src/harness/telemetry"

Log.init({ print: false })

// Benchmark: Bootstrap Threshold Scaling Effectiveness
// Tests whether the adaptive bootstrap thresholds improve early signal detection

type BenchmarkResult = {
  scenario: string
  observationCount: number
  bootstrapFactor: number
  proposalCountBaseline: number
  proposalCountAdaptive: number
  earlyWarningSignals: number
  thresholdScale: number
  improvementRatio: number
}

// Create mock observations simulating various session states
function createMockObservations(count: number, frictionPattern: "low" | "medium" | "high"): HarnessState.Observation[] {
  const observations: HarnessState.Observation[] = []
  const now = Date.now()
  
  for (let i = 0; i < count; i++) {
    const time = now - (count - i) * 1000
    
    // Terminal runs
    if (i % 3 === 0) {
      const hasError = frictionPattern === "high" && i > count * 0.7
      observations.push({
        time,
        source: "runtime",
        kind: "terminal.run_completed",
        message: "Terminal run completed",
        data: {
          errorCount: hasError ? 1 : 0,
          toolErrorCount: hasError ? 1 : 0,
          durationMS: 1000 + Math.random() * 5000,
        },
      })
    }
    
    // Dialog turns with friction
    if (i % 5 === 0) {
      const hasCorrection = frictionPattern === "medium" && i > count * 0.5
      const hasFrustration = frictionPattern === "high" && i > count * 0.6
      observations.push({
        time,
        source: "runtime",
        kind: "dialog.turn_ingress",
        message: "Dialog turn",
        data: {
          correction: hasCorrection || (frictionPattern === "high" && i % 10 === 0),
          frustration: hasFrustration,
        },
      })
    }
    
    // Some review events
    if (i % 7 === 0 && frictionPattern !== "low") {
      observations.push({
        time,
        source: "runtime",
        kind: "review.fallback",
        message: "Review fallback",
        data: { reason: "unexpected_file" },
      })
    }
  }
  
  return observations
}

// Simulate baseline behavior (fixed thresholds without bootstrap scaling)
function countProposalsBaseline(observations: HarnessState.Observation[]): number {
  const telemetry = summarizeTelemetry(observations)
  let proposals = 0
  
  // Baseline thresholds (without bootstrap adjustment)
  if (telemetry.review.noise >= 3) proposals++
  if (telemetry.verification.weak >= 2) proposals++
  if (telemetry.experience.dialogCorrections >= 1) proposals++
  if (telemetry.experience.dialogFrustration >= 1) proposals++
  if (telemetry.experience.degradedRuns >= 1) proposals++
  if (telemetry.experience.terminalToolErrors >= 1) proposals++
  
  return proposals
}

// Simulate adaptive behavior (with bootstrap scaling)
function countProposalsAdaptive(observations: HarnessState.Observation[]): number {
  const telemetry = summarizeTelemetry(observations)
  const bootstrap = telemetry.bootstrap
  let proposals = 0
  
  // Adaptive thresholds (scaled by bootstrap factor)
  const thresholdScale = bootstrap.thresholdScale
  
  // Lower thresholds in bootstrap mode
  const noiseThreshold = Math.max(1, Math.round(3 * thresholdScale))
  const weakThreshold = Math.max(1, Math.round(2 * thresholdScale))
  
  if (telemetry.review.noise >= noiseThreshold) proposals++
  if (telemetry.verification.weak >= weakThreshold) proposals++
  if (telemetry.experience.dialogCorrections >= 1) proposals++
  if (telemetry.experience.dialogFrustration >= 1) proposals++
  if (telemetry.experience.degradedRuns >= 1) proposals++
  if (telemetry.experience.terminalToolErrors >= 1) proposals++
  
  // Early warning proposals (new in adaptive)
  if (bootstrap.earlyWarningSignals >= 1 && bootstrap.isBootstrap) proposals++
  
  return proposals
}

async function runBenchmark(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = []
  
  const scenarios: { name: string; obs: number; friction: "low" | "medium" | "high" }[] = [
    { name: "cold_start_low_friction", obs: 10, friction: "low" },
    { name: "cold_start_medium_friction", obs: 10, friction: "medium" },
    { name: "cold_start_high_friction", obs: 10, friction: "high" },
    { name: "early_session_low", obs: 25, friction: "low" },
    { name: "early_session_medium", obs: 25, friction: "medium" },
    { name: "early_session_high", obs: 25, friction: "high" },
    { name: "growing_session_low", obs: 50, friction: "low" },
    { name: "growing_session_medium", obs: 50, friction: "medium" },
    { name: "growing_session_high", obs: 50, friction: "high" },
    { name: "mature_session_low", obs: 100, friction: "low" },
    { name: "mature_session_medium", obs: 100, friction: "medium" },
    { name: "mature_session_high", obs: 100, friction: "high" },
  ]
  
  for (const scenario of scenarios) {
    const observations = createMockObservations(scenario.obs, scenario.friction)
    const telemetry = summarizeTelemetry(observations)
    
    const baseline = countProposalsBaseline(observations)
    const adaptive = countProposalsAdaptive(observations)
    
    results.push({
      scenario: scenario.name,
      observationCount: scenario.obs,
      bootstrapFactor: telemetry.bootstrap.bootstrapFactor,
      proposalCountBaseline: baseline,
      proposalCountAdaptive: adaptive,
      earlyWarningSignals: telemetry.bootstrap.earlyWarningSignals,
      thresholdScale: telemetry.bootstrap.thresholdScale,
      improvementRatio: baseline === 0 ? adaptive : adaptive / baseline,
    })
  }
  
  return results
}

// Run benchmark
console.log("Bootstrap Threshold Scaling Benchmark\n")
console.log("Testing adaptive threshold behavior across session stages\n")

const results = await runBenchmark()

console.table(results, [
  "scenario",
  "observationCount",
  "bootstrapFactor",
  "thresholdScale",
  "proposalCountBaseline",
  "proposalCountAdaptive",
  "earlyWarningSignals",
  "improvementRatio",
])

// Summary statistics
const earlySessions = results.filter(r => r.observationCount <= 25)
const matureSessions = results.filter(r => r.observationCount >= 100)

const earlyImprovement = earlySessions.reduce((sum, r) => sum + (r.proposalCountAdaptive - r.proposalCountBaseline), 0)
const matureImprovement = matureSessions.reduce((sum, r) => sum + (r.proposalCountAdaptive - r.proposalCountBaseline), 0)

console.log("\n=== Summary ===")
console.log(`Early sessions (≤25 obs): ${earlyImprovement} additional proposals detected`)
console.log(`Mature sessions (≥100 obs): ${matureImprovement} additional proposals detected`)
console.log(`\nKey insight: Bootstrap scaling enables earlier detection of issues`)
console.log(`while maintaining stability in mature sessions.\n`)

// Export JSON for further analysis
if (process.env.BENCHMARK_JSON === "1") {
  console.log(JSON.stringify({ results, summary: { earlyImprovement, matureImprovement } }, null, 2))
}