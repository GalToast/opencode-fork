// @ts-nocheck - TODO: fix after API stabilization
import { mkdtemp, mkdir, rm } from "fs/promises"
import os from "os"
import path from "path"
import process from "node:process"
import { Log } from "../src/util/log"
import { Instance } from "../src/project/instance"
import { Provider } from "../src/provider/provider"
import {
  runSeatDelegationBenchmark,
  type SeatDelegationBenchmarkResult,
} from "../src/harness/seat-delegation-benchmark"

const LIMIT = Number(process.env.HARNESS_BENCH_MODEL_LIMIT ?? "0")
const JSON_OUTPUT = process.env.HARNESS_BENCH_JSON === "1"
const JSONL_PROGRESS = process.env.HARNESS_BENCH_JSONL_PROGRESS !== "0"
const CHILD_MODE = process.env.HARNESS_BENCH_CHILD === "1"
const SKIP_CLEANUP = process.env.HARNESS_BENCH_SKIP_CLEANUP === "1" || CHILD_MODE
const CHILD_GRACE_MS = Number(process.env.HARNESS_BENCH_CHILD_GRACE_MS ?? "3000")
const MODEL_POOL = process.env.HARNESS_BENCH_MODEL_POOL ?? "alibaba-coding-plan"
const MODEL_FILTER = (process.env.HARNESS_BENCH_MODEL_IDS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)

type BenchModel = {
  providerID: string
  modelID: string
  name: string
}

function timestamp() {
  return new Date().toISOString()
}

function progressLine(message: string) {
  if (JSON_OUTPUT) return
  console.log(`[${timestamp()}] ${message}`)
}

function progressJSON(event: Record<string, unknown>) {
  if (!JSONL_PROGRESS) return
  console.log(JSON.stringify({ ts: timestamp(), ...event }))
}

async function readStreamLines(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onLine: (line: string) => void,
  label?: string,
) {
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf("\n")
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "")
        buffer = buffer.slice(newlineIndex + 1)
        if (line.trim()) onLine(line)
        newlineIndex = buffer.indexOf("\n")
      }
    }
    buffer += decoder.decode()
    const line = buffer.replace(/\r$/, "").trim()
    if (line) onLine(line)
  } finally {
    if (label) progressJSON({ type: "stream_reader_done", label })
    reader.releaseLock()
  }
}

async function createWorkspace(baseDir: string, scenarioID: string) {
  const directory = path.join(baseDir, scenarioID)
  await mkdir(directory, { recursive: true })
  return directory
}

async function discoverModels(): Promise<BenchModel[]> {
  if (MODEL_POOL === "opencode-free") {
    const discovered = await Provider.listFreeOpencodeModels()
    return discovered.map((model) => ({
      providerID: "opencode" as any,
      modelID: model.id,
      name: model.name ?? model.id,
    }))
  }

  const discovered = Object.values((await Provider.getProvider("alibaba-coding-plan" as any)).models)
  return discovered.map((model) => ({
    providerID: "alibaba-coding-plan" as any,
    modelID: model.id,
    name: model.name ?? model.id,
  }))
}

await Log.init({ print: false })

const instanceRoot = await mkdtemp(path.join(os.tmpdir(), "opencode-seat-delegation-matrix-instance-"))
const benchmarkRoot = await mkdtemp(path.join(os.tmpdir(), "opencode-seat-delegation-matrix-"))

