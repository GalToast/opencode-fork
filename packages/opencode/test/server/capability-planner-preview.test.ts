import { describe, expect, spyOn, test } from "bun:test"
import { CapabilityPlanner } from "../../src/capability"
import { ExperimentalRoutes } from "../../src/server/routes/experimental"

describe("experimental capability planner preview route", () => {
  test("returns read-only planner suggestions", async () => {
    const previewSpy = spyOn(CapabilityPlanner, "preview").mockResolvedValue({
      generatedAt: 123,
      catalogCount: 3,
      suggestions: [
        {
          id: "inspect-and-patch",
          title: "Inspect and Patch Code",
          rationale: "Because the catalog supports code inspection and edits.",
          uses: ["read", "apply_patch"],
          score: 3,
          steps: [
            {
              title: "Read the relevant files",
              capabilityIDs: ["read"],
            },
            {
              title: "Patch the code",
              capabilityIDs: ["apply_patch"],
            },
          ],
        },
      ],
    } as any)

    try {
      const response = await ExperimentalRoutes().request("/capability/planner-preview")
      expect(response.status).toBe(200)

      const payload = (await response.json()) as {
        catalogCount: number
        suggestions: Array<{ id: string; steps: Array<{ capabilityIDs: string[] }> }>
      }

      expect(payload.catalogCount).toBe(3)
      expect(payload.suggestions[0]?.id).toBe("inspect-and-patch")
      expect(payload.suggestions[0]?.steps[0]?.capabilityIDs).toEqual(["read"])
    } finally {
      previewSpy.mockRestore()
    }
  })
})
