import z from "zod"
import path from "path"
import os from "os"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { NamedError } from "@opencode-ai/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { Discovery } from "./discovery"
import { Glob } from "../util/glob"

const log = Log.create({ service: "skill" })

const InfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  content: z.string(),
})
export type Info = z.infer<typeof InfoSchema>

export const InvalidError = NamedError.create(
  "SkillInvalidError",
  z.object({
    path: z.string(),
    message: z.string().optional(),
    issues: z.custom<z.core.$ZodIssue[]>().optional(),
  }),
)

export const NameMismatchError = NamedError.create(
  "SkillNameMismatchError",
  z.object({
    path: z.string(),
    expected: z.string(),
    actual: z.string(),
  }),
)

// External skill directories to search for (project-level and global)
const EXTERNAL_DIRS = [".claude", ".agents", ".gemini"]
const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"

const state = Instance.state(async () => {
  const skills: Record<string, Info> = {}
  const skillDirs = new Set<string>()

  const addSkill = async (match: string) => {
    const md = await ConfigMarkdown.parse(match).catch((err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse skill ${match}`
      void Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load skill", { skill: match, err })
      return undefined
    })

    if (!md) return

  const parsed = InfoSchema.pick({ name: true, description: true }).safeParse(md.data)
    if (!parsed.success) return

    // Warn on duplicate skill names
    if (skills[parsed.data.name]) {
      log.warn("duplicate skill name", {
        name: parsed.data.name,
        existing: skills[parsed.data.name].location,
        duplicate: match,
      })
    }

    skillDirs.add(path.dirname(match))

    skills[parsed.data.name] = {
      name: parsed.data.name,
      description: parsed.data.description,
      location: match,
      content: md.content,
    }
  }

  const scanExternal = async (root: string, scope: "global" | "project") => {
    return Glob.scan(EXTERNAL_SKILL_PATTERN, {
      cwd: root,
      absolute: true,
      include: "file",
      dot: true,
      symlink: true,
    })
      .then((matches) => Promise.all(matches.map(addSkill)))
      .catch((error) => {
        log.error(`failed to scan ${scope} skills`, { dir: root, error })
      })
  }

  // Scan external skill directories (.claude/skills/, .agents/skills/, etc.)
  // Load global (home) first, then project-level (so project-level overwrites)
  if (!Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS) {
    for (const dir of EXTERNAL_DIRS) {
      const root = path.join(Global.Path.home, dir)
      if (!Filesystem.isDir(root)) continue
      await scanExternal(root, "global")
    }

    for await (const root of Filesystem.up({
      targets: EXTERNAL_DIRS,
      start: Instance.directory,
      stop: Instance.worktree,
    })) {
      await scanExternal(root, "project")
    }
  }

  // Scan .opencode/skill/ directories
  for (const dir of await Config.directories()) {
    const matches = await Glob.scan(OPENCODE_SKILL_PATTERN, {
      cwd: dir,
      absolute: true,
      include: "file",
      symlink: true,
    })
    for (const match of matches) {
      await addSkill(match)
    }
  }

  // Scan additional skill paths from config
  const config = await Config.get()
  for (const skillPath of config.skills?.paths ?? []) {
    const expanded = skillPath.startsWith("~/") ? path.join(os.homedir(), skillPath.slice(2)) : skillPath
    const resolved = path.isAbsolute(expanded) ? expanded : path.join(Instance.directory, expanded)
    if (!Filesystem.isDir(resolved)) {
      log.warn("skill path not found", { path: resolved })
      continue
    }
    const matches = await Glob.scan(SKILL_PATTERN, {
      cwd: resolved,
      absolute: true,
      include: "file",
      symlink: true,
    })
    for (const match of matches) {
      await addSkill(match)
    }
  }

  // Download and load skills from URLs
  for (const url of config.skills?.urls ?? []) {
    const list = await Discovery.pull(url)
    for (const dir of list) {
      skillDirs.add(dir)
      const matches = await Glob.scan(SKILL_PATTERN, {
        cwd: dir,
        absolute: true,
        include: "file",
        symlink: true,
      })
      for (const match of matches) {
        await addSkill(match)
      }
    }
  }

  return {
    skills,
    dirs: Array.from(skillDirs),
  }
})

export const get = async (name: string) => state().then((x) => x.skills[name])

export const all = async () => state().then((x) => Object.values(x.skills))

export const dirs = async () => state().then((x) => x.dirs)

export const Skill = {
  Info: InfoSchema,
  InvalidError,
  NameMismatchError,
  state,
  get,
  all,
  dirs,
}