try {
  const results: SeatDelegationBenchmarkResult[] = []
  const failures: Array<{ modelID: string; error: string }> = []

  await Instance.provide({
    directory: instanceRoot,
    fn: async () => {
      const discovered = await discoverModels()
      const filtered = MODEL_FILTER.length ? discovered.filter((model) => MODEL_FILTER.includes(model.modelID)) : discovered
      const selected = LIMIT > 0 ? filtered.slice(0, LIMIT) : filtered

      if (!CHILD_MODE && selected.length > 1) {
        for (const model of selected) {
          progressLine(`Spawning isolated seat delegation child for ${model.providerID}/${model.modelID}`)
          progressJSON({ type: "model_spawn", providerID: model.providerID, modelID: model.modelID, pool: MODEL_POOL })

          const child = Bun.spawn([process.execPath, "run", "script/benchmark-harness-seat-delegation-matrix.ts"], {
            cwd: process.cwd(),
            env: {
              ...process.env,
              HARNESS_BENCH_CHILD: "1",
              HARNESS_BENCH_MODEL_IDS: model.modelID,
              HARNESS_BENCH_MODEL_POOL: MODEL_POOL,
              HARNESS_BENCH_JSON: "1",
              HARNESS_BENCH_JSONL_PROGRESS: "1",
              HARNESS_BENCH_SKIP_CLEANUP: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
          })

          let childFinalJSON = ""
          const stderrLines: string[] = []
          let resolvedExitCode: number | null = null
          const exitPromise = child.exited.then((code) => {
            resolvedExitCode = code
            progressJSON({ type: "child_exit_resolved", providerID: model.providerID, modelID: model.modelID, exitCode: code })
            return code
          })
          const stdoutPromise = readStreamLines(
            child.stdout,
            (line) => {
              try {
                const parsed = JSON.parse(line) as Record<string, unknown>
                if (typeof parsed.type === "string" && typeof parsed.ts === "string") {
                  if (!JSON_OUTPUT) console.log(line)
                  return
                }
                if (typeof parsed.suite === "string") {
                  childFinalJSON = line
                  return
                }
              } catch {
                // fall through
              }
              if (!JSON_OUTPUT) console.log(line)
            },
            `stdout:${model.providerID}/${model.modelID}`,
          ).then(() => {
            progressJSON({ type: "child_stdout_done", providerID: model.providerID, modelID: model.modelID })
          })
          const stderrPromise = readStreamLines(
            child.stderr,
            (line) => {
              stderrLines.push(line)
              if (!JSON_OUTPUT) console.error(line)
            },
            `stderr:${model.providerID}/${model.modelID}`,
          ).then(() => {
            progressJSON({ type: "child_stderr_done", providerID: model.providerID, modelID: model.modelID })
          })

          let exitCode = await Promise.race([
            exitPromise,
            (async () => {
              while (!childFinalJSON) {
                await Bun.sleep(100)
              }
              return null
            })(),
          ])

          if (exitCode === null) {
            progressJSON({ type: "child_result_seen_before_exit", providerID: model.providerID, modelID: model.modelID })
            await Promise.race([
              exitPromise,
              Bun.sleep(CHILD_GRACE_MS).then(() => {
                if (resolvedExitCode === null) {
                  progressJSON({
                    type: "child_forced_close_after_result",
                    providerID: model.providerID,
                    modelID: model.modelID,
                    graceMS: CHILD_GRACE_MS,
                  })
                  child.kill()
                }
              }),
            ])
            exitCode = resolvedExitCode ?? 0
          }

          await Promise.race([
            Promise.all([stdoutPromise, stderrPromise]),
            Bun.sleep(1000).then(() => {
              progressJSON({ type: "child_stream_drain_timeout", providerID: model.providerID, modelID: model.modelID })
            }),
          ])

          progressJSON({ type: "child_wait_complete", providerID: model.providerID, modelID: model.modelID, exitCode })
          const stderr = stderrLines.join("\n")
          if (!childFinalJSON && exitCode !== 0) {
            const message = stderr.trim() || `child exited with code ${exitCode}`
            failures.push({ modelID: `${model.providerID}/${model.modelID}`, error: message })
            progressLine(`Failed seat delegation benchmark for ${model.providerID}/${model.modelID}: ${message}`)
            progressJSON({ type: "model_failed", providerID: model.providerID, modelID: model.modelID, error: message })
            continue
          }

          try {
            progressJSON({ type: "child_parse_start", providerID: model.providerID, modelID: model.modelID, hasFinalJSON: Boolean(childFinalJSON) })
            const parsed = JSON.parse(childFinalJSON) as {
              results?: SeatDelegationBenchmarkResult[]
              failures?: Array<{ modelID: string; error: string }>
            }
            progressJSON({ type: "child_parse_done", providerID: model.providerID, modelID: model.modelID })
            if (Array.isArray(parsed.results)) results.push(...parsed.results)
            if (Array.isArray(parsed.failures)) failures.push(...parsed.failures)
            const childResult = parsed.results?.[0]
            if (childResult) {
              progressLine(
                `Completed seat delegation benchmark for ${model.providerID}/${model.modelID}: strict_lift=${childResult.qualityLift}, semantic_accuracy=${Math.round(childResult.semanticAccuracy * 100)}%`,
              )
              progressJSON({
                type: "model_complete",
                providerID: model.providerID,
                modelID: model.modelID,
                qualityLift: childResult.qualityLift,
                looseQualityLift: childResult.looseQualityLift,
                semanticAccuracy: childResult.semanticAccuracy,
                baselineAccuracy: childResult.baselineAccuracy,
                averageLatencyDeltaMS: childResult.averageLatencyDeltaMS,
              })
            }
          } catch (error) {
            const message = `failed to parse child output: ${error instanceof Error ? error.message : String(error)}`
            failures.push({ modelID: `${model.providerID}/${model.modelID}`, error: message })
            progressLine(`Failed seat delegation benchmark for ${model.providerID}/${model.modelID}: ${message}`)
            progressJSON({ type: "model_failed", providerID: model.providerID, modelID: model.modelID, error: message })
          }
          progressJSON({ type: "model_loop_advance", providerID: model.providerID, modelID: model.modelID })
        }
        return
      }

      for (const model of selected) {
        progressLine(`Running seat delegation benchmark for ${model.providerID}/${model.modelID}`)
        progressJSON({ type: "model_start", providerID: model.providerID, modelID: model.modelID, pool: MODEL_POOL })
        const modelRoot = path.join(benchmarkRoot, `${model.providerID}__${model.modelID}`.replace(/[^a-z0-9._-]+/gi, "_"))
        try {
          const result = await runSeatDelegationBenchmark({
            benchmarkModel: { providerID: model.providerID, modelID: model.modelID },
            prepareWorkspace: (scenarioID) => createWorkspace(modelRoot, scenarioID),
            onProgress: (event) => {
              progressJSON({
                providerID: model.providerID,
                modelID: model.modelID,
                ...event,
              })
            },
          })
          results.push(result)
          progressLine(
            `Completed seat delegation benchmark for ${model.providerID}/${model.modelID}: strict_lift=${result.qualityLift}, semantic_accuracy=${Math.round(result.semanticAccuracy * 100)}%`,
          )
          progressJSON({
            type: "model_complete",
            providerID: model.providerID,
            modelID: model.modelID,
            qualityLift: result.qualityLift,
            looseQualityLift: result.looseQualityLift,
            semanticAccuracy: result.semanticAccuracy,
            baselineAccuracy: result.baselineAccuracy,
            averageLatencyDeltaMS: result.averageLatencyDeltaMS,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          failures.push({ modelID: `${model.providerID}/${model.modelID}`, error: message })
          progressLine(`Failed seat delegation benchmark for ${model.providerID}/${model.modelID}: ${message}`)
          progressJSON({ type: "model_failed", providerID: model.providerID, modelID: model.modelID, error: message })
        }
      }
    },
  })

  const ranked = [...results].sort((a, b) => {
    if (b.looseQualityLift !== a.looseQualityLift) return b.looseQualityLift - a.looseQualityLift
    if (b.qualityLift !== a.qualityLift) return b.qualityLift - a.qualityLift
    if (b.semanticAccuracy !== a.semanticAccuracy) return b.semanticAccuracy - a.semanticAccuracy
    return a.averageLatencyDeltaMS - b.averageLatencyDeltaMS
  })

  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify({
        suite: "seat_delegation_judgment_matrix",
        modelCount: ranked.length,
        failedModelCount: failures.length,
        failures,
        results: ranked,
      }),
    )
  } else {
    console.log("Seat-agent delegation matrix")
    console.log(`tested_models: ${ranked.length}`)
    if (failures.length) {
      console.log(`failed_models: ${failures.length}`)
      console.table(failures)
    }
    console.table(
      ranked.map((result) => ({
        model: result.benchmarkModel.modelID,
        provider: result.benchmarkModel.providerID,
        strict_lift: result.qualityLift,
        loose_lift: result.looseQualityLift,
        contract_lift: result.contractViolationLift,
        decision_lift: result.decisionLift,
        baseline_accuracy: `${Math.round(result.baselineAccuracy * 100)}%`,
        semantic_accuracy: `${Math.round(result.semanticAccuracy * 100)}%`,
        baseline_loose_accuracy: `${Math.round(result.baselineLooseAccuracy * 100)}%`,
        semantic_loose_accuracy: `${Math.round(result.semanticLooseAccuracy * 100)}%`,
        baseline_contract_violations: result.baselineContractViolationCount,
        semantic_contract_violations: result.semanticContractViolationCount,
        baseline_decision_misses: result.baselineDecisionMissCount,
        semantic_decision_misses: result.semanticDecisionMissCount,
        solo_lift: result.categorySummary.find((item) => item.category === "solo")?.qualityLift ?? 0,
        parallel_lift: result.categorySummary.find((item) => item.category === "parallel")?.qualityLift ?? 0,
        delegate_lift: result.categorySummary.find((item) => item.category === "delegate")?.qualityLift ?? 0,
        context_lift: result.categorySummary.find((item) => item.category === "context")?.qualityLift ?? 0,
        medium_lift: result.difficultySummary.find((item) => item.difficulty === "medium")?.qualityLift ?? 0,
        hard_lift: result.difficultySummary.find((item) => item.difficulty === "hard")?.qualityLift ?? 0,
        avg_latency_delta_ms: result.averageLatencyDeltaMS,
      })),
    )
  }

  if (failures.length || ranked.some((result) => result.semanticCorrectCount < result.baselineCorrectCount)) process.exitCode = 1
} finally {
  if (!SKIP_CLEANUP) {
    progressJSON({ type: "cleanup_start", scope: "seat_delegation_matrix" })
    await rm(benchmarkRoot, { recursive: true, force: true }).catch(() => {})
    await rm(instanceRoot, { recursive: true, force: true }).catch(() => {})
    progressJSON({ type: "cleanup_done", scope: "seat_delegation_matrix" })
  } else {
    progressJSON({ type: "cleanup_skipped", scope: "seat_delegation_matrix" })
  }
}
