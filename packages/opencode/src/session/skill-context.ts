/* eslint-disable @typescript-eslint/no-namespace */

import { createHash } from "crypto"
import { Skill } from "@/skill"
import { SkillRegistry } from "@/skill/registry"
import { Tracker } from "@/tracker/service"
import { TaskStatus, type TrackerTask } from "@/tracker/types"
import { Instance } from "@/project/instance"

type SkillReference = {
  name: string
  description: string
  sourceTasks: string[]
}

type RankedSkill = {
  name: string
  description: string
  score: number
}

function looksCodeHeavyTask(text?: string) {
  const value = text ?? ""
  if (!value.trim()) return false
  return /(?:\b(?:code|repo|repository|module|component|function|class|hook|handler|endpoint|route|provider|session|prompt|tool|tracker|blackboard|jit|typescript|javascript|tsx?|jsx?|bug|regression|refactor|implement|debug|fix)\b|[\\/]|\.tsx?\b|\.jsx?\b)/i.test(
    value,
  )
}

function compareSourceTasks(a: string, b: string) {
  const [aID, aTitle = ""] = a.split(": ", 2)
  const [bID, bTitle = ""] = b.split(": ", 2)
  return aTitle.localeCompare(bTitle) || aID.localeCompare(bID)
}

export namespace SessionSkillContext {
  const cache = Instance.state(() => new Map<string, string | undefined>())

