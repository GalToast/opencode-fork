// @ts-nocheck
import { expect, spyOn, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { HarnessConfidence } from "../../src/harness/confidence"
import { HarnessState } from "../../src/harness/state"
import * as HarnessSession from "../../src/harness/session"

test("confidence research uses healer lane for exact-output-safe structured decisions", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
      await Bun.write(path.join(dir, "sample.ts"), "export const value = 1\n")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sourceFile = path.join(tmp.path, "sample.ts")
      const runSpy = spyOn(HarnessSession, "runReadOnlyHarnessSession").mockResolvedValue({
        raw: JSON.stringify({
          confidence: "medium",
          summary: "Tighter scope is supported by the current source.",
          rationale: "The current file set is narrow and well-anchored.",
          evidence: ["Uses a single declared file.", "Source snapshot exists."],
          narrowedFiles: ["sample.ts"],
          patchSummary: "Narrow the patch to the single declared file.",
        }),
        structured: undefined,
        requestedModel: "auto/quality",
        selectedModel: "opencode/big-pickle",
        resolvedModel: "opencode/big-pickle",
      } as any)

      const proposal = {
        id: "part_confidence",
        kind: "code_patch",
        title: "Narrow sample edit",
        confidence: "low",
        rationale: "Need more evidence before promotion.",
        status: "open",
        risk: "small",
        expectedFiles: [sourceFile],
        patchHint: {
          summary: "Adjust sample value.",
          files: [sourceFile],
        },
      } as any

      await HarnessState.replaceProposals([proposal])
      await HarnessConfidence.researchProposal({
        proposal,
        force: true,
        observations: [],
      })

      expect(runSpy).toHaveBeenCalled()
      expect(runSpy.mock.calls[0]?.[0]?.lane).toBe("healer")
    },
  })
})
