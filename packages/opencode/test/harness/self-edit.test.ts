import { describe, it, expect } from "bun:test"
import { existsSync } from "fs"
import * as fs from "fs/promises"
import path from "path"
import { HarnessSelfEdit } from "../../src/harness/self-edit"
import { buildVerifyPlan } from "../../src/harness/verify"
import type { VerifyPlan } from "../../src/harness/verify"
import { HarnessPolicy, classifyChangedFiles, summarizePatch } from "../../src/harness/policy"
import { pendingWorkerManifestPath } from "../../src/harness/hotswap"
import { Patch } from "@/patch"
import { tmpdir } from "../fixture/fixture"

const ENV_KEYS = [
  "OPENCODE_HARNESS_ROOT",
  "OPENCODE_HARNESS_SOURCE_ROOT",
  "OPENCODE_HARNESS_WORKER_GENERATION",
  "OPENCODE_HARNESS_UPGRADE_NOTICE",
] as const

type HarnessFixture = {
  runtimeRoot: string
  sourceRoot: string
  packageRoot: string
}

async function seedSourceRoot(sourceRoot: string) {
  const packageRoot = path.join(sourceRoot, "packages", "opencode")
  await fs.mkdir(path.join(packageRoot, "src", "harness"), { recursive: true })
  await fs.writeFile(path.join(sourceRoot, "package.json"), JSON.stringify({ name: "fixture-root" }))
  await fs.writeFile(path.join(sourceRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }))
  await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "fixture-opencode" }))
  await fs.writeFile(
    path.join(packageRoot, "src", "harness", "existing.ts"),
    'export const fixtureValue = "before"\n',
  )
  return packageRoot
}

function fixtureVerifyPlan(patchText: string, commands: string[]): VerifyPlan {
  const base = buildVerifyPlan({ patchText })
  return {
    ...base,
    source: commands.length > 0 ? "explicit" : "none",
    sources: commands.length > 0 ? ["explicit"] : [],
    commands,
    rationale: "Fixture-scoped verify plan for isolated self-edit execution.",
  }
}

