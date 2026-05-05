import { describe, it, expect } from "bun:test"
import {
  changedFilesFromPatch,
  defaultVerifyCommands,
  buildVerifyPlan,
} from "../../src/harness/verify"

describe("verify module", () => {
  describe("changedFilesFromPatch", () => {
    it("extracts files from an update patch", () => {
      const patch = `*** Begin Patch
*** Update File: packages/opencode/src/launcher.ts
@@
  existing line
*** End Patch`
      const files = changedFilesFromPatch(patch)
      expect(files).toContain("packages/opencode/src/launcher.ts")
    })

    it("extracts files from an add patch", () => {
      const patch = `*** Begin Patch
*** Add File: packages/opencode/src/new-file.ts
+ new content
*** End Patch`
      const files = changedFilesFromPatch(patch)
      expect(files).toContain("packages/opencode/src/new-file.ts")
    })

    it("extracts files from a delete patch", () => {
      const patch = `*** Begin Patch
*** Delete File: packages/opencode/src/old-file.ts
*** End Patch`
      const files = changedFilesFromPatch(patch)
      expect(files).toContain("packages/opencode/src/old-file.ts")
    })

    it("handles move operations", () => {
      const patch = `*** Begin Patch
*** Update File: packages/opencode/src/old-path.ts
*** Move to: packages/opencode/src/new-path.ts
@@
  context line
*** End Patch`
      const files = changedFilesFromPatch(patch)
      expect(files).toContain("packages/opencode/src/old-path.ts")
      expect(files).toContain("packages/opencode/src/new-path.ts")
    })

    it("normalizes path separators on windows", () => {
      const patch = `*** Begin Patch
*** Update File: packages\\opencode\\src\\file.ts
@@
  line
*** End Patch`
      const files = changedFilesFromPatch(patch)
      expect(files).toContain("packages/opencode/src/file.ts")
    })

    it("deduplicates files", () => {
      const patch = `*** Begin Patch
*** Update File: packages/opencode/src/file.ts
@@
  line
*** Update File: packages/opencode/src/file.ts
@@
  other line
*** End Patch`
      const files = changedFilesFromPatch(patch)
      const fileCount = files.filter((f) => f === "packages/opencode/src/file.ts").length
      expect(fileCount).toBe(1)
    })
  })

  describe("defaultVerifyCommands", () => {
    it("returns launcher test for launcher changes", () => {
      const commands = defaultVerifyCommands(["opencode-steer.ps1"])
      expect(commands.some((c) => c.includes("launcher.test.ts"))).toBe(true)
    })

    it("returns harness tests for harness file changes", () => {
      const commands = defaultVerifyCommands(["packages/opencode/src/harness/state.ts"])
      expect(commands.some((c) => c.includes("generate.test.ts"))).toBe(true)
      expect(commands.some((c) => c.includes("self-edit.test.ts"))).toBe(true)
      expect(commands.some((c) => c.includes("verify.test.ts"))).toBe(true)
    })

    it("returns harness tests for test harness file changes", () => {
      const commands = defaultVerifyCommands(["packages/opencode/test/harness/state.test.ts"])
      expect(commands.some((c) => c.includes("generate.test.ts"))).toBe(true)
      expect(commands.some((c) => c.includes("self-edit.test.ts"))).toBe(true)
    })

    it("returns config tests for config changes", () => {
      const commands = defaultVerifyCommands(["packages/opencode/src/config/config.ts"])
      expect(commands.some((c) => c.includes("config.test.ts"))).toBe(true)
    })

    it("returns session tests for session file changes", () => {
      const commands = defaultVerifyCommands(["packages/opencode/src/session/llm.ts"])
      expect(commands.some((c) => c.includes("llm.test.ts"))).toBe(true)
    })

    it("returns tool tests for tool file changes", () => {
      const commands = defaultVerifyCommands(["packages/opencode/src/tool/task/task.ts"])
      expect(commands.some((c) => c.includes("task-lane.test.ts"))).toBe(true)
    })

    it("returns empty array for unrecognized files", () => {
      const commands = defaultVerifyCommands(["packages/opencode/src/unknown/file.ts"])
      expect(commands).toEqual([])
    })

    it("deduplicates commands", () => {
      const commands = defaultVerifyCommands([
        "packages/opencode/src/harness/state.ts",
        "packages/opencode/test/harness/state.test.ts",
      ])
      // Should not have duplicate identical commands
      const generateTests = commands.filter((c) => c.includes("generate.test.ts"))
      expect(generateTests.length).toBe(1)
    })
  })

  describe("buildVerifyPlan", () => {
    it("builds plan with explicit commands", () => {
      const plan = buildVerifyPlan({
        patchText: `*** Begin Patch
*** Update File: packages/opencode/src/harness/state.ts
@@
  line
*** End Patch`,
        explicitCommands: ["bun test test/harness/state.test.ts"],
      })
      expect(plan.source).toBe("explicit")
      expect(plan.commands).toContain("bun test test/harness/state.test.ts")
    })

    it("builds plan with review commands", () => {
      const plan = buildVerifyPlan({
        patchText: `*** Begin Patch
*** Update File: packages/opencode/src/harness/state.ts
@@
  line
*** End Patch`,
        reviewCommands: ["bun test test/harness/healer.test.ts"],
      })
      expect(plan.sources).toContain("review")
    })

    it("builds plan with default commands", () => {
      const plan = buildVerifyPlan({
        patchText: `*** Begin Patch
*** Update File: packages/opencode/src/harness/state.ts
@@
  line
*** End Patch`,
      })
      expect(plan.sources).toContain("default")
    })

    it("computes small risk correctly", () => {
      const plan = buildVerifyPlan({
        patchText: `*** Begin Patch
*** Update File: packages/opencode/src/harness/state.ts
@@
  line
*** End Patch`,
      })
      expect(plan.risk).toBe("small")
      expect(plan.requirements.minCommands).toBe(1)
      expect(plan.requirements.requirePostApply).toBe(false)
    })

    it("includes changed files in plan", () => {
      const plan = buildVerifyPlan({
        patchText: `*** Begin Patch
*** Update File: packages/opencode/src/harness/state.ts
@@
  line
*** End Patch`,
      })
      expect(plan.changedFiles).toContain("packages/opencode/src/harness/state.ts")
    })

    it("merges commands from multiple sources", () => {
      const plan = buildVerifyPlan({
        patchText: `*** Begin Patch
*** Update File: packages/opencode/src/harness/state.ts
@@
  line
*** End Patch`,
        explicitCommands: ["bun test explicit"],
        reviewCommands: ["bun test review"],
      })
      expect(plan.commands).toContain("bun test explicit")
      expect(plan.commands).toContain("bun test review")
      expect(plan.sources).toContain("explicit")
      expect(plan.sources).toContain("review")
    })

    it("handles no commands scenario", () => {
      // Use a file that has no default commands
      const plan = buildVerifyPlan({
        patchText: `*** Begin Patch
*** Update File: packages/opencode/src/provider/unknown.ts
@@
  line
*** End Patch`,
      })
      expect(plan.source).toBe("none")
      expect(plan.commands).toEqual([])
    })
  })
})
