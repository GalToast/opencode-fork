// @ts-nocheck - TODO: fix after API stabilization
import { Log } from "../src/util/log"
import { Instance } from "../src/project/instance"
import { Session } from "../src/session"
import { SessionPrompt } from "../src/session/prompt"
import { Provider } from "../src/provider/provider"
import { HarnessState } from "../src/harness/state"
import { $ } from "bun"
import { mkdtemp, mkdir, rm } from "fs/promises"
import os from "os"
import path from "path"

const ROOT = process.env.OPENCODE_FREE_BENCH_ROOT
const TURN_COUNT = Number(process.env.OPENCODE_FREE_BENCH_TURNS ?? "3")
const MAX_RETRIES = Number(process.env.OPENCODE_FREE_BENCH_RETRIES ?? "2")
const TURN_TIMEOUT_MS = Number(process.env.OPENCODE_FREE_BENCH_TIMEOUT_MS ?? "120000")
const WORKLOAD_TIMEOUT_MS = Number(process.env.OPENCODE_FREE_BENCH_WORKLOAD_TIMEOUT_MS ?? String(Math.max(TURN_TIMEOUT_MS * 3, 180000)))
const LIMIT = Number(process.env.OPENCODE_FREE_BENCH_LIMIT ?? "0")
const JSON_OUTPUT = process.env.OPENCODE_FREE_BENCH_JSON === "1"
const JSONL_PROGRESS = process.env.OPENCODE_FREE_BENCH_JSONL_PROGRESS !== "0"

type Workload = "exact" | "coding" | "reasoning"

const WORKLOADS = ((process.env.OPENCODE_FREE_BENCH_WORKLOADS ?? "exact,coding,reasoning")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean) as Workload[])

type TurnResult = {
  turn: number
  ok: boolean
  expected: string
  prompt: string
  output: string
  firstDeltaMS?: number
  firstReasoningMS?: number
  firstTextMS?: number
  totalMS: number
}

type WorkloadResult = {
  workload: Workload
  ok: boolean
  turns: TurnResult[]
  avgTotalMS: number
  avgFirstTextMS: number
  avgFirstReasoningMS: number
  error?: string
}

type AgentBakeoffResult = {
  modelID: string
  providerID: "opencode"
  ok: boolean
  workloads: WorkloadResult[]
  avgTotalMS: number
  avgFirstTextMS: number
  avgFirstReasoningMS: number
  error?: string
}

function timestamp() {
  return new Date().toISOString()
}

function progressLine(message: string) {
  if (JSON_OUTPUT) return
  console.log(`[${timestamp()}] ${message}`)
}

function progressJSON(event: Record<string, any>) {
  if (JSONL_PROGRESS) {
    console.log(JSON.stringify({ ts: timestamp(), ...event }))
  }

  void HarnessState.appendObservation({
    time: Date.now(),
    source: "runtime",
    kind: `harness.${event.type}`,
    message: `${event.type} for ${event.modelID ?? "unknown"}${event.workload ? ` (${event.workload})` : ""}${event.error ? `: ${event.error}` : ""}`,
    data: event,
  }).catch(() => {})
}

async function createBenchmarkWorkspace() {
  const root = ROOT ?? (await mkdtemp(path.join(os.tmpdir(), "opencode-free-bakeoff-")))
  await mkdir(root, { recursive: true })
  await $`git init`.cwd(root).quiet()
  await $`git commit --allow-empty -m ${"root commit opencode free bakeoff"}`.cwd(root).quiet()
  return {
    directory: root,
    cleanup: async () => {
      if (ROOT) return
      await rm(root, { recursive: true, force: true }).catch(() => {})
    },
  }
}

function textFromParts(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim()
}

function workloadPrompt(workload: Workload, modelID: string, turn: number) {
  const token = `${workload.toUpperCase()}_${turn}_${modelID.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`
  if (workload === "exact") {
    return {
      expected: `FREE_BAKEOFF_${token}`,
      prompt:
        turn === 1
          ? `Reply with exactly FREE_BAKEOFF_${token} and nothing else.`
          : `Continue the same benchmark. Reply with exactly FREE_BAKEOFF_${token} and nothing else.`,
    }
  }
  if (workload === "coding") {
    return {
      expected: `CODE_${token}: function add(a, b) { return a + b; }`,
      prompt:
        turn === 1
          ? `Reply with exactly CODE_${token}: function add(a, b) { return a + b; } and nothing else.`
          : `Continue the coding benchmark. Reply with exactly CODE_${token}: function add(a, b) { return a + b; } and nothing else.`,
    }
  }
  return {
    expected: `TOTAL_${token}: 65`,
    prompt:
      turn === 1
        ? `A task has three stages taking 20, 15, and 20 minutes with two 5-minute checkpoints between stages. Reply with exactly TOTAL_${token}: 65 and nothing else.`
        : `Continue the reasoning benchmark. Reply with exactly TOTAL_${token}: 65 and nothing else.`,
  }
}

