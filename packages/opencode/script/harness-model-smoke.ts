#!/usr/bin/env bun
import { existsSync } from "fs"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { Identifier } from "../src/id/id"
import { Log } from "../src/util/log"
import { Filesystem } from "../src/util/filesystem"
import { HarnessState } from "../src/harness/state"
import { HarnessReview } from "../src/harness/review"
import { HarnessHealer } from "../src/harness/healer"
import { HarnessSelfEdit } from "../src/harness/self-edit"
import { HarnessSessionRules, runReadOnlyHarnessSession } from "../src/harness/session"
import { buildVerifyPlan, type VerifyPlan } from "../src/harness/verify"

type Phase = {
  ok: boolean
  skipped?: boolean
  error?: string
  [key: string]: unknown
}

type SmokeResult = {
  ok: boolean
  mode: "full" | "session-only"
  model: string
  timeoutMS: number
  keepTemp: boolean
  tempRoot: string
  sourceRoot: string
  runtimeRoot: string
  durationMS: number
  phases: {
    init: Phase
    session?: Phase
    review: Phase
    healer: Phase
    selfEdit: Phase
  }
}

const DEFAULT_MODEL = "alibaba-coding-plan/qwen3.6-plus"
const DEFAULT_TIMEOUT_MS = 180_000
const PACKAGE_ROOT = path.join("packages", "opencode")
const TARGET_FILE = path.join(PACKAGE_ROOT, "src", "util", "empty.ts").replaceAll("\\", "/")
const ALIBABA_CODING_PLAN_TOP_MODELS = new Set([
  "alibaba-coding-plan/glm-5",
  "alibaba-coding-plan/kimi-k2.5",
  "alibaba-coding-plan/minimax-m2.5",
  "alibaba-coding-plan/qwen3-coder-plus",
  "alibaba-coding-plan/qwen3.5-plus",
  "alibaba-coding-plan/qwen3.6-plus",
])
const ENV_KEYS = [
  "OPENCODE_HARNESS_ROOT",
  "OPENCODE_HARNESS_SOURCE_ROOT",
  "OPENCODE_HARNESS_MODEL",
  "OPENCODE_HARNESS_TIMEOUT_MS",
  "OPENCODE_HARNESS_WORKER_GENERATION",
  "OPENCODE_HARNESS_UPGRADE_NOTICE",
] as const

function option(name: string) {
  return process.argv.includes(name)
}

