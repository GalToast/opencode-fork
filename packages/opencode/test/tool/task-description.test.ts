import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { TaskTool } from "../../src/tool/task"

describe("tool.task description", () => {
  test("uses real copyable launch guidance instead of fictional example agents", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()

        expect(tool.description).toContain('subagent_type="general"')
        expect(tool.description).toContain('task(action="message", task_id="ses_..."')
        expect(tool.description).toContain('subagent_type="explore"')
        expect(tool.description).not.toContain("code-reviewer")
        expect(tool.description).not.toContain("greeting-responder")
      },
    })
  })
})