async function runWorkload(modelID: string, workload: Workload, turnCount: number): Promise<WorkloadResult> {
  const session = await Session.create({ title: `opencode-free-bakeoff-${modelID}` })
  const tapID = `opencode_free_bakeoff_${modelID}_${Date.now()}`
  const turns: TurnResult[] = []
  const workloadStartedAt = performance.now()
  let turnStartedAt = 0
  let firstDeltaMS: number | undefined
  let firstReasoningMS: number | undefined
  let firstTextMS: number | undefined
  let currentTurn = 0

  SessionPrompt.registerHarnessResultTap(tapID, (event) => {
    if (event.type !== "assistant.delta") return
    const elapsed = Math.round(performance.now() - turnStartedAt)
    if (firstDeltaMS === undefined) firstDeltaMS = elapsed
    if (event.partType === "reasoning" && firstReasoningMS === undefined) firstReasoningMS = elapsed
    if (event.partType === "text" && firstTextMS === undefined) firstTextMS = elapsed
  })

  try {
    progressLine(`Starting ${workload} workload for ${modelID} (${turnCount} turn${turnCount === 1 ? "" : "s"})`)
    progressJSON({ type: "workload_start", modelID, workload, turnCount })
    for (let turn = 1; turn <= turnCount; turn++) {
      if (performance.now() - workloadStartedAt > WORKLOAD_TIMEOUT_MS) {
        throw new Error(`workload timed out after ${WORKLOAD_TIMEOUT_MS}ms`)
      }
      currentTurn = turn

      let lastError: any = null
      let response: any = null

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        firstDeltaMS = undefined
        firstReasoningMS = undefined
        firstTextMS = undefined
        turnStartedAt = performance.now()

        if (attempt > 0) {
          progressLine(`Retrying turn ${turn} for ${modelID} (attempt ${attempt}/${MAX_RETRIES})`)
          progressJSON({ type: "workload_retry", modelID, workload, turn, attempt })
          // exponential backoff
          await Bun.sleep(1000 * Math.pow(2, attempt - 1))
        }

        try {
          const { expected, prompt } = workloadPrompt(workload, modelID, turn)
          response = await Promise.race([
            SessionPrompt.prompt({
              sessionID: session.id,
              resultTapID: tapID,
              agent: "build",
              model: { providerID: "opencode" as any, modelID },
              parts: [
                {
                  type: "text",
                  text: prompt,
                },
              ],
            }),
            Bun.sleep(TURN_TIMEOUT_MS).then(() => {
              throw new Error(`timed out after ${TURN_TIMEOUT_MS}ms`)
            }),
          ])

          const output = textFromParts(response.parts as any)
          turns.push({
            turn,
            ok: output.includes(expected),
            expected,
            prompt,
            output,
            firstDeltaMS,
            firstReasoningMS,
            firstTextMS,
            totalMS: Math.round(performance.now() - turnStartedAt),
          })
          lastError = null
          break
        } catch (error) {
          lastError = error
          progressLine(`Turn ${turn} failed for ${modelID} (attempt ${attempt}): ${error instanceof Error ? error.message : String(error)}`)
          if (attempt === MAX_RETRIES) throw error
        }
      }

      progressJSON({
        type: "workload_turn_complete",
        modelID,
        workload,
        turn,
        ok: turns.at(-1)?.ok ?? false,
        totalMS: turns.at(-1)?.totalMS ?? 0,
        firstTextMS: turns.at(-1)?.firstTextMS ?? null,
        firstReasoningMS: turns.at(-1)?.firstReasoningMS ?? null,
      })
    }

    const avg = (values: number[]) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0)
    const result = {
      workload,
      ok: turns.every((turn) => turn.ok),
      turns,
      avgTotalMS: avg(turns.map((turn) => turn.totalMS)),
      avgFirstTextMS: avg(turns.map((turn) => turn.firstTextMS ?? turn.totalMS)),
      avgFirstReasoningMS: avg(turns.filter((turn) => typeof turn.firstReasoningMS === "number").map((turn) => turn.firstReasoningMS as number)),
    }
    progressLine(`Finished ${workload} workload for ${modelID}: ok=${result.ok}, avg_total_ms=${result.avgTotalMS}`)
    progressJSON({
      type: "workload_complete",
      modelID,
      workload,
      ok: result.ok,
      avgTotalMS: result.avgTotalMS,
      avgFirstTextMS: result.avgFirstTextMS,
      avgFirstReasoningMS: result.avgFirstReasoningMS,
    })
    return result
  } catch (error) {
    const result = {
      workload,
      ok: false,
      turns,
      avgTotalMS: 0,
      avgFirstTextMS: 0,
      avgFirstReasoningMS: 0,
      error: `${workload} turn ${currentTurn}: ${error instanceof Error ? error.message : String(error)}`,
    }
    progressLine(`Failed ${workload} workload for ${modelID}: ${result.error}`)
    progressJSON({
      type: "workload_failed",
      modelID,
      workload,
      error: result.error,
    })
    return result
  } finally {
    SessionPrompt.unregisterHarnessResultTap(tapID)
    await Session.remove(session.id).catch(() => {})
  }
}