async function withHarnessFixture<T>(run: (fixture: HarnessFixture) => Promise<T>) {
  const previous = new Map<string, string | undefined>()
  for (const key of ENV_KEYS) previous.set(key, process.env[key])

  await using runtime = await tmpdir()
  await using source = await tmpdir()
  const packageRoot = await seedSourceRoot(source.path)

  process.env.OPENCODE_HARNESS_ROOT = runtime.path
  process.env.OPENCODE_HARNESS_SOURCE_ROOT = source.path
  delete process.env.OPENCODE_HARNESS_WORKER_GENERATION
  delete process.env.OPENCODE_HARNESS_UPGRADE_NOTICE

  try {
    return await run({ runtimeRoot: runtime.path, sourceRoot: source.path, packageRoot })
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe("HarnessSelfEdit", () => {
  describe("path validation boundaries", () => {
    it("rejects patch with relative path traversal", async () => {
      const patch = `*** Begin Patch
*** Add File: ../outside.ts
+nope
*** End Patch`

      await expect(HarnessSelfEdit.execute({ patchText: patch, applyLive: false })).rejects.toThrow(
        /outside the harness source root/,
      )
    })

    it("rejects patch with absolute unix paths", async () => {
      const patch = `*** Begin Patch
*** Add File: /absolute/path/file.ts
+nope
*** End Patch`

      await expect(HarnessSelfEdit.execute({ patchText: patch, applyLive: false })).rejects.toThrow(
        /outside the harness source root/,
      )
    })

    it("rejects patch targeting disallowed paths outside the supported roots", async () => {
      const patch = `*** Begin Patch
*** Add File: src/other/package/file.ts
+nope
*** End Patch`

      await expect(HarnessSelfEdit.execute({ patchText: patch, applyLive: false })).rejects.toThrow(
        /unsupported targets/,
      )
    })
  })

  describe("verify plan building", () => {
    it("classifies single harness file as small risk", () => {
      const result = classifyChangedFiles(["packages/opencode/src/harness/state.ts"])
      expect(result.risk).toBe("small")
      expect(result.maxFiles).toBe(1)
      expect(result.allowMove).toBe(false)
      expect(result.allowDelete).toBe(false)
      expect(result.requirePriorValidation).toBe(false)
    })

    it("classifies multiple harness files as medium risk", () => {
      const result = classifyChangedFiles([
        "packages/opencode/src/harness/state.ts",
        "packages/opencode/src/harness/policy.ts",
      ])
      expect(result.risk).toBe("medium")
      expect(result.maxFiles).toBe(4)
      expect(result.requirePriorValidation).toBe(true)
    })

    it("classifies policy.ts alone as large risk", () => {
      const result = classifyChangedFiles(["packages/opencode/src/harness/policy.ts"])
      expect(result.risk).toBe("large")
      expect(result.sensitivePaths).toContain("packages/opencode/src/harness/policy.ts")
    })

    it("small risk plan requires 1 command with no post-apply", () => {
      const plan = buildVerifyPlan({
        patchText: `*** Begin Patch
*** Update File: packages/opencode/src/harness/state.ts
@@
 context
*** End Patch`,
      })
      expect(plan.risk).toBe("small")
      expect(plan.requirements.minCommands).toBe(1)
      expect(plan.requirements.requirePostApply).toBe(false)
    })

    it("explicit commands are merged before defaults", () => {
      const plan = buildVerifyPlan({
        patchText: `*** Begin Patch
*** Update File: packages/opencode/src/harness/state.ts
@@
 context
*** End Patch`,
        explicitCommands: ["bun test custom"],
      })
      expect(plan.source).toBe("explicit")
      expect(plan.commands[0]).toBe("bun test custom")
      expect(plan.commands.length).toBeGreaterThan(1)
    })
  })

  describe("patch parsing and scope summarization", () => {
    it("extracts files from add patch", () => {
      const patch = `*** Begin Patch
*** Add File: packages/opencode/src/harness/new-file.ts
+new content
*** End Patch`

      const { hunks } = Patch.parsePatch(patch)
      expect(hunks).toHaveLength(1)
      expect(hunks[0].type).toBe("add")
      expect(hunks[0].path).toBe("packages/opencode/src/harness/new-file.ts")
    })

    it("summarizes update patch correctly", () => {
      const patch = `*** Begin Patch
*** Update File: packages/opencode/src/harness/state.ts
@@
 old line
+new line
*** End Patch`

      const scope = summarizePatch(patch)
      expect(scope.changedFiles).toContain("packages/opencode/src/harness/state.ts")
      expect(scope.fileCount).toBe(1)
      expect(scope.risk).toBe("small")
      expect(scope.hasMove).toBe(false)
      expect(scope.hasDelete).toBe(false)
    })

    it("enforces proposal file-count limits", () => {
      const proposal = {
        id: "prt_test",
        kind: "code_patch" as const,
        title: "Test",
        confidence: "high" as const,
        rationale: "Test",
        status: "open" as const,
        expectedFiles: ["packages/opencode/src/harness/state.ts"],
        maxFiles: 1,
        maxChangedLines: 100,
        allowMove: false,
        allowDelete: false,
        requirePriorValidation: false,
      }
      const patch = `*** Begin Patch
*** Update File: packages/opencode/src/harness/state.ts
@@
 context
*** Update File: packages/opencode/src/harness/policy.ts
@@
 context
*** End Patch`

      expect(() => HarnessPolicy.validatePatchAgainstProposal(proposal, patch)).toThrow(/file-count limit/)
    })
  })

  describe("shadow-only execution with verify commands", () => {
    it("applies and verifies a patch in an isolated shadow workspace only", async () => {
      await withHarnessFixture(async ({ sourceRoot }) => {
        const patch = `*** Begin Patch
*** Add File: packages/opencode/src/harness/self-edit-shadow-fixture.ts
+export const shadowOnlyFixture = "shadow"
*** End Patch`

        const result = await HarnessSelfEdit.execute({
          patchText: patch,
          applyLive: false,
          verifyPlan: fixtureVerifyPlan(patch, [
            `bun -e 'const fs = require("fs"); if (!fs.existsSync("src/harness/self-edit-shadow-fixture.ts")) process.exit(1)'`,
          ]),
          verifyCommandTimeoutMS: 30_000,
        })

        const shadowFile = path.join(
          result.shadowPath,
          "packages",
          "opencode",
          "src",
          "harness",
          "self-edit-shadow-fixture.ts",
        )
        const liveFile = path.join(
          sourceRoot,
          "packages",
          "opencode",
          "src",
          "harness",
          "self-edit-shadow-fixture.ts",
        )

        expect(result.appliedLive).toBe(false)
        expect(result.verifyResults).toHaveLength(1)
        expect(result.verifyResults[0].phase).toBe("shadow")
        expect(result.verifyResults[0].code).toBe(0)
        expect(existsSync(shadowFile)).toBe(true)
        expect(existsSync(liveFile)).toBe(false)
        expect(existsSync(pendingWorkerManifestPath())).toBe(false)
      })
    })

    it("writes report and summary artifacts for shadow validation", async () => {
      await withHarnessFixture(async () => {
        const patch = `*** Begin Patch
*** Update File: packages/opencode/src/harness/existing.ts
@@
-export const fixtureValue = "before"
+export const fixtureValue = "after"
*** End Patch`

        const result = await HarnessSelfEdit.execute({
          patchText: patch,
          applyLive: false,
          verifyPlan: fixtureVerifyPlan(patch, [`bun -e 'process.exit(0)'`]),
          verifyCommandTimeoutMS: 30_000,
        })
        const report = JSON.parse(await fs.readFile(result.reportPath, "utf8"))
        const summary = await fs.readFile(result.summaryPath, "utf8")

        expect(report.executionID).toBe(result.executionID)
        expect(report.applyLive).toBe(false)
        expect(report.verifyResults[0].phase).toBe("shadow")
        expect(report.changes).toEqual([
          expect.objectContaining({
            type: "update",
            path: "packages/opencode/src/harness/existing.ts",
          }),
        ])
        expect(summary).toContain("- applyLive: false")
        expect(summary).toContain("- update packages/opencode/src/harness/existing.ts")
      })
    })

    it("blocks live apply when verification requirements are not met", async () => {
      await withHarnessFixture(async () => {
        const patch = `*** Begin Patch
*** Add File: packages/opencode/src/harness/no-live-without-verification.ts
+export const blocked = true
*** End Patch`

        await expect(
          HarnessSelfEdit.execute({
            patchText: patch,
            applyLive: true,
            allowUnverifiedLive: false,
            verifyPlan: fixtureVerifyPlan(patch, []),
          }),
        ).rejects.toThrow(/requires at least 1 verification command/)
      })
    })
  })
})
