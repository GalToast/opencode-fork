import { describe, test, expect, spyOn, jest } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"
import { PermissionNext } from "../../src/permission/next"
import { Agent } from "../../src/agent/agent"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("autoHeavy Security Permission logic", () => {
  test("PermissionNext.evaluate correctly identifies deny for task tool", () => {
    const ruleset: PermissionNext.Ruleset = [
      {
        permission: "task",
        pattern: "*",
        action: "deny",
      },
    ]
    const permission = PermissionNext.evaluate("task", "orchestrator-fast", ruleset)
    expect(permission.action).toBe("deny")
  })

  test("PermissionNext.evaluate correctly identifies allow for task tool", () => {
    const ruleset: PermissionNext.Ruleset = [
      {
        permission: "task",
        pattern: "*",
        action: "allow",
      },
    ]
    const permission = PermissionNext.evaluate("task", "orchestrator-fast", ruleset)
    expect(permission.action).toBe("allow")
  })
})
