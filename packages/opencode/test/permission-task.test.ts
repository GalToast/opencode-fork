import { describe, test, expect } from "bun:test"
import { PermissionNext } from "../src/permission/next"
import { Config } from "../src/config/config"
import { Instance } from "../src/project/instance"
import { tmpdir } from "./fixture/fixture"

describe("PermissionNext.evaluate for permission.task", () => {
  const createRuleset = (rules: Record<string, "allow" | "deny" | "ask">): PermissionNext.Ruleset =>
    Object.entries(rules).map(([pattern, action]) => ({
      permission: "task",
      pattern,
      action,
    }))

  test("returns ask when no match (default)", () => {
    expect(PermissionNext.evaluate("task", "code-reviewer", []).action).toBe("ask")
  })

  test("returns deny for explicit deny", () => {
    const ruleset = createRuleset({ "code-reviewer": "deny" })
    expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
  })

  test("returns allow for explicit allow", () => {
    const ruleset = createRuleset({ "code-reviewer": "allow" })
    expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("allow")
  })

  test("returns ask for explicit ask", () => {
    const ruleset = createRuleset({ "code-reviewer": "ask" })
    expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("ask")
  })

  test("matches wildcard patterns with deny", () => {
    const ruleset = createRuleset({ "orchestrator-*": "deny" })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset).action).toBe("deny")
    expect(PermissionNext.evaluate("task", "orchestrator-slow", ruleset).action).toBe("deny")
    expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("ask")
  })

  test("matches wildcard patterns with allow", () => {
    const ruleset = createRuleset({ "orchestrator-*": "allow" })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset).action).toBe("allow")
    expect(PermissionNext.evaluate("task", "orchestrator-slow", ruleset).action).toBe("allow")
  })

  test("matches wildcard patterns with ask", () => {
    const ruleset = createRuleset({ "orchestrator-*": "ask" })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset).action).toBe("ask")
    const globalRuleset = createRuleset({ "*": "ask" })
    expect(PermissionNext.evaluate("task", "code-reviewer", globalRuleset).action).toBe("ask")
  })

  test("later rules take precedence (last match wins)", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "deny",
      "orchestrator-fast": "allow",
    })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset).action).toBe("allow")
    expect(PermissionNext.evaluate("task", "orchestrator-slow", ruleset).action).toBe("deny")
  })

  test("matches global wildcard", () => {
    expect(PermissionNext.evaluate("task", "any-agent", createRuleset({ "*": "allow" })).action).toBe("allow")
    expect(PermissionNext.evaluate("task", "any-agent", createRuleset({ "*": "deny" })).action).toBe("deny")
    expect(PermissionNext.evaluate("task", "any-agent", createRuleset({ "*": "ask" })).action).toBe("ask")
  })
})

describe("PermissionNext.disabled for task tool", () => {
  // Note: The `disabled` function checks if a TOOL should be completely removed from the tool list.
  // The task tool stays visible so runtime permission evaluation can still explain or enforce
  // which subagents are allowed, rather than making delegation disappear from the surface.
  const createRuleset = (rules: Record<string, "allow" | "deny" | "ask">): PermissionNext.Ruleset =>
    Object.entries(rules).map(([pattern, action]) => ({
      permission: "task",
      pattern,
      action,
    }))

  test("task tool stays visible when global deny pattern exists alongside specific allows", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "allow",
      "*": "deny",
    })
    const disabled = PermissionNext.disabled(["task", "bash", "read"], ruleset)
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool stays visible when global deny pattern exists with ask overrides", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "ask",
      "*": "deny",
    })
    const disabled = PermissionNext.disabled(["task"], ruleset)
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool stays visible even when global deny pattern exists", () => {
    const ruleset = createRuleset({ "*": "deny" })
    const disabled = PermissionNext.disabled(["task"], ruleset)
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool is NOT disabled when only specific patterns are denied (no wildcard)", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "deny",
      general: "deny",
    })
    const disabled = PermissionNext.disabled(["task"], ruleset)
    // The task tool is NOT disabled because no rule has pattern: "*" with action: "deny"
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool is enabled when no task rules exist (default ask)", () => {
    const disabled = PermissionNext.disabled(["task"], [])
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool is NOT disabled when last wildcard pattern is allow", () => {
    const ruleset = createRuleset({
      "*": "deny",
      "orchestrator-coder": "allow",
    })
    const disabled = PermissionNext.disabled(["task"], ruleset)
    expect(disabled.has("task")).toBe(false)
  })
})

// Integration tests that load permissions from real config files
describe("permission.task with real config files", () => {
  test("loads task permissions from opencode.json config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            "*": "allow",
            "code-reviewer": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})
        // general and orchestrator-fast should be allowed, code-reviewer denied
        expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
      },
    })
  })

  test("loads task permissions with wildcard patterns from config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            "*": "ask",
            "orchestrator-*": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})
        // general and code-reviewer should be ask, orchestrator-* denied
        expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("ask")
        expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("ask")
        expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset).action).toBe("deny")
      },
    })
  })

  test("evaluate respects task permission from config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            general: "allow",
            "code-reviewer": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})
        expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
        // Unspecified agents default to "ask"
        expect(PermissionNext.evaluate("task", "unknown-agent", ruleset).action).toBe("ask")
      },
    })
  })

  test("mixed permission config with task and other tools", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          bash: "allow",
          edit: "ask",
          task: {
            "*": "deny",
            general: "allow",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})

        // Verify task permissions
        expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")

        // Verify other tool permissions
        expect(PermissionNext.evaluate("bash", "*", ruleset).action).toBe("allow")
        expect(PermissionNext.evaluate("edit", "*", ruleset).action).toBe("ask")

        // Verify disabled tools
        const disabled = PermissionNext.disabled(["bash", "edit", "task"], ruleset)
        expect(disabled.has("bash")).toBe(false)
        expect(disabled.has("edit")).toBe(false)
        // task is NOT disabled because disabled() uses findLast, and the last rule
        // matching "task" permission is {pattern: "general", action: "allow"}, not pattern: "*"
        expect(disabled.has("task")).toBe(false)
      },
    })
  })

  test("task tool stays visible even when global deny comes last in config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            general: "allow",
            "code-reviewer": "allow",
            "*": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})

        // Last matching rule wins - "*" deny is last, so all agents are denied
        expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("deny")
        expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
        expect(PermissionNext.evaluate("task", "unknown", ruleset).action).toBe("deny")

        // The task tool stays visible and runtime evaluation handles the deny.
        const disabled = PermissionNext.disabled(["task"], ruleset)
        expect(disabled.has("task")).toBe(false)
      },
    })
  })

  test("task tool NOT disabled when specific allow comes last in config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            "*": "deny",
            general: "allow",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})

        // Evaluate uses findLast - "general" allow comes after "*" deny
        expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("allow")
        // Other agents still denied by the earlier "*" deny
        expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")

        // disabled() uses findLast and checks if the last rule has pattern: "*" with action: "deny"
        // In this case, the last rule is {pattern: "general", action: "allow"}, not pattern: "*"
        // So the task tool is NOT disabled (even though most subagents are denied)
        const disabled = PermissionNext.disabled(["task"], ruleset)
        expect(disabled.has("task")).toBe(false)
      },
    })
  })
})
