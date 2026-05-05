import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { Ripgrep } from "../file/ripgrep"
import { iife } from "@/util/iife"

type SkillToolMetadata = {
  suggestions?: string[]
  name?: string
  dir?: string
}

export const SkillTool = Tool.define("skill", async (ctx) => {
  const list = await Skill.available(ctx?.agent)
  const ranked = ctx?.taskContext ? rankSkills(list, ctx.taskContext) : list
  const detailed = ranked.slice(0, 6)
  const additional = ranked.slice(6)

  const description =
    list.length === 0
      ? "Load a specialized skill that provides domain-specific instructions and workflows. No skills are currently available."
      : [
          "Load a specialized skill that provides domain-specific instructions and workflows.",
          "",
          "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
          "",
          "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
          "",
          'Tool output includes a `<skill_content name="...">` block with the loaded content.',
          "",
          "The following skills provide specialized sets of instructions for particular tasks",
          "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
          "",
          Skill.fmt(detailed, { verbose: false }),
          additional.length
            ? [
                "",
                "<additional_skill_names>",
                ...additional.map((skill) => `<name>${skill.name}</name>`),
                "</additional_skill_names>",
              ].join("\n")
            : "",
        ].join("\n")

  const examples = list
    .map((skill) => `'${skill.name}'`)
    .slice(0, 3)
    .join(", ")
  const hint = examples.length > 0 ? ` (e.g., ${examples}, ...)` : ""

  const parameters = z.object({
    name: z.string().optional().describe(`The name of the skill from available_skills${hint}`),
    query: z.string().optional().describe("Optional search query to suggest matching skills before loading one."),
  })

  return {
    description,
    parameters,
    async execute(
      params: z.infer<typeof parameters>,
      ctx,
    ): Promise<{ title: string; output: string; metadata: SkillToolMetadata }> {
      if (!params.name) {
        const suggestions = rankSkills(list, params.query ?? ctx?.extra?.taskContext ?? ctx?.agent ?? "").slice(0, 5)
        return {
          title: "Skill Suggestions",
          output: [
            "<skill_suggestions>",
            ...suggestions.map((skill) => `  <skill name="${skill.name}">${skill.description}</skill>`),
            "</skill_suggestions>",
            suggestions[0] ? `<recommended_first_move>skill(name="${suggestions[0].name}")</recommended_first_move>` : "",
          ].join("\n"),
          metadata: {
            suggestions: suggestions.map((skill) => skill.name),
          },
        }
      }

      const skill = await Skill.get(params.name)

      if (!skill) {
        const available = await Skill.all().then((x) => x.map((skill) => skill.name).join(", "))
        throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {},
      })

      const dir = path.dirname(skill.location)
      const base = pathToFileURL(dir).href

      const limit = 10
      const files = await iife(async () => {
        const arr = []
        for await (const file of Ripgrep.files({
          cwd: dir,
          follow: false,
          hidden: true,
          signal: ctx.abort,
        })) {
          if (file.includes("SKILL.md")) {
            continue
          }
          arr.push(path.resolve(dir, file))
          if (arr.length >= limit) {
            break
          }
        }
        return arr
      }).then((f) => f.map((file) => `<file>${file}</file>`).join("\n"))

      return {
        title: `Loaded skill: ${skill.name}`,
        output: [
          `<skill_content name="${skill.name}">`,
          `# Skill: ${skill.name}`,
          "",
          skill.content.trim(),
          "",
          `Base directory for this skill: ${base}`,
          "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
          "Note: file list is sampled.",
          "",
          "<skill_files>",
          files,
          "</skill_files>",
          "</skill_content>",
        ].join("\n"),
        metadata: {
          suggestions: [],
          name: skill.name,
          dir,
        },
      }
    },
  }
})

function rankSkills(list: Awaited<ReturnType<typeof Skill.available>>, query: string) {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean)
  if (terms.length === 0) return list.slice().sort((a, b) => a.name.localeCompare(b.name))
  return list
    .map((skill) => {
      const haystack = `${skill.name} ${skill.description}`.toLowerCase()
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0)
      return { skill, score }
    })
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .map((item) => item.skill)
}
