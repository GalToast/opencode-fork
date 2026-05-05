import { Tracker } from "./service"
import { TaskStatus, type TrackerTask } from "./types"

async function context(taskId?: string): Promise<string | undefined> {
  if (!taskId) return undefined

  const tracker = await Tracker.get()
  const allTasks = await tracker.listTasks()
  const taskMap = new Map(allTasks.map((task) => [task.id, task]))

  const current = taskMap.get(taskId)
  if (!current) return undefined

  const blocks: string[] = []
  blocks.push(`## Current Task: [${current.id}] ${current.title}`)
  if (current.description) blocks.push(current.description)

  const deps = current.dependencies
    .map((id) => taskMap.get(id))
    .filter((task): task is TrackerTask => !!task)

  if (deps.length > 0) {
    blocks.push("### Dependencies & Results")
    for (const dep of deps) {
      let line = `- [${dep.id}] ${dep.title} (${dep.status})`
      if (dep.results && Object.keys(dep.results).length > 0) {
        line += `\n  - Results: ${JSON.stringify(dep.results)}`
      }
      if (dep.artifacts && dep.artifacts.length > 0) {
        line += `\n  - Artifacts: ${dep.artifacts.join(", ")}`
      }
      blocks.push(line)
    }
  }

  const children = allTasks.filter((task) => task.parentId === current.id)
  if (children.length > 0) {
    blocks.push("### Sub-tasks")
    for (const child of children) {
      blocks.push(`- [${child.id}] ${child.title} (${child.status})`)
    }
  }

  return blocks.join("\n")
}

export const TrackerMaterialize = {
  context,
}
