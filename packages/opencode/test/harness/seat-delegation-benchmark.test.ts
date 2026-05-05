// @ts-nocheck
import { afterEach, describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"
import { runSeatDelegationBenchmark } from "../../src/harness/seat-delegation-benchmark"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

describe("seat-agent delegation benchmark", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("semantic delegation cues improve the seated agent's split judgment", async () => {
    const originalPrompt = SessionPrompt.prompt
    const tmps: Array<Awaited<ReturnType<typeof tmpdir>>> = []

    ;(SessionPrompt as any).prompt = async (input: any) => {
      const text = input.parts?.find((part: any) => part.type === "text")?.text ?? ""
      const isSemantic = text.includes("Semantic memory:")

      let output = "gather_more_context_first"
      if (text.includes("Scenario: single_seam_hotfix")) {
        output = isSemantic ? "stay_solo" : "split_parallel"
      } else if (text.includes("Scenario: independent_ui_and_docs")) {
        output = "split_parallel"
      } else if (text.includes("Scenario: bounded_sidecar_probe")) {
        output = isSemantic ? "delegate_bounded_worker" : "split_parallel"
      } else if (text.includes("Scenario: shared_file_false_parallel")) {
        output = isSemantic ? "stay_solo" : "split_parallel"
      } else if (text.includes("Scenario: architecture_uncertainty")) {
        output = "gather_more_context_first"
      } else if (text.includes("Scenario: delegate_before_context_trap")) {
        output = isSemantic ? "gather_more_context_first" : "split_parallel"
      } else if (text.includes("Scenario: critical_path_dependency")) {
        output = isSemantic ? "stay_solo" : "delegate_bounded_worker"
      } else if (text.includes("Scenario: one_sidecar_better_than_two_workers")) {
        output = isSemantic ? "delegate_bounded_worker" : "split_parallel"
      } else if (text.includes("Scenario: recursive_subsystem_owner")) {
        output = isSemantic ? "delegate_bounded_worker" : "split_parallel"
      } else if (text.includes("Scenario: locked_root_cause_clean_parallel")) {
        output = isSemantic ? "split_parallel" : "stay_solo"
      } else if (text.includes("Scenario: scope_escalation_discovery")) {
        output = isSemantic ? "gather_more_context_first" : "delegate_bounded_worker"
      } else if (text.includes("Scenario: shared_approval_gate")) {
        output = isSemantic ? "gather_more_context_first" : "split_parallel"
      }

      return {
        info: {
          id: `assistant_${Math.random().toString(36).slice(2)}`,
          sessionID: input.sessionID,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          agent: input.agent ?? "build",
          model: input.model,
        },
        parts: [{ type: "text", text: output }],
      }
    }

    const prepareWorkspace = async (_scenarioID: string) => {
      const tmp = await tmpdir()
      tmps.push(tmp)
      return tmp.path
    }

    try {
      const result = await runSeatDelegationBenchmark({
        benchmarkModel: { providerID: "alibaba-coding-plan" as any, modelID: "glm-5" as any },
        prepareWorkspace,
      })

      expect(result.suite).toBe("seat_delegation_judgment")
      expect(result.scenarioCount).toBe(12)
      expect(result.baselineCorrectCount).toBe(2)
      expect(result.semanticCorrectCount).toBe(12)
      expect(result.qualityLift).toBeGreaterThan(0)
      expect(result.looseQualityLift).toBeGreaterThan(0)
      expect(result.baselineContractViolationCount).toBe(0)
      expect(result.semanticContractViolationCount).toBe(0)
      expect(result.baselineDecisionMissCount).toBe(10)
      expect(result.semanticDecisionMissCount).toBe(0)
      expect(result.contractViolationLift).toBe(0)
      expect(result.decisionLift).toBe(10)
      expect(result.categorySummary).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "solo",
            semanticCorrectCount: 3,
            baselineDecisionMissCount: 3,
            semanticDecisionMissCount: 0,
          }),
          expect.objectContaining({
            category: "parallel",
            semanticCorrectCount: 2,
            baselineDecisionMissCount: 1,
            semanticDecisionMissCount: 0,
          }),
          expect.objectContaining({
            category: "delegate",
            semanticCorrectCount: 3,
            baselineDecisionMissCount: 3,
            semanticDecisionMissCount: 0,
          }),
          expect.objectContaining({
            category: "context",
            semanticCorrectCount: 4,
            baselineDecisionMissCount: 3,
            semanticDecisionMissCount: 0,
          }),
        ]),
      )
      expect(result.results.find((item) => item.id === "bounded_sidecar_probe")).toEqual(
        expect.objectContaining({
          baselineContractViolation: false,
          semanticContractViolation: false,
          baselineDecisionMiss: true,
          semanticDecisionMiss: false,
        }),
      )
      expect(result.results.find((item) => item.id === "recursive_subsystem_owner")).toEqual(
        expect.objectContaining({
          category: "delegate",
          baselineDecisionMiss: true,
          semanticDecisionMiss: false,
        }),
      )
      expect(result.results.find((item) => item.id === "scope_escalation_discovery")).toEqual(
        expect.objectContaining({
          category: "context",
          baselineDecisionMiss: true,
          semanticDecisionMiss: false,
        }),
      )
      expect(result.results.map((item) => item.id)).toEqual(
        expect.arrayContaining([
          "single_seam_hotfix",
          "independent_ui_and_docs",
          "bounded_sidecar_probe",
          "shared_file_false_parallel",
          "architecture_uncertainty",
          "delegate_before_context_trap",
          "critical_path_dependency",
          "one_sidecar_better_than_two_workers",
          "recursive_subsystem_owner",
          "locked_root_cause_clean_parallel",
          "scope_escalation_discovery",
          "shared_approval_gate",
        ]),
      )
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
      while (tmps.length) {
        const tmp = tmps.pop()
        if (tmp) await tmp[Symbol.asyncDispose]()
      }
    }
  }, 60_000)

  test("diagnostics separate contract violations from true decision misses", async () => {
    const originalPrompt = SessionPrompt.prompt
    const tmps: Array<Awaited<ReturnType<typeof tmpdir>>> = []

    ;(SessionPrompt as any).prompt = async (input: any) => {
      const text = input.parts?.find((part: any) => part.type === "text")?.text ?? ""
      const isSemantic = text.includes("Semantic memory:")

      let output = "gather_more_context_first"
      if (text.includes("Scenario: single_seam_hotfix")) {
        output = isSemantic ? "stay_solo because the seam is tightly coupled" : "split_parallel"
      } else if (text.includes("Scenario: independent_ui_and_docs")) {
        output = "split_parallel"
      } else if (text.includes("Scenario: bounded_sidecar_probe")) {
        output = isSemantic ? "delegate_bounded_worker because the sidecar is bounded" : "split_parallel"
      } else if (text.includes("Scenario: shared_file_false_parallel")) {
        output = "stay_solo"
      } else if (text.includes("Scenario: architecture_uncertainty")) {
        output = "gather_more_context_first"
      } else if (text.includes("Scenario: delegate_before_context_trap")) {
        output = "gather_more_context_first"
      } else if (text.includes("Scenario: critical_path_dependency")) {
        output = isSemantic ? "stay_solo and keep the blocker local" : "delegate_bounded_worker"
      } else if (text.includes("Scenario: one_sidecar_better_than_two_workers")) {
        output = "delegate_bounded_worker"
      } else if (text.includes("Scenario: recursive_subsystem_owner")) {
        output = isSemantic ? "delegate_bounded_worker because one bounded owner may recurse locally" : "split_parallel"
      } else if (text.includes("Scenario: locked_root_cause_clean_parallel")) {
        output = "split_parallel"
      } else if (text.includes("Scenario: scope_escalation_discovery")) {
        output = "gather_more_context_first"
      } else if (text.includes("Scenario: shared_approval_gate")) {
        output = isSemantic ? "gather_more_context_first" : "split_parallel"
      }

      return {
        info: {
          id: `assistant_${Math.random().toString(36).slice(2)}`,
          sessionID: input.sessionID,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          agent: input.agent ?? "build",
          model: input.model,
        },
        parts: [{ type: "text", text: output }],
      }
    }

    const prepareWorkspace = async (_scenarioID: string) => {
      const tmp = await tmpdir()
      tmps.push(tmp)
      return tmp.path
    }

    try {
      const result = await runSeatDelegationBenchmark({
        benchmarkModel: { providerID: "alibaba-coding-plan" as any, modelID: "kimi-k2.5" as any },
        prepareWorkspace,
      })

      expect(result.baselineContractViolationCount).toBe(0)
      expect(result.semanticContractViolationCount).toBe(4)
      expect(result.baselineDecisionMissCount).toBe(5)
      expect(result.semanticDecisionMissCount).toBe(0)
      expect(result.contractViolationLift).toBe(-4)
      expect(result.decisionLift).toBe(5)
      expect(result.results.find((item) => item.id === "bounded_sidecar_probe")).toEqual(
        expect.objectContaining({
          semanticCorrect: false,
          semanticLooseCorrect: true,
          semanticContractViolation: true,
          semanticDecisionMiss: false,
        }),
      )
      expect(result.results.find((item) => item.id === "critical_path_dependency")).toEqual(
        expect.objectContaining({
          baselineDecisionMiss: true,
          semanticContractViolation: true,
          semanticDecisionMiss: false,
        }),
      )
      expect(result.results.find((item) => item.id === "recursive_subsystem_owner")).toEqual(
        expect.objectContaining({
          baselineDecisionMiss: true,
          semanticLooseCorrect: true,
          semanticContractViolation: true,
          semanticDecisionMiss: false,
        }),
      )
    } finally {
      ;(SessionPrompt as any).prompt = originalPrompt
      while (tmps.length) {
        const tmp = tmps.pop()
        if (tmp) await tmp[Symbol.asyncDispose]()
      }
    }
  }, 60_000)
})
