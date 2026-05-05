import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "skill-registry" })

/**
 * SkillRegistry tracks which skills have been loaded in the current session.
 * This enables task DAG integration where tasks can be blocked until specific
 * skills are loaded.
 */
const loadedSkills = Instance.state(() => new Set<string>())

/**
 * Marks a skill as loaded. Idempotent - calling multiple times has no effect.
 * @param skillName - The name of the skill to mark as loaded
 */
function markLoaded(skillName: string): void {
  const normalized = skillName.trim().toLowerCase()
  if (!normalized) {
    log.warn("attempted to mark empty skill name as loaded")
    return
  }

  const registry = loadedSkills()
  if (!registry.has(normalized)) {
    registry.add(normalized)
    log.info(`skill marked as loaded: ${normalized}`)
  }
}

/**
 * Checks if a skill has been loaded.
 * @param skillName - The name of the skill to check
 * @returns true if the skill has been loaded, false otherwise
 */
function isLoaded(skillName: string): boolean {
  const normalized = skillName.trim().toLowerCase()
  return loadedSkills().has(normalized)
}

/**
 * Checks if all skills in a list have been loaded.
 * @param skillNames - Array of skill names to check
 * @returns Object with overall status and details per skill
 */
function checkAllLoaded(skillNames: string[]): {
  allLoaded: boolean
  loaded: string[]
  missing: string[]
} {
  const loaded: string[] = []
  const missing: string[] = []

  for (const name of skillNames) {
    const normalized = name.trim().toLowerCase()
    if (!normalized) continue

    if (isLoaded(normalized)) {
      loaded.push(normalized)
    } else {
      missing.push(normalized)
    }
  }

  return {
    allLoaded: missing.length === 0,
    loaded,
    missing,
  }
}

/**
 * Gets all currently loaded skills.
 * @returns Array of loaded skill names (normalized)
 */
function getLoadedSkills(): string[] {
  return Array.from(loadedSkills())
}

/**
 * Clears all loaded skills. Useful for testing or session reset.
 */
function clear(): void {
  loadedSkills().clear()
  log.info("skill registry cleared")
}

/**
 * Gets the count of loaded skills.
 */
function count(): number {
  return loadedSkills().size
}

export const SkillRegistry = {
  markLoaded,
  isLoaded,
  checkAllLoaded,
  getLoadedSkills,
  clear,
  count,
}