  function normalizeRecommendedSkills(value: unknown) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    )
  }

  function tokenize(text?: string) {
    return (text ?? "")
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length >= 3)
  }

  function taskScore(task: TrackerTask, queryTokens: string[]) {
    const statusWeight =
      task.status === TaskStatus.IN_PROGRESS ? 6 : task.status === TaskStatus.OPEN ? 5 : task.status === TaskStatus.BLOCKED ? 4 : 0
    if (statusWeight === 0) return 0
    const searchSpace = `${task.title} ${task.description}`.toLowerCase()
    let score = statusWeight
    for (const token of queryTokens) {
      if (!searchSpace.includes(token)) continue
      score += task.title.toLowerCase().includes(token) ? 3 : 1
    }
    return score
  }

  async function collectLikelySkills(input: { taskContext?: string; maxSkills: number }): Promise<RankedSkill[]> {
    const queryTokens = tokenize(input.taskContext)
    if (queryTokens.length === 0) return []

    const skills = await Skill.all().catch(() => [])
    if (skills.length === 0) return []

    return skills
      .map((skill) => {
        const searchSpace = `${skill.name} ${skill.description}`.toLowerCase()
        let score = 0
        for (const token of queryTokens) {
          if (!searchSpace.includes(token)) continue
          score += skill.name.toLowerCase().includes(token) ? 3 : 1
        }
        return {
          name: skill.name,
          description: skill.description,
          score,
        }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, input.maxSkills)
  }

  async function collectReferences(input: { taskContext?: string; maxSkills: number }): Promise<SkillReference[]> {
    const tracker = await Tracker.get().catch(() => undefined)
    if (!tracker) return []
    const tasks = await tracker.listTasks().catch(() => [])
    if (!tasks.length) return []

    const queryTokens = tokenize(input.taskContext)
    const orderedTasks = tasks
      .map((task) => ({
        task,
        recommendedSkills: normalizeRecommendedSkills(task.metadata?.recommendedSkills),
        score: taskScore(task, queryTokens),
      }))
      .filter((entry) => entry.recommendedSkills.length > 0 && entry.score > 0)
      .sort((a, b) => b.score - a.score || a.task.title.localeCompare(b.task.title) || a.task.id.localeCompare(b.task.id))

    const references = new Map<string, SkillReference>()
    for (const entry of orderedTasks) {
      for (const name of entry.recommendedSkills) {
        if (!references.has(name)) {
          const info = await Skill.get(name)
          references.set(name, {
            name,
            description: info?.description ?? "Referenced by the task graph but not currently installed as a local skill.",
            sourceTasks: [],
          })
        }
        const reference = references.get(name)
        if (!reference) continue
        reference.sourceTasks.push(`${entry.task.id}: ${entry.task.title}`)
        if (references.size >= input.maxSkills && reference.sourceTasks.length > 0) {
          // Keep collecting source tasks for already-selected skills, but stop adding brand-new ones.
          continue
        }
      }
      if (references.size >= input.maxSkills) break
    }

    return [...references.values()]
      .map((reference) => ({
        ...reference,
        sourceTasks: [...reference.sourceTasks].sort(compareSourceTasks),
      }))
      .slice(0, input.maxSkills)
  }

  export async function materialize(input: { taskContext?: string; maxSkills?: number }) {
    const maxSkills = input.maxSkills ?? 5
    const references = await collectReferences({ taskContext: input.taskContext, maxSkills })
    if (references.length === 0) return undefined

    const key = createHash("sha1")
      .update(
        JSON.stringify({
          taskContext: input.taskContext ?? "",
          references,
        }),
      )
      .digest("hex")

    const cached = cache().get(key)
    if (cached !== undefined) return cached

    const prompt = [
      "The task graph recommends these skills as lightweight references for the current work.",
      "They are not loaded yet. Use the skill tool to load one by name only if it will actually help.",
      "",
      "<dag_skill_references>",
      ...references.flatMap((reference) => [
        "  <skill_ref>",
        `    <name>${reference.name}</name>`,
        `    <description>${reference.description}</description>`,
        `    <source_tasks>${reference.sourceTasks.join(" | ")}</source_tasks>`,
        "  </skill_ref>",
      ]),
      "</dag_skill_references>",
    ].join("\n")

    cache().set(key, prompt)
    return prompt
  }

  export async function materializeLikely(input: { taskContext?: string; maxSkills?: number }) {
    const maxSkills = input.maxSkills ?? 4
    const ranked = await collectLikelySkills({ taskContext: input.taskContext, maxSkills })
    if (ranked.length === 0) return undefined
    const best = ranked[0]
    const second = ranked[1]
    const obviousMatch = !!best && best.score >= 2 && (!second || best.score >= second.score + 2)
    const codeHeavy = looksCodeHeavyTask(input.taskContext)

    const key = createHash("sha1")
      .update(
        JSON.stringify({
          likely: ranked,
          taskContext: input.taskContext ?? "",
          obviousMatch,
          codeHeavy,
        }),
      )
      .digest("hex")

    const cached = cache().get(key)
    if (cached !== undefined) return cached

    const prompt = [
      "These skills look like likely matches for the current task based on the user request and current work.",
      "Check this list early and load one directly with the skill tool when the fit is obvious, instead of rebuilding the workflow from scratch.",
      ...(obviousMatch && best
        ? [
            `The strongest match is ${best.name}. Make loading it your first move before planning or delegating from scratch unless you have a concrete reason not to.`,
          ]
        : []),
      "",
      "<likely_skill_matches>",
      ...ranked.flatMap((entry) => [
        "  <skill_match>",
        `    <name>${entry.name}</name>`,
        `    <description>${entry.description}</description>`,
        `    <score>${entry.score}</score>`,
        "  </skill_match>",
      ]),
      "</likely_skill_matches>",
      ...(obviousMatch && best
        ? [
            "",
            "<likely_skill_actions>",
            `  <first_move>skill(name="${best.name}")</first_move>`,
            ...(codeHeavy
              ? [`  <jit_hint>capability(action="enable", targets=["jit"], scope="session")</jit_hint>`]
              : []),
            "</likely_skill_actions>",
          ]
        : codeHeavy
          ? [
              "",
              "<likely_skill_actions>",
              `  <jit_hint>capability(action="enable", targets=["jit"], scope="session")</jit_hint>`,
              "</likely_skill_actions>",
            ]
          : []),
    ].join("\n")

    cache().set(key, prompt)
    return prompt
  }

  export async function materializeLoaded(input?: { maxSkills?: number }) {
    const loadedNames = [...SkillRegistry.getLoadedSkills()].sort((a, b) => a.localeCompare(b))
    if (loadedNames.length === 0) return undefined

    const maxSkills = input?.maxSkills ?? 6
    const selected = loadedNames.slice(0, maxSkills)
    const loaded = await Promise.all(
      selected.map(async (name) => {
        const info = await Skill.get(name)
        return {
          name,
          description: info?.description ?? "Loaded skill",
          content: info?.content?.trim(),
        }
      }),
    )

    const present = loaded.filter(
      (entry): entry is { name: string; description: string; content: string } => {
        return !!entry.content
      },
    )
    if (present.length === 0) return undefined

    const key = createHash("sha1")
      .update(
        JSON.stringify({
          loaded: present.map((entry) => ({
            name: entry.name,
            description: entry.description,
            content: entry.content,
          })),
        }),
      )
      .digest("hex")

    const cached = cache().get(key)
    if (cached !== undefined) return cached

    const prompt = [
      "These skills were explicitly loaded earlier in the session. Treat them as active working instructions until they are unloaded or replaced.",
      "",
      "<loaded_skills>",
      ...present.flatMap((entry) => [
        `  <loaded_skill name="${entry.name}">`,
        `    <description>${entry.description}</description>`,
        "",
        entry.content,
        "  </loaded_skill>",
      ]),
      "</loaded_skills>",
    ].join("\n")

    cache().set(key, prompt)
    return prompt
  }
}