async function runModel(modelID: string): Promise<AgentBakeoffResult> {
  const workloads: WorkloadResult[] = []
  progressLine(`Testing live opencode free model -> ${modelID}`)
  progressJSON({ type: "model_start", modelID })
  for (const workload of WORKLOADS) {
    const turnCount = workload === "exact" ? TURN_COUNT : 1
    workloads.push(await runWorkload(modelID, workload, turnCount))
  }
  const avg = (values: number[]) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0)
  const errors = workloads.map((workload) => workload.error).filter(Boolean) as string[]
  const result = {
    modelID,
    providerID: "opencode" as any as const,
    ok: workloads.every((workload) => workload.ok),
    workloads,
    avgTotalMS: avg(workloads.map((workload) => workload.avgTotalMS).filter((value) => value > 0)),
    avgFirstTextMS: avg(workloads.map((workload) => workload.avgFirstTextMS).filter((value) => value > 0)),
    avgFirstReasoningMS: avg(workloads.map((workload) => workload.avgFirstReasoningMS).filter((value) => value > 0)),
    error: errors.length ? errors.join(" | ") : undefined,
  }
  progressLine(`Completed model ${modelID}: ok=${result.ok}, avg_total_ms=${result.avgTotalMS}`)
  progressJSON({
    type: "model_complete",
    modelID,
    ok: result.ok,
    avgTotalMS: result.avgTotalMS,
    avgFirstTextMS: result.avgFirstTextMS,
    avgFirstReasoningMS: result.avgFirstReasoningMS,
    workloads: result.workloads.map((workload) => ({
      workload: workload.workload,
      ok: workload.ok,
      avgTotalMS: workload.avgTotalMS,
      error: workload.error,
    })),
  })
  return result
}

await Log.init({ print: false })

const results: AgentBakeoffResult[] = []
let discoveredModelCount = 0
let testedModelCount = 0
const workspace = await createBenchmarkWorkspace()
try {
  await Instance.provide({
    directory: workspace.directory,
    fn: async () => {
      const discovered = Object.values((await Provider.getProvider("opencode" as any)).models)
      const selected = (LIMIT > 0 ? discovered.slice(0, LIMIT) : discovered).map((model) => model.id)
      discoveredModelCount = discovered.length
      testedModelCount = selected.length

      if (!selected.length) {
        throw new Error("No zero-cost opencode models were discovered for the live bakeoff.")
      }

      for (const modelID of selected) {
        results.push(await runModel(modelID))
      }
    },
  })
} finally {
  await workspace.cleanup()
}

const ranked = [...results].sort((a, b) => {
  if (Number(b.ok) !== Number(a.ok)) return Number(b.ok) - Number(a.ok)
  return a.avgTotalMS - b.avgTotalMS
})

if (JSON_OUTPUT) {
  console.log(
    JSON.stringify(
      {
        providerID: "opencode" as any,
        discoveredModelCount,
        testedModelCount,
        results: ranked,
      },
      null,
      2,
    ),
  )
} else {
  console.log("OpenCode free-model live bakeoff")
  console.log(`discovered_models: ${discoveredModelCount}`)
  console.log(`tested_models: ${testedModelCount}`)
  console.log(`workloads: ${WORKLOADS.join(", ")}`)
  console.table(
    ranked.map((result) => ({
      model: result.modelID,
      ok: result.ok,
      avg_total_ms: result.avgTotalMS,
      avg_first_text_ms: result.avgFirstTextMS,
      avg_first_reasoning_ms: result.avgFirstReasoningMS || "",
      exact_ok: result.workloads.find((workload) => workload.workload === "exact")?.ok ?? "",
      coding_ok: result.workloads.find((workload) => workload.workload === "coding")?.ok ?? "",
      reasoning_ok: result.workloads.find((workload) => workload.workload === "reasoning")?.ok ?? "",
      error: result.error ?? "",
    })),
  )
}

if (ranked.some((result) => !result.ok)) process.exitCode = 1