function readOptions() {
  const mode: SmokeResult["mode"] =
    process.env.OPENCODE_SMOKE_MODE === "session-only" || option("--session-only") ? "session-only" : "full"
  return {
    mode,
    model: process.env.OPENCODE_HARNESS_MODEL ?? DEFAULT_MODEL,
    timeoutMS: Number(process.env.OPENCODE_HARNESS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    keepTemp: process.env.OPENCODE_SMOKE_KEEP_TEMP === "1" || option("--keep-temp"),
    json: process.env.OPENCODE_SMOKE_JSON_OUTPUT === "1" || option("--json"),
    dryRun: process.env.OPENCODE_SMOKE_DRY_RUN === "1" || option("--dry-run") || option("--help"),
  }
}

function validateAllowedModel(model: string) {
  const normalized = model.toLowerCase()
  const allowed =
    ALIBABA_CODING_PLAN_TOP_MODELS.has(normalized) ||
    (normalized.startsWith("opencode/") && normalized.includes("free")) ||
    (normalized.startsWith("openrouter/") && normalized.includes(":free"))
  if (!allowed) {
    throw new Error(
      `Refusing non-approved smoke model "${model}". Use approved Alibaba coding-plan top models (${[...ALIBABA_CODING_PLAN_TOP_MODELS].join(", ")}), opencode/*free*, or openrouter/*:free.`,
    )
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function withDeadline<T>(label: string, timeoutMS: number, fn: () => Promise<T>) {
  let handle: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        handle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMS}ms`)), timeoutMS)
      }),
    ])
  } finally {
    if (handle) clearTimeout(handle)
  }
}

function fixtureVerifyPlan(patchText: string, command: string): VerifyPlan {
  const base = buildVerifyPlan({
    patchText,
    explicitCommands: [command],
    risk: "small",
  })
  return {
    ...base,
    source: "explicit",
    sources: ["explicit"],
    commands: [command],
    rationale: "Fixture-scoped live smoke verification.",
  }
}

async function seedSourceRoot(sourceRoot: string) {
  const packageRoot = path.join(sourceRoot, PACKAGE_ROOT)
  await mkdir(path.join(packageRoot, "src", "util"), { recursive: true })
  await writeFile(path.join(sourceRoot, "package.json"), JSON.stringify({ name: "opencodex-smoke-root", private: true }))
  await writeFile(path.join(sourceRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }))
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "opencodex-smoke-package", private: true }))
  await writeFile(path.join(packageRoot, "src", "index.ts"), "export {}\n")
  await writeFile(path.join(sourceRoot, TARGET_FILE), 'export const smokeValue = "before"\n')
}

async function seedProposal(proposalID: string) {
  await HarnessState.replaceProposals([
    {
      id: proposalID,
      kind: "code_patch",
      title: "Smoke test review of a temp source patch",
      confidence: "high",
      rationale:
        "Exercise the model-backed OpenCodex harness review and healer paths against a temporary source root only.",
      status: "open",
      risk: "small",
      autonomy: "stage_only",
      expectedFiles: [TARGET_FILE],
      maxFiles: 1,
      maxChangedLines: 10,
      allowMove: false,
      allowDelete: false,
      requirePriorValidation: false,
      patchHint: {
        summary: 'Change smokeValue from "before" to "after" in the temp fixture file.',
        files: [TARGET_FILE],
      },
    },
  ])
}

async function seedPatch(proposalID: string, patchText: string) {
  const dir = path.join(HarnessState.reviewDir(), proposalID)
  await mkdir(dir, { recursive: true })
  await Filesystem.write(path.join(dir, "generated.patch"), patchText)
}

async function runSmoke() {
  const options = readOptions()
  validateAllowedModel(options.model)

  if (options.dryRun) {
    console.log(
      [
        "Harness model smoke dry run",
        `mode=${options.mode}`,
        `model=${options.model}`,
        `timeoutMS=${options.timeoutMS}`,
        "",
        "Run:",
        "  OPENCODE_SMOKE_MODE=session-only OPENCODE_HARNESS_MODEL=openrouter/liquid/lfm-2.5-1.2b-instruct:free bun run script/harness-model-smoke.ts",
      ].join("\n"),
    )
    return { dryRun: true }
  }

  const startedAt = Date.now()
  const previous = new Map<string, string | undefined>()
  for (const key of ENV_KEYS) previous.set(key, process.env[key])

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "opencodex-harness-model-smoke-"))
  const sourceRoot = path.join(tempRoot, "source")
  const runtimeRoot = sourceRoot
  const reviewTracePath = path.join(runtimeRoot, ".opencode", "runtime", "harness", "review-smoke.trace.jsonl")
  const sessionTracePath = path.join(runtimeRoot, ".opencode", "runtime", "harness", "session-only-smoke.trace.jsonl")
  const proposalID = Identifier.ascending("part")
  const patchText = `*** Begin Patch
*** Update File: ${TARGET_FILE}
@@
-export const smokeValue = "before"
+export const smokeValue = "after"
*** End Patch
`

  const result: SmokeResult = {
    ok: false,
    mode: options.mode,
    model: options.model,
    timeoutMS: options.timeoutMS,
    keepTemp: options.keepTemp,
    tempRoot,
    sourceRoot,
    runtimeRoot,
    durationMS: 0,
    phases: {
      init: { ok: false },
      session: options.mode === "session-only" ? { ok: false } : undefined,
      review: { ok: false },
      healer: { ok: false },
      selfEdit: { ok: false },
    },
  }

  try {
    await Log.init({ print: false, level: "ERROR" })
    process.env.OPENCODE_HARNESS_ROOT = runtimeRoot
    process.env.OPENCODE_HARNESS_SOURCE_ROOT = sourceRoot
    delete process.env.OPENCODE_HARNESS_WORKER_GENERATION
    delete process.env.OPENCODE_HARNESS_UPGRADE_NOTICE

    await seedSourceRoot(sourceRoot)
    result.phases.init = { ok: true, proposalID, targetFile: TARGET_FILE }

    if (options.mode === "session-only") {
      const session = await withDeadline("runReadOnlyHarnessSession", options.timeoutMS, () =>
        runReadOnlyHarnessSession({
          title: "Harness minimal live model smoke",
          prompt: [
            "Return exactly this text and nothing else:",
            "VERDICT: APPROVE",
            "SUMMARY: smoke ok",
            "CONCERNS:",
            "- none",
            "VERIFY:",
            "- none",
          ].join("\n"),
          model: options.model,
          lane: "reviewer",
          stage: "review",
          permission: HarnessSessionRules.noTools(),
          timeoutMS: options.timeoutMS,
          tracePath: sessionTracePath,
        }),
      )
      result.phases.session = {
        ok: /VERDICT:\s*APPROVE/i.test(session.raw) && /SUMMARY:\s*smoke ok/i.test(session.raw),
        sessionID: session.sessionID,
        selectedModel: session.selectedModel,
        resolvedModel: session.resolvedModel,
        raw: session.raw,
        tracePath: sessionTracePath,
      }
      result.phases.review = { ok: true, skipped: true }
      result.phases.healer = { ok: true, skipped: true }
      result.phases.selfEdit = { ok: true, skipped: true }
      result.ok = !!result.phases.session.ok
      return result
    }

    await seedProposal(proposalID)
    await seedPatch(proposalID, patchText)

    const review = await withDeadline("HarnessReview.reviewPatch", options.timeoutMS, () =>
      HarnessReview.reviewPatch({
        proposalID,
        model: options.model,
        timeoutMS: options.timeoutMS,
        tracePath: reviewTracePath,
      }),
    )
    result.phases.review = {
      ok: true,
      approved: review.approved,
      verdict: review.verdict,
      summary: review.summary,
      sessionID: review.sessionID,
      reportPath: review.reportPath,
      rawPath: review.rawPath,
      tracePath: reviewTracePath,
    }

    const snapshot = await HarnessState.getSnapshot()
    const proposal = snapshot.proposals.find((item) => item.id === proposalID)
    if (!proposal) throw new Error(`Seeded proposal disappeared: ${proposalID}`)

    const healer = await withDeadline("HarnessHealer.intervene", options.timeoutMS, () =>
      HarnessHealer.intervene({
        proposal,
        phase: "review_repair",
        artifacts: [review.reportPath, review.rawPath, review.patchPath],
        currentModel: options.model,
        reviewDecision: {
          verdict: review.verdict,
          summary: review.summary,
          concerns: review.concerns,
          requiredChanges: review.approved ? [] : review.concerns,
          verifyCommands: review.verifySuggestions,
        },
        timeoutMS: options.timeoutMS,
      }),
    )
    result.phases.healer = {
      ok: true,
      mode: healer?.decision.mode ?? "fallback",
      summary: healer?.decision.summary ?? "Healer returned undefined after fallback artifact write.",
      sessionID: healer?.sessionID,
      effectiveModel: healer?.effectiveModel,
      reportPath: healer?.reportPath,
      rawPath: healer?.rawPath,
    }

    const verifyCommand =
      "bun -e \"const fs=require('fs'); const text=fs.readFileSync('src/util/empty.ts','utf8'); if(!text.includes('after')) process.exit(1)\""
    const selfEdit = await HarnessSelfEdit.execute({
      proposalID,
      patchText,
      verifyPlan: fixtureVerifyPlan(patchText, verifyCommand),
      applyLive: false,
      verifyCommandTimeoutMS: Math.min(options.timeoutMS, 60_000),
    })
    const liveText = await Filesystem.readText(path.join(sourceRoot, TARGET_FILE))
    result.phases.selfEdit = {
      ok: selfEdit.appliedLive === false && liveText.includes('"before"'),
      executionID: selfEdit.executionID,
      shadowPath: selfEdit.shadowPath,
      reportPath: selfEdit.reportPath,
      verifyCommands: selfEdit.verifyCommands,
      liveSourcePreserved: liveText.includes('"before"'),
    }

    result.ok = result.phases.init.ok && result.phases.review.ok && result.phases.healer.ok && result.phases.selfEdit.ok
    return result
  } catch (error) {
    const failed = !result.phases.init.ok
      ? result.phases.init
      : options.mode === "session-only" && result.phases.session && !result.phases.session.ok
        ? result.phases.session
        : !result.phases.review.ok
        ? result.phases.review
        : !result.phases.healer.ok
          ? result.phases.healer
          : result.phases.selfEdit
    failed.error = errorMessage(error)
    return result
  } finally {
    result.durationMS = Date.now() - startedAt
    for (const key of ENV_KEYS) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (!options.keepTemp && existsSync(tempRoot)) {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

const output = await runSmoke()
if ("dryRun" in output) {
  process.exit(0)
}

if (readOptions().json) {
  console.log(JSON.stringify(output, null, 2))
} else {
  console.log("Harness model smoke")
  console.log(`result: ${output.ok ? "PASS" : "FAIL"}`)
  console.log(`model: ${output.model}`)
  console.log(`durationMS: ${output.durationMS}`)
  console.log(`tempRoot: ${output.tempRoot}${output.keepTemp ? "" : " (removed)"}`)
  console.log(JSON.stringify(output.phases, null, 2))
}

process.exit(output.ok ? 0 : 1)
