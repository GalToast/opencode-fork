import { describe, test, expect } from "bun:test"
import { validatePatchAgainstProposal, classifyChangedFiles } from "../src/harness/policy"
import type { HarnessState } from "../src/harness/state"

describe("validatePatchAgainstProposal", () => {
  const createProposal = (files: string[], risk: "small" | "medium" | "large" = "large"): HarnessState.Proposal => ({
    id: "test-proposal",
    title: "Test Proposal",
    rationale: "Test rationale",
    kind: "code_patch",
    status: "open",
    autoStatus: "staged",
    confidence: "high",
    risk,
    riskReasons: ["test"],
    sensitivePaths: files.filter((f) => f.startsWith("packages/opencode/src/harness/")),
    expectedFiles: files,
    maxFiles: risk === "large" ? 12 : 4,
    maxChangedLines: risk === "large" ? 6000 : 300,
    allowMove: risk === "large",
    allowDelete: risk === "large",
    requirePriorValidation: risk !== "small",
    autonomy: "stage_only",
    patchHint: {
      summary: "Test patch",
      files,
    },
  })

  const createPatch = (files: string[]) => {
    const header = "*** Begin Patch\n"
    const footer = "*** End Patch\n"
    const fileSections = files
      .map((file) => {
        return `*** Update File: ${file}
@@
+new line
`
      })
      .join("\n")
    return header + fileSections + footer
  }

  test("allows patches that match expected files exactly", () => {
    const proposal = createProposal(["packages/opencode/src/harness/policy.ts"])
    const patch = createPatch(["packages/opencode/src/harness/policy.ts"])
    expect(() => validatePatchAgainstProposal(proposal, patch)).not.toThrow()
  })

  test("rejects patches that touch files outside expected files for non-harness directories", () => {
    const proposal = createProposal(["packages/opencode/src/tool/bash.ts"])
    const patch = createPatch(["packages/opencode/src/tool/bash.ts", "packages/opencode/src/tool/read.ts"])
    expect(() => validatePatchAgainstProposal(proposal, patch)).toThrow("Patch touched unexpected files")
  })

  test("allows harness self-edits to touch related files in the same directory", () => {
    const proposal = createProposal(["packages/opencode/src/harness/policy.ts"])
    const patch = createPatch([
      "packages/opencode/src/harness/policy.ts",
      "packages/opencode/src/harness/orchestrator.ts",
      "packages/opencode/src/harness/telemetry.ts",
    ])
    // Should NOT throw because all files are in harness/ directory
    expect(() => validatePatchAgainstProposal(proposal, patch)).not.toThrow()
  })

  test("allows harness self-edits when all expected and changed files are in harness/", () => {
    const proposal = createProposal([
      "packages/opencode/src/harness/policy.ts",
      "packages/opencode/src/harness/generate.ts",
    ])
    const patch = createPatch([
      "packages/opencode/src/harness/policy.ts",
      "packages/opencode/src/harness/generate.ts",
      "packages/opencode/src/harness/orchestrator.ts",
      "packages/opencode/src/harness/telemetry.ts",
      "packages/opencode/src/harness/review.ts",
    ])
    // Should NOT throw - all files within harness/ are allowed
    expect(() => validatePatchAgainstProposal(proposal, patch)).not.toThrow()
  })

  test("rejects harness patches that touch files outside harness/", () => {
    const proposal = createProposal(["packages/opencode/src/harness/policy.ts"])
    const patch = createPatch(["packages/opencode/src/harness/policy.ts", "packages/opencode/src/tool/bash.ts"])
    // Should throw because bash.ts is not in harness/
    expect(() => validatePatchAgainstProposal(proposal, patch)).toThrow("Patch touched unexpected files")
  })

  test("rejects non-harness patches that touch files outside expected scope", () => {
    const proposal = createProposal(["packages/opencode/src/config/config.ts"])
    const patch = createPatch([
      "packages/opencode/src/config/config.ts",
      "packages/opencode/src/scheduler/control-plane.ts",
    ])
    // Should throw - config/ files don't get harness/ leniency
    expect(() => validatePatchAgainstProposal(proposal, patch)).toThrow("Patch touched unexpected files")
  })

  test("handles path normalization correctly", () => {
    const proposal = createProposal(["packages/opencode/src/harness/policy.ts"])
    const patch = createPatch([
      "packages/opencode/src/harness/policy.ts",
      "packages/opencode/src/harness/../harness/orchestrator.ts",
    ])
    // Should NOT throw after normalization
    expect(() => validatePatchAgainstProposal(proposal, patch)).not.toThrow()
  })
})

describe("classifyChangedFiles", () => {
  test("classifies harness files as sensitive and large risk", () => {
    const result = classifyChangedFiles(["packages/opencode/src/harness/policy.ts"])
    expect(result.sensitivePaths).toContain("packages/opencode/src/harness/policy.ts")
    expect(result.risk).toBe("large")
  })

  test("classifies non-sensitive single file as small risk", () => {
    const result = classifyChangedFiles(["packages/opencode/src/util/filesystem.ts"])
    expect(result.sensitivePaths).toEqual([])
    expect(result.risk).toBe("small")
  })

  test("classifies multiple non-sensitive files as medium risk", () => {
    const result = classifyChangedFiles([
      "packages/opencode/src/util/filesystem.ts",
      "packages/opencode/src/util/lock.ts",
    ])
    expect(result.risk).toBe("medium")
    expect(result.riskReasons).toContain("multi_file_scope")
  })

  test("classifies multiple harness files as medium risk", () => {
    const result = classifyChangedFiles([
      "packages/opencode/src/harness/policy.ts",
      "packages/opencode/src/harness/generate.ts",
    ])
    expect(result.risk).toBe("medium")
    expect(result.riskReasons).toContain("multi_file_scope")
  })

  test("classifies many harness files as large risk", () => {
    const result = classifyChangedFiles([
      "packages/opencode/src/harness/policy.ts",
      "packages/opencode/src/harness/generate.ts",
      "packages/opencode/src/harness/orchestrator.ts",
      "packages/opencode/src/harness/telemetry.ts",
      "packages/opencode/src/harness/review.ts",
    ])
    expect(result.risk).toBe("large")
    expect(result.riskReasons).toContain("wide_file_scope")
  })
})

