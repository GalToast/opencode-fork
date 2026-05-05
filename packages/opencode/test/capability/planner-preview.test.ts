import { describe, expect, test } from "bun:test"
import { CapabilityPlanner } from "../../src/capability"

describe("capability planner preview", () => {
  test("suggests workflow bundles from a lightweight capability mix", () => {
    const preview = CapabilityPlanner.previewFrom([
      {
        id: "read",
        kind: "tool",
        source: "builtin",
        title: "read",
        hints: [],
      },
      {
        id: "glob",
        kind: "tool",
        source: "builtin",
        title: "glob",
        hints: [],
      },
      {
        id: "apply_patch",
        kind: "tool",
        source: "builtin",
        title: "apply_patch",
        hints: [],
      },
      {
        id: "webfetch",
        kind: "tool",
        source: "builtin",
        title: "webfetch",
        hints: [],
      },
      {
        id: "task",
        kind: "tool",
        source: "builtin",
        title: "task",
        hints: [],
      },
      {
        id: "review",
        kind: "command",
        source: "command",
        title: "review",
        hints: [],
      },
      {
        id: "demo:resource",
        kind: "mcp_resource",
        source: "mcp",
        title: "API Guide",
        client: "demo",
        uri: "file:///guide.md",
        hints: [],
      },
    ])

    expect(preview.catalogCount).toBe(7)
    expect(preview.suggestions.length).toBeGreaterThan(1)
    expect(preview.suggestions.some((bundle) => bundle.id === "inspect-and-patch")).toBe(true)
    expect(preview.suggestions.some((bundle) => bundle.id === "research-and-summarize")).toBe(true)
    expect(preview.suggestions.some((bundle) => bundle.id === "delegate-and-synthesize")).toBe(true)
  })

  test("surfaces a browser workflow when browser MCP tools are available", () => {
    const preview = CapabilityPlanner.previewFrom([
      {
        id: "playwright_browser_navigate",
        kind: "mcp_tool",
        source: "mcp",
        title: "browser_navigate",
        client: "playwright",
        hints: [],
      },
      {
        id: "chrome-devtools_click",
        kind: "mcp_tool",
        source: "mcp",
        title: "click",
        client: "chrome-devtools",
        hints: [],
      },
    ])

    const browserBundle = preview.suggestions.find((bundle) => bundle.id === "browser-automation-and-debug")
    expect(browserBundle).toBeDefined()
    expect(browserBundle?.uses).toContain("playwright_browser_navigate")
    expect(browserBundle?.steps[0]?.capabilityIDs).toEqual(["playwright_browser_navigate", "chrome-devtools_click"])
  })
})
