import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { SkillRegistry } from "../../src/skill/registry"
import { SessionSkillContext } from "../../src/session/skill-context"
import { Tracker } from "../../src/tracker/service"
import { tmpdir } from "../fixture/fixture"

describe("SessionSkillContext", () => {
  test("materializeLoaded is stable regardless of load order", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const alphaDir = path.join(dir, ".opencode", "skill", "alpha")
        const zetaDir = path.join(dir, ".opencode", "skill", "zeta")
        await fs.mkdir(alphaDir, { recursive: true })
        await fs.mkdir(zetaDir, { recursive: true })
        await Bun.write(
          path.join(alphaDir, "SKILL.md"),
          `---
name: alpha
description: Alpha skill for stable prompt ordering.
---

# Alpha
`,
        )
        await Bun.write(
          path.join(zetaDir, "SKILL.md"),
          `---
name: zeta
description: Zeta skill for stable prompt ordering.
---

# Zeta
`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          SkillRegistry.clear()
          SkillRegistry.markLoaded("zeta")
          SkillRegistry.markLoaded("alpha")

          const first = await SessionSkillContext.materializeLoaded()

          SkillRegistry.clear()
          SkillRegistry.markLoaded("alpha")
          SkillRegistry.markLoaded("zeta")

          const second = await SessionSkillContext.materializeLoaded()

          expect(first).toBeDefined()
          expect(second).toBeDefined()
          expect(first).toBe(second)
          expect(first).toContain('<loaded_skill name="alpha">')
          expect(first).toContain('<loaded_skill name="zeta">')
          expect(first!.indexOf('<loaded_skill name="alpha">')).toBeLessThan(
            first!.indexOf('<loaded_skill name="zeta">'),
          )
        } finally {
          SkillRegistry.clear()
        }
      },
    })
  })

  test("materialize keeps source task ordering deterministic for equal-score references", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill", "frontend-design")
        await fs.mkdir(skillDir, { recursive: true })
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: frontend-design
description: Build polished frontend interfaces.
---

# Frontend Design
`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          const tracker = await Tracker.get()
          SkillRegistry.clear()
          await tracker.createTask({
            title: "Zeta shell polish",
            description: "Polish the interface shell",
            type: "task",
            status: "in_progress",
            dependencies: [],
            metadata: {
              recommendedSkills: ["frontend-design"],
            },
          })
          await tracker.createTask({
            title: "Alpha shell polish",
            description: "Polish the interface shell",
            type: "task",
            status: "in_progress",
            dependencies: [],
            metadata: {
              recommendedSkills: ["frontend-design"],
            },
          })

          const prompt = await SessionSkillContext.materialize({ taskContext: "polish the interface shell" })

          expect(prompt).toBeDefined()
          expect(prompt).toContain("<dag_skill_references>")
          expect(prompt).toContain("Alpha shell polish")
          expect(prompt).toContain("Zeta shell polish")
          expect(prompt!.indexOf("Alpha shell polish")).toBeLessThan(prompt!.indexOf("Zeta shell polish"))
        } finally {
          SkillRegistry.clear()
        }
      },
    })
  })
})
