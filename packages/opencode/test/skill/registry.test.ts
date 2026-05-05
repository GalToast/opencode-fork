import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { SkillRegistry } from "../../src/skill/registry"
import { tmpdir } from "../fixture/fixture"

describe("SkillRegistry", () => {
  describe("markLoaded()", () => {
    test("should add a skill to the registry", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("test-skill")
          expect(SkillRegistry.isLoaded("test-skill")).toBe(true)
        },
      })
    })

    test("should be idempotent - calling multiple times has no effect", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("test-skill")
          SkillRegistry.markLoaded("test-skill")
          SkillRegistry.markLoaded("test-skill")
          expect(SkillRegistry.count()).toBe(1)
          expect(SkillRegistry.getLoadedSkills()).toEqual(["test-skill"])
        },
      })
    })

    test("should normalize skill names to lowercase", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("MySkill")
          expect(SkillRegistry.isLoaded("myskill")).toBe(true)
          expect(SkillRegistry.isLoaded("MYSKILL")).toBe(true)
          expect(SkillRegistry.isLoaded("MySkill")).toBe(true)
        },
      })
    })

    test("should trim whitespace from skill names", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("  test-skill  ")
          expect(SkillRegistry.isLoaded("test-skill")).toBe(true)
          expect(SkillRegistry.isLoaded("  test-skill  ")).toBe(true)
        },
      })
    })

    test("should ignore empty strings after trimming", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("")
          SkillRegistry.markLoaded("   ")
          expect(SkillRegistry.count()).toBe(0)
          expect(SkillRegistry.getLoadedSkills()).toEqual([])
        },
      })
    })

    test("should handle multiple different skills", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("skill-one")
          SkillRegistry.markLoaded("skill-two")
          SkillRegistry.markLoaded("skill-three")
          expect(SkillRegistry.count()).toBe(3)
          expect(SkillRegistry.isLoaded("skill-one")).toBe(true)
          expect(SkillRegistry.isLoaded("skill-two")).toBe(true)
          expect(SkillRegistry.isLoaded("skill-three")).toBe(true)
        },
      })
    })
  })

  describe("isLoaded()", () => {
    test("should return false for skills that have not been loaded", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(SkillRegistry.isLoaded("nonexistent-skill")).toBe(false)
        },
      })
    })

    test("should return true for skills that have been loaded", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("loaded-skill")
          expect(SkillRegistry.isLoaded("loaded-skill")).toBe(true)
        },
      })
    })

    test("should be case-insensitive", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("TestSkill")
          expect(SkillRegistry.isLoaded("testskill")).toBe(true)
          expect(SkillRegistry.isLoaded("TESTSKILL")).toBe(true)
          expect(SkillRegistry.isLoaded("TestSkill")).toBe(true)
        },
      })
    })

    test("should handle whitespace in query", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("my-skill")
          expect(SkillRegistry.isLoaded("  my-skill  ")).toBe(true)
        },
      })
    })

    test("should return false for empty string", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(SkillRegistry.isLoaded("")).toBe(false)
          expect(SkillRegistry.isLoaded("   ")).toBe(false)
        },
      })
    })
  })

  describe("checkAllLoaded()", () => {
    test("should return allLoaded: true when all skills are loaded", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("skill-a")
          SkillRegistry.markLoaded("skill-b")
          SkillRegistry.markLoaded("skill-c")

          const result = SkillRegistry.checkAllLoaded(["skill-a", "skill-b", "skill-c"])
          expect(result.allLoaded).toBe(true)
          expect(result.loaded).toEqual(["skill-a", "skill-b", "skill-c"])
          expect(result.missing).toEqual([])
        },
      })
    })

    test("should return allLoaded: false when some skills are missing", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("skill-a")
          SkillRegistry.markLoaded("skill-c")

          const result = SkillRegistry.checkAllLoaded(["skill-a", "skill-b", "skill-c"])
          expect(result.allLoaded).toBe(false)
          expect(result.loaded).toEqual(["skill-a", "skill-c"])
          expect(result.missing).toEqual(["skill-b"])
        },
      })
    })

    test("should return allLoaded: false when all skills are missing", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = SkillRegistry.checkAllLoaded(["skill-x", "skill-y", "skill-z"])
          expect(result.allLoaded).toBe(false)
          expect(result.loaded).toEqual([])
          expect(result.missing).toEqual(["skill-x", "skill-y", "skill-z"])
        },
      })
    })

    test("should return allLoaded: true for empty input array", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = SkillRegistry.checkAllLoaded([])
          expect(result.allLoaded).toBe(true)
          expect(result.loaded).toEqual([])
          expect(result.missing).toEqual([])
        },
      })
    })

    test("should normalize skill names to lowercase", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("SkillA")
          SkillRegistry.markLoaded("SkillB")

          const result = SkillRegistry.checkAllLoaded(["SKILLA", "skillb"])
          expect(result.allLoaded).toBe(true)
          expect(result.loaded).toEqual(["skilla", "skillb"])
        },
      })
    })

    test("should skip empty strings in the input", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("skill-a")

          const result = SkillRegistry.checkAllLoaded(["skill-a", "", "   ", "skill-b"])
          expect(result.allLoaded).toBe(false)
          expect(result.loaded).toEqual(["skill-a"])
          expect(result.missing).toEqual(["skill-b"])
        },
      })
    })
  })

  describe("getLoadedSkills()", () => {
    test("should return empty array when no skills are loaded", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(SkillRegistry.getLoadedSkills()).toEqual([])
        },
      })
    })

    test("should return all loaded skills", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("alpha")
          SkillRegistry.markLoaded("beta")
          SkillRegistry.markLoaded("gamma")

          const skills = SkillRegistry.getLoadedSkills()
          expect(skills.length).toBe(3)
          expect(skills).toContain("alpha")
          expect(skills).toContain("beta")
          expect(skills).toContain("gamma")
        },
      })
    })

    test("should return skills in normalized form", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("MySkill")
          SkillRegistry.markLoaded("AnotherSkill")

          const skills = SkillRegistry.getLoadedSkills()
          expect(skills).toContain("myskill")
          expect(skills).toContain("anotherskill")
        },
      })
    })

    test("should not contain duplicates", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("duplicate")
          SkillRegistry.markLoaded("DUPLICATE")
          SkillRegistry.markLoaded("  duplicate  ")

          const skills = SkillRegistry.getLoadedSkills()
          expect(skills.length).toBe(1)
          expect(skills[0]).toBe("duplicate")
        },
      })
    })
  })

  describe("clear()", () => {
    test("should empty the registry", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("skill-one")
          SkillRegistry.markLoaded("skill-two")
          SkillRegistry.markLoaded("skill-three")
          expect(SkillRegistry.count()).toBe(3)

          SkillRegistry.clear()
          expect(SkillRegistry.count()).toBe(0)
          expect(SkillRegistry.getLoadedSkills()).toEqual([])
          expect(SkillRegistry.isLoaded("skill-one")).toBe(false)
        },
      })
    })

    test("should be safe to call on empty registry", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(SkillRegistry.count()).toBe(0)
          SkillRegistry.clear()
          expect(SkillRegistry.count()).toBe(0)
        },
      })
    })

    test("should allow re-adding skills after clear", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("skill-a")
          SkillRegistry.clear()
          SkillRegistry.markLoaded("skill-b")

          expect(SkillRegistry.count()).toBe(1)
          expect(SkillRegistry.isLoaded("skill-a")).toBe(false)
          expect(SkillRegistry.isLoaded("skill-b")).toBe(true)
        },
      })
    })
  })

  describe("count()", () => {
    test("should return 0 when no skills are loaded", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(SkillRegistry.count()).toBe(0)
        },
      })
    })

    test("should return correct count after adding skills", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(SkillRegistry.count()).toBe(0)
          SkillRegistry.markLoaded("one")
          expect(SkillRegistry.count()).toBe(1)
          SkillRegistry.markLoaded("two")
          expect(SkillRegistry.count()).toBe(2)
          SkillRegistry.markLoaded("three")
          expect(SkillRegistry.count()).toBe(3)
        },
      })
    })

    test("should not increment count for duplicate additions", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("same-skill")
          SkillRegistry.markLoaded("same-skill")
          SkillRegistry.markLoaded("SAME-SKILL")
          expect(SkillRegistry.count()).toBe(1)
        },
      })
    })

    test("should return 0 after clear", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("skill-a")
          SkillRegistry.markLoaded("skill-b")
          expect(SkillRegistry.count()).toBe(2)

          SkillRegistry.clear()
          expect(SkillRegistry.count()).toBe(0)
        },
      })
    })
  })

  describe("Edge cases", () => {
    test("should handle skills with special characters", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("skill-with-dashes")
          SkillRegistry.markLoaded("skill_with_underscores")
          SkillRegistry.markLoaded("skill.with.dots")
          SkillRegistry.markLoaded("skill123")

          expect(SkillRegistry.isLoaded("skill-with-dashes")).toBe(true)
          expect(SkillRegistry.isLoaded("skill_with_underscores")).toBe(true)
          expect(SkillRegistry.isLoaded("skill.with.dots")).toBe(true)
          expect(SkillRegistry.isLoaded("skill123")).toBe(true)
          expect(SkillRegistry.count()).toBe(4)
        },
      })
    })

    test("should handle very long skill names", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const longName = "a".repeat(1000)
          SkillRegistry.markLoaded(longName)
          expect(SkillRegistry.isLoaded(longName)).toBe(true)
          expect(SkillRegistry.count()).toBe(1)
        },
      })
    })

    test("should handle skills with only whitespace differences as same", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("skill")
          SkillRegistry.markLoaded(" skill")
          SkillRegistry.markLoaded("skill ")
          SkillRegistry.markLoaded(" skill ")
          SkillRegistry.markLoaded("  skill  ")

          expect(SkillRegistry.count()).toBe(1)
          expect(SkillRegistry.getLoadedSkills()).toEqual(["skill"])
        },
      })
    })

    test("case normalization: different cases should refer to same skill", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("JavaScript")
          SkillRegistry.markLoaded("javascript")
          SkillRegistry.markLoaded("JAVASCRIPT")
          SkillRegistry.markLoaded("JaVaScRiPt")

          expect(SkillRegistry.count()).toBe(1)
          expect(SkillRegistry.isLoaded("javascript")).toBe(true)
          expect(SkillRegistry.isLoaded("JAVASCRIPT")).toBe(true)
          expect(SkillRegistry.isLoaded("JavaScript")).toBe(true)
        },
      })
    })

    test("checkAllLoaded with mixed case and whitespace", async () => {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          SkillRegistry.markLoaded("SkillA")
          SkillRegistry.markLoaded("SkillB")

          const result = SkillRegistry.checkAllLoaded(["  SKILLA  ", "skillb", "SkillC"])
          expect(result.allLoaded).toBe(false)
          expect(result.loaded).toEqual(["skilla", "skillb"])
          expect(result.missing).toEqual(["skillc"])
        },
      })
    })
  })
})
