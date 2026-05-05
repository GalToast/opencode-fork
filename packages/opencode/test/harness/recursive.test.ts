// @ts-nocheck
import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { mkdir } from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Process } from "../../src/util/process"
import { Filesystem } from "../../src/util/filesystem"
import { HarnessAnalyze } from "../../src/harness/analyze"
import { HarnessState } from "../../src/harness/state"
import {
  assessPromptProof,
  diagnosisProposalID,
  HarnessRecursive,
  pickRecursiveProposals,
  promptPromotionDecision,
  recursiveCycleID,
  shouldAutoStartRecursive,
  summarizePromptDelta,
} from "../../src/harness/recursive"

describe("recursive harness controller", () => {
  test("prefers small high-confidence open code patches for micro adaptations", () => {
    const picked = pickRecursiveProposals([
      {
        id: "c",
        kind: "code_patch",
        title: "Large medium",
        confidence: "medium",
        rationale: "x",
        status: "open",
        risk: "large",
      },
      {
        id: "a",
        kind: "code_patch",
        title: "Small high",
        confidence: "high",
        rationale: "x",
        status: "open",
        risk: "small",
      },
      {
        id: "b",
        kind: "config_overlay",
        title: "Overlay",
        confidence: "high",
        rationale: "x",
        status: "open",
      },
      {
        id: "d",
        kind: "code_patch",
        title: "Dismissed",
        confidence: "high",
        rationale: "x",
        status: "dismissed",
      },
    ] as any)
    expect(picked.map((item) => item.id)).toEqual(["a"])
  })

  test("summarizes prompt benchmark deltas per model", () => {
    expect(
      summarizePromptDelta(
        {
          results: [
            {
              benchmarkModel: { providerID: "alibaba-coding-plan" as any, modelID: "glm-5" as any },
              accuracy: 0.5,
              looseAccuracy: 0.75,
              averageLatencyMS: 1000,
            },
          ],
          recommendations: [],
        } as any,
        {
          results: [
            {
              benchmarkModel: { providerID: "alibaba-coding-plan" as any, modelID: "glm-5" as any },
              accuracy: 0.75,
              looseAccuracy: 1,
              averageLatencyMS: 800,
            },
          ],
          recommendations: [],
        } as any,
      ),
    ).toEqual([
      {
        model: "alibaba-coding-plan/glm-5",
        strictDelta: 0.25,
        looseDelta: 0.25,
        latencyDeltaMS: -200,
      },
    ])
  })

  test("classifies benchmark proof from prompt deltas", () => {
    expect(
      assessPromptProof([
        {
          model: "opencode/minimax-m2.5-free",
          strictDelta: 0.25,
          looseDelta: 0.25,
          latencyDeltaMS: -50,
        },
      ]),
    ).toEqual({
      status: "improved",
      improvedModels: ["opencode/minimax-m2.5-free"],
      regressedModels: [],
      stableModels: [],
    })
    expect(
      assessPromptProof([
        {
          model: "opencode/minimax-m2.5-free",
          strictDelta: 0,
          looseDelta: 0,
          latencyDeltaMS: 20,
        },
      ]),
    ).toEqual({
      status: "non_regressed",
      improvedModels: [],
      regressedModels: [],
      stableModels: ["opencode/minimax-m2.5-free"],
    })
  })

  test("requires marked benchmark improvement before keeping a live patch", () => {
    expect(
      promptPromotionDecision([
        {
          model: "alibaba-coding-plan/glm-5",
          strictDelta: 0.01,
          looseDelta: 0.01,
          latencyDeltaMS: -25,
        },
      ]),
    ).toEqual({
      keep: false,
      reason: "Benchmark changes were too small to count as a marked improvement.",
    })
    expect(
      promptPromotionDecision([
        {
          model: "alibaba-coding-plan/glm-5",
          strictDelta: 0.05,
          looseDelta: 0.05,
          latencyDeltaMS: -10,
        },
      ]),
    ).toEqual({
      keep: true,
      reason: "Marked improvement confirmed for alibaba-coding-plan/glm-5.",
    })
  })

  test("startup only auto-runs for interactive supervisor launches", () => {
    expect(shouldAutoStartRecursive({ cliArgs: [], role: "supervisor_stable" })).toBe(true)
    expect(shouldAutoStartRecursive({ cliArgs: ["run", "fix this"], role: "cli_run" })).toBe(true)
    expect(shouldAutoStartRecursive({ cliArgs: ["debug", "recursive"], role: "cli_debug" })).toBe(false)
    expect(shouldAutoStartRecursive({ cliArgs: ["serve"], role: "cli_serve" })).toBe(false)
    expect(shouldAutoStartRecursive({ cliArgs: [], role: "tui_worker" })).toBe(false)
  })

  test("generates valid part ids for recursive cycles", () => {
    expect(recursiveCycleID()).toStartWith("prt_")
  })

  test("generates valid part ids for diagnosed proposals", () => {
    expect(diagnosisProposalID("Improve Prompt Reliability")).toBe("prt_diag_improve_prompt_reliability")
  })

  test("can drive a cycle through the opencode run worker mode", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await mkdir(path.join(dir, "packages", "opencode", "src"), { recursive: true })
        await Bun.write(path.join(dir, "package.json"), JSON.stringify({ name: "tmp-opencode" }))
        await Bun.write(path.join(dir, "bunfig.toml"), "")
        await Bun.write(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }))
        await Bun.write(path.join(dir, "packages", "opencode", "src", "index.ts"), "export {}\n")
        await Bun.write(path.join(dir, "packages", "opencode", "src", "example.ts"), "export const x = 1\n")
      },
    })

    const prevRoot = process.env.OPENCODE_HARNESS_ROOT
    const prevSource = process.env.OPENCODE_HARNESS_SOURCE_ROOT
    process.env.OPENCODE_HARNESS_ROOT = tmp.path
    process.env.OPENCODE_HARNESS_SOURCE_ROOT = tmp.path

    const analyzeSpy = spyOn(HarnessAnalyze, "build").mockResolvedValue({
      proposals: [],
      observations: [],
    } as any)
    const replaceSpy = spyOn(HarnessState, "replaceProposals").mockResolvedValue(undefined as never)
    const snapshotSpy = spyOn(HarnessState, "getSnapshot").mockResolvedValue({ proposals: [] } as any)
    const obsSpy = spyOn(HarnessState, "appendObservation").mockResolvedValue(undefined as never)
    const runSpy = spyOn(Process, "run").mockResolvedValue({
      code: 0,
      stdout: Buffer.from('{"type":"text"}\n'),
      stderr: Buffer.from(""),
    })
    const readSpy = spyOn(Filesystem, "readJson").mockImplementation(async (file: string) => {
      if (file.endsWith("worker-report.json")) {
        return {
          summary: "Worker retained one change.",
          keep: false,
          attempts: [
            {
              id: "wrk_fix",
              title: "Fix worker issue",
              category: "stability",
              summary: "Patched and tested.",
              outcome: "retained",
              tests: ["bun test test/harness/recursive.test.ts"],
              benchmarks: [],
            },
          ],
          changedFiles: [],
        } as any
      }
      return undefined as any
    })

    try {
      const result = await HarnessRecursive.cycle({
        workerMode: "run",
        diagnose: false,
        audit: false,
        applyLive: false,
      })

      expect(runSpy).toHaveBeenCalledTimes(1)
      expect(result.selectedProposalIDs).toEqual(["wrk_fix"])
      expect(result.attempts).toHaveLength(1)
      expect(result.attempts[0]?.proposalID).toBe("wrk_fix")
      expect(result.attempts[0]?.status).toBe("validated")
      expect(result.attempts[0]?.reportPath?.endsWith("worker-report.json")).toBe(true)
      const env = runSpy.mock.calls[0]?.[1]?.env
      expect(env?.OPENCODE_CONFIG_CONTENT).toBeDefined()
      expect(JSON.parse(env!.OPENCODE_CONFIG_CONTENT)).toMatchObject({
        lsp: false,
        agent: {
          build: {
            permission: {
              task: "deny",
            },
          },
        },
      })
      expect(obsSpy).toHaveBeenCalled()
    } finally {
      analyzeSpy.mockRestore()
      replaceSpy.mockRestore()
      snapshotSpy.mockRestore()
      obsSpy.mockRestore()
      runSpy.mockRestore()
      readSpy.mockRestore()
      if (prevRoot === undefined) delete process.env.OPENCODE_HARNESS_ROOT
      else process.env.OPENCODE_HARNESS_ROOT = prevRoot
      if (prevSource === undefined) delete process.env.OPENCODE_HARNESS_SOURCE_ROOT
      else process.env.OPENCODE_HARNESS_SOURCE_ROOT = prevSource
    }
  })

  test("rejects worker keep reports that omit proof commands", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await mkdir(path.join(dir, "packages", "opencode", "src"), { recursive: true })
        await Bun.write(path.join(dir, "package.json"), JSON.stringify({ name: "tmp-opencode" }))
        await Bun.write(path.join(dir, "bunfig.toml"), "")
        await Bun.write(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }))
        await Bun.write(path.join(dir, "packages", "opencode", "src", "index.ts"), "export {}\n")
        await Bun.write(path.join(dir, "packages", "opencode", "src", "example.ts"), "export const x = 1\n")
      },
    })

    const prevRoot = process.env.OPENCODE_HARNESS_ROOT
    const prevSource = process.env.OPENCODE_HARNESS_SOURCE_ROOT
    process.env.OPENCODE_HARNESS_ROOT = tmp.path
    process.env.OPENCODE_HARNESS_SOURCE_ROOT = tmp.path

    const analyzeSpy = spyOn(HarnessAnalyze, "build").mockResolvedValue({
      proposals: [],
      observations: [],
    } as any)
    const replaceSpy = spyOn(HarnessState, "replaceProposals").mockResolvedValue(undefined as never)
    const snapshotSpy = spyOn(HarnessState, "getSnapshot").mockResolvedValue({ proposals: [] } as any)
    const obsSpy = spyOn(HarnessState, "appendObservation").mockResolvedValue(undefined as never)
    const runSpy = spyOn(Process, "run").mockResolvedValue({
      code: 0,
      stdout: Buffer.from('{"type":"text"}\n'),
      stderr: Buffer.from(""),
    })
    const readSpy = spyOn(Filesystem, "readJson").mockImplementation(async (file: string) => {
      if (file.endsWith("worker-report.json")) {
        return {
          summary: "Worker retained one change without proof.",
          keep: true,
          attempts: [
            {
              id: "wrk_fix",
              title: "Fix worker issue",
              category: "stability",
              summary: "Patched but forgot proof.",
              outcome: "retained",
              tests: [],
              benchmarks: [],
            },
          ],
          changedFiles: ["packages/opencode/src/example.ts"],
        } as any
      }
      return undefined as any
    })

    try {
      await expect(
        HarnessRecursive.cycle({
          workerMode: "run",
          diagnose: false,
          audit: false,
          applyLive: false,
        }),
      ).rejects.toThrow("without any tests or benchmarks")

      expect(runSpy).toHaveBeenCalledTimes(1)
      expect(obsSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "recursive.cycle_completed",
        }),
      )
    } finally {
      analyzeSpy.mockRestore()
      replaceSpy.mockRestore()
      snapshotSpy.mockRestore()
      obsSpy.mockRestore()
      runSpy.mockRestore()
      readSpy.mockRestore()
      if (prevRoot === undefined) delete process.env.OPENCODE_HARNESS_ROOT
      else process.env.OPENCODE_HARNESS_ROOT = prevRoot
      if (prevSource === undefined) delete process.env.OPENCODE_HARNESS_SOURCE_ROOT
      else process.env.OPENCODE_HARNESS_SOURCE_ROOT = prevSource
    }
  })

  test("falls back to the worker stdout summary when the json report is missing", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await mkdir(path.join(dir, "packages", "opencode", "src"), { recursive: true })
        await Bun.write(path.join(dir, "package.json"), JSON.stringify({ name: "tmp-opencode" }))
        await Bun.write(path.join(dir, "bunfig.toml"), "")
        await Bun.write(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }))
        await Bun.write(path.join(dir, "packages", "opencode", "src", "index.ts"), "export {}\n")
        await Bun.write(path.join(dir, "packages", "opencode", "src", "example.ts"), "export const x = 1\n")
      },
    })

    const prevRoot = process.env.OPENCODE_HARNESS_ROOT
    const prevSource = process.env.OPENCODE_HARNESS_SOURCE_ROOT
    process.env.OPENCODE_HARNESS_ROOT = tmp.path
    process.env.OPENCODE_HARNESS_SOURCE_ROOT = tmp.path

    const analyzeSpy = spyOn(HarnessAnalyze, "build").mockResolvedValue({
      proposals: [],
      observations: [],
    } as any)
    const replaceSpy = spyOn(HarnessState, "replaceProposals").mockResolvedValue(undefined as never)
    const snapshotSpy = spyOn(HarnessState, "getSnapshot").mockResolvedValue({ proposals: [] } as any)
    const obsSpy = spyOn(HarnessState, "appendObservation").mockResolvedValue(undefined as never)
    const runSpy = spyOn(Process, "run").mockResolvedValue({
      code: 0,
      stdout: Buffer.from(
        [
          JSON.stringify({ type: "step_start" }),
          JSON.stringify({
            type: "text",
            part: {
              text: "**Maximum steps for this agent have been reached.**\n\nNo edits were retained in this cycle.",
            },
          }),
          JSON.stringify({ type: "step_finish" }),
        ].join("\n"),
      ),
      stderr: Buffer.from(""),
    })

    try {
      const result = await HarnessRecursive.cycle({
        workerMode: "run",
        diagnose: false,
        audit: false,
        applyLive: false,
      })

      expect(runSpy).toHaveBeenCalledTimes(1)
      expect(result.selectedProposalIDs).toHaveLength(1)
      expect(result.selectedProposalIDs[0]).toEndWith("_worker")
      expect(result.attempts).toHaveLength(1)
      expect(result.attempts[0]?.status).toBe("validated")
      expect(result.attempts[0]?.retained).toBe(false)
      expect(result.attempts[0]?.title).toContain("Maximum steps for this agent have been reached.")
      expect(result.attempts[0]?.reportPath?.endsWith("worker-report.json")).toBe(true)
      expect(result.attempts[0]?.summaryPath?.endsWith("stdout.jsonl")).toBe(true)
      expect(obsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "recursive.cycle_completed",
        }),
      )
    } finally {
      analyzeSpy.mockRestore()
      replaceSpy.mockRestore()
      snapshotSpy.mockRestore()
      obsSpy.mockRestore()
      runSpy.mockRestore()
      if (prevRoot === undefined) delete process.env.OPENCODE_HARNESS_ROOT
      else process.env.OPENCODE_HARNESS_ROOT = prevRoot
      if (prevSource === undefined) delete process.env.OPENCODE_HARNESS_SOURCE_ROOT
      else process.env.OPENCODE_HARNESS_SOURCE_ROOT = prevSource
    }
  })

  test("startup defaults to the highest-ranked free opencode model and only runs once per runtime", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
          }),
        )
      },
    })

    const runtimeID = `rt-${Date.now()}`
    const previousRuntimeID = process.env.OPENCODE_RUNTIME_ID
    const previousRole = process.env.OPENCODE_RUNTIME_ROLE
    const previousHarnessRoot = process.env.OPENCODE_HARNESS_ROOT
    process.env.OPENCODE_RUNTIME_ID = runtimeID
    process.env.OPENCODE_RUNTIME_ROLE = "supervisor_stable"
    process.env.OPENCODE_HARNESS_ROOT = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const modelSpy = spyOn(Provider, "getSemanticExactOutputSafeFreeOpencodeModel").mockResolvedValue({
            id: "minimax-m2.5-free",
          } as any)
          const cycleSpy = spyOn(HarnessRecursive, "cycle")
          cycleSpy
            .mockResolvedValueOnce({
              cycleID: "part_recursive_a",
              startedAt: Date.now(),
              completedAt: Date.now(),
              applyLive: true,
              auditedProposalCount: 1,
              promotedProposalCount: 1,
              selectedProposalIDs: ["part_bug"],
              analysisProposalCount: 2,
              attempts: [
                {
                  proposalID: "part_bug",
                  title: "Fix bug",
                  status: "applied",
                  retained: true,
                  benchmarkProof: {
                    status: "improved",
                    improvedModels: ["opencode/minimax-m2.5-free"],
                    regressedModels: [],
                    stableModels: [],
                  },
                },
              ],
              reportPath: path.join(tmp.path, "recursive-a.json"),
            } as any)
            .mockResolvedValue({
              cycleID: "part_recursive_b",
              startedAt: Date.now(),
              completedAt: Date.now(),
              applyLive: true,
              auditedProposalCount: 0,
              promotedProposalCount: 0,
              selectedProposalIDs: [],
              analysisProposalCount: 0,
              attempts: [],
              reportPath: path.join(tmp.path, "recursive-b.json"),
            } as any)

          const first = await HarnessRecursive.startup()
          const second = await HarnessRecursive.startup()

          expect(first.status).toBe("started")
          expect(cycleSpy).toHaveBeenCalledTimes(4)
          expect(cycleSpy.mock.calls[0]?.[0]?.generateModel).toBe("opencode/minimax-m2.5-free")
          expect(cycleSpy.mock.calls[0]?.[0]?.reviewModel).toBe("opencode/minimax-m2.5-free")
          expect(cycleSpy.mock.calls[0]?.[0]?.benchmarkModel).toEqual({
            providerID: "opencode" as any,
            modelID: "minimax-m2.5-free" as any,
          })
          expect(first.result.workerModel).toBe("opencode/minimax-m2.5-free")
          expect(first.result.benchmarkModel).toBe("opencode/minimax-m2.5-free")
          expect(first.result.proofStatus).toBe("improved")
          expect(first.result.attemptedProposalIDs).toEqual(["part_bug"])
          expect(first.result.retainedAttemptCount).toBe(1)
          expect(first.result.rolledBackAttemptCount).toBe(0)
          expect(first.result.cycles).toHaveLength(4)
          expect(second).toEqual({
            status: "skipped",
            reason: "already_started",
          })

          modelSpy.mockRestore()
          cycleSpy.mockRestore()
        },
      })
    } finally {
      if (previousRuntimeID === undefined) delete process.env.OPENCODE_RUNTIME_ID
      else process.env.OPENCODE_RUNTIME_ID = previousRuntimeID
      if (previousRole === undefined) delete process.env.OPENCODE_RUNTIME_ROLE
      else process.env.OPENCODE_RUNTIME_ROLE = previousRole
      if (previousHarnessRoot === undefined) delete process.env.OPENCODE_HARNESS_ROOT
      else process.env.OPENCODE_HARNESS_ROOT = previousHarnessRoot
    }
  })
})
