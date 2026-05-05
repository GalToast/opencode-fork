import { Tracker, TrackerStorage } from "@/tracker/service"
import { TaskStatus, TaskStatusSchema, TaskType, TaskTypeSchema } from "@/tracker/types"
import { SkillRegistry } from "@/skill/registry"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { Todo } from "@/session/todo"
import z from "zod"
import { Tool } from "./tool"

async function askRead(ctx: Tool.Context) {
  await ctx.ask({
    permission: "tracker_read",
    patterns: [TrackerStorage.pattern()],
    always: [TrackerStorage.pattern()],
    metadata: {},
  })
}

async function askWrite(ctx: Tool.Context, permission: string) {
  await ctx.ask({
    permission,
    patterns: [TrackerStorage.pattern()],
    always: [TrackerStorage.pattern()],
    metadata: {},
  })
}

export const TrackerCreateTaskTool = Tool.define("tracker_create_task", {
  description: "Creates a new task in the tracker.",
  parameters: z.object({
    title: z.string().describe("Short title of the task."),
    description: z.string().describe("Detailed description of the task."),
    type: TaskTypeSchema.describe("Type of the task."),
    parentId: z.string().optional().describe("Optional ID of the parent task."),
    dependencies: z.array(z.string()).optional().describe("Optional list of task IDs that this task depends on."),
    requiredSkills: z
      .array(z.string())
      .optional()
      .describe("Skills that must be loaded for this task to unblock. These are required for DAG dependency evaluation."),
    recommendedSkills: z
      .array(z.string())
      .optional()
      .describe("Optional skill names that are relevant to this task. These become lightweight DAG-linked skill references."),
  }),
  async execute(params, ctx) {
    await askWrite(ctx, "tracker_create_task")
    const tracker = await Tracker.get()
    const metadata: Record<string, unknown> = {}
    if (params.recommendedSkills?.length) {
      metadata.recommendedSkills = params.recommendedSkills
    }
    const task = await tracker.createTask({
      title: params.title,
      description: params.description,
      type: params.type,
      status: TaskStatus.OPEN,
      parentId: params.parentId,
      dependencies: params.dependencies ?? [],
      requiredSkills: params.requiredSkills,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    })

    return {
      title: `Created ${task.id}`,
      output: `Created task ${task.id}: ${task.title}`,
      metadata: { task },
    }
  },
})

export const TrackerUpdateTaskTool = Tool.define("tracker_update_task", {
  description: "Updates an existing task in the tracker. Use this to change status, add dependencies, or record findings in 'results'.",
  parameters: z.object({
    id: z.string().describe("The 6-character hex ID of the task to update."),
    title: z.string().optional().describe("New title for the task."),
    description: z.string().optional().describe("New description for the task."),
    status: TaskStatusSchema.optional().describe("New status for the task."),
    dependencies: z.array(z.string()).optional().describe("New list of dependency IDs."),
    requiredSkills: z
      .array(z.string())
      .optional()
      .describe("Skills that must be loaded for this task to unblock. Replaces existing required skills."),
    results: z.record(z.string(), z.any()).optional().describe("Findings or data to store in the task (e.g. { 'found_email': 'test@example.com' })."),
    conditionalGates: z.record(z.string(), z.string()).optional().describe("Maps result keys to target taskId signals for conditional unblocking."),
    recommendedSkills: z
      .array(z.string())
      .optional()
      .describe("Optional skill names that are relevant to this task. Stored as lightweight DAG-linked skill references."),
  }),
  async execute(params, ctx) {
    await askWrite(ctx, "tracker_update_task")
    const tracker = await Tracker.get()
    const { recommendedSkills, requiredSkills, ...rest } = params
    const metadata: Record<string, unknown> = {}
    if (recommendedSkills !== undefined) {
      metadata.recommendedSkills = recommendedSkills
    }
    const updates = {
      ...rest,
      requiredSkills,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    }
    const task = await tracker.updateTask(params.id, updates)

    return {
      title: `Updated ${params.id}`,
      output: `Updated task ${params.id}: ${task.title}. Status: ${task.status}`,
      metadata: { task },
    }
  },
})

export const TrackerAddArtifactTool = Tool.define("tracker_add_artifact", {
  description: "Links a file or asset to a specific task as an artifact. This helps track which files were created by which task in the DAG.",
  parameters: z.object({
    taskId: z.string().describe("The 6-character hex ID of the task."),
    filePath: z.string().describe("The path to the file to link."),
  }),
  async execute(params, ctx) {
    await askWrite(ctx, "tracker_add_artifact")
    const tracker = await Tracker.get()
    const task = await tracker.addArtifact(params.taskId, params.filePath)
    return {
      title: `Artifact Added to ${params.taskId}`,
      output: `Linked artifact '${params.filePath}' to task ${params.taskId}.`,
      metadata: { task },
    }
  },
})

export const TrackerGetTaskTool = Tool.define("tracker_get_task", {
  description: "Retrieves details for a specific task.",
  parameters: z.object({
    id: z.string().describe("The 6-character hex ID of the task."),
  }),
  async execute(params, ctx) {
    await askRead(ctx)
    const tracker = await Tracker.get()
    const task = await tracker.getTask(params.id)
    return {
      title: task ? `Task ${task.id}` : "Task not found",
      output: task ? JSON.stringify(task, null, 2) : `Task ${params.id} not found.`,
      metadata: { task: task ?? null },
    }
  },
})

export const TrackerListTasksTool = Tool.define("tracker_list_tasks", {
  description: "Lists tasks in the tracker, optionally filtered by status, type, or parent.",
  parameters: z.object({
    status: TaskStatusSchema.optional().describe("Filter by status."),
    type: TaskTypeSchema.optional().describe("Filter by type."),
    parentId: z.string().optional().describe("Filter by parent task ID."),
  }),
  async execute(params, ctx) {
    await askRead(ctx)
    const tracker = await Tracker.get()
    let tasks = await tracker.listTasks()
    if (params.status) tasks = tasks.filter((task) => task.status === params.status)
    if (params.type) tasks = tasks.filter((task) => task.type === params.type)
    if (params.parentId) tasks = tasks.filter((task) => task.parentId === params.parentId)

    const output =
      tasks.length > 0
        ? tasks.map((task) => `- [${task.id}] ${task.title} (${task.status})`).join("\n")
        : "No tasks found matching the criteria."

    return {
      title: `${tasks.length} task${tasks.length === 1 ? "" : "s"}`,
      output,
      metadata: { tasks },
    }
  },
})

export const TrackerAddDependencyTool = Tool.define("tracker_add_dependency", {
  description: "Adds a dependency between two tasks.",
  parameters: z.object({
    taskId: z.string().describe("The ID of the task that has a dependency."),
    dependencyId: z.string().describe("The ID of the task that is being depended upon."),
  }),
  async execute(params, ctx) {
    await askWrite(ctx, "tracker_add_dependency")
    if (params.taskId === params.dependencyId) throw new Error("Task cannot depend on itself.")

    const tracker = await Tracker.get()
    const [task, dependency] = await Promise.all([tracker.getTask(params.taskId), tracker.getTask(params.dependencyId)])
    if (!task) throw new Error(`Task ${params.taskId} not found.`)
    if (!dependency) throw new Error(`Dependency task ${params.dependencyId} not found.`)

    const dependencies = Array.from(new Set([...task.dependencies, params.dependencyId]))
    const updated = await tracker.updateTask(task.id, { dependencies })
    return {
      title: `Linked ${updated.id}`,
      output: `Linked ${updated.id} -> ${params.dependencyId}.`,
      metadata: { task: updated },
    }
  },
})

export const TrackerVisualizeTool = Tool.define("tracker_visualize", {
  description: "Renders an ASCII tree visualization of the task graph.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    await askRead(ctx)
    const tracker = await Tracker.get()
    const tasks = await tracker.listTasks()
    if (tasks.length === 0) {
      return {
        title: "Empty tracker",
        output: "No tasks to visualize.",
        metadata: { tasks },
      }
    }

    const children = new Map<string, typeof tasks>()
    const roots = [] as typeof tasks
    for (const task of tasks) {
      if (!task.parentId) {
        roots.push(task)
        continue
      }
      const list = children.get(task.parentId) ?? []
      list.push(task)
      children.set(task.parentId, list)
    }

    const statusLabel: Record<z.infer<typeof TaskStatusSchema>, string> = {
      open: "[open]",
      in_progress: "[in-progress]",
      blocked: "[blocked]",
      closed: "[closed]",
    }

    const typeLabel: Record<z.infer<typeof TaskTypeSchema>, string> = {
      [TaskType.EPIC]: "[EPIC]",
      [TaskType.TASK]: "[TASK]",
      [TaskType.BUG]: "[BUG]",
    }

    const lines = ["Task Tracker Graph:"]
    const render = (task: (typeof tasks)[number], depth: number, seen: Set<string>) => {
      if (seen.has(task.id)) {
        lines.push(`${"  ".repeat(depth)}[CYCLE DETECTED: ${task.id}]`)
        return
      }

      const nextSeen = new Set(seen)
      nextSeen.add(task.id)
      const indent = "  ".repeat(depth)
      lines.push(`${indent}${statusLabel[task.status]} ${task.id} ${typeLabel[task.type]} ${task.title}`)
      if (task.dependencies.length > 0) {
        lines.push(`${indent}  depends on: ${task.dependencies.join(", ")}`)
      }
      if (task.requiredSkills && task.requiredSkills.length > 0) {
        const loadedStatus = task.requiredSkills.map(s => SkillRegistry.isLoaded(s) ? s : `?${s}`)
        lines.push(`${indent}  requires: ${loadedStatus.join(", ")}`)
      }

      // Enhanced blocked reason display
      if (task.status === "blocked") {
        const missingSkills = task.requiredSkills ? task.requiredSkills.filter(s => !SkillRegistry.isLoaded(s)) : []
        const pendingDeps = task.dependencies
          .map(depId => {
            const depTask = tasks.find(t => t.id === depId)
            return depTask && depTask.status !== "closed" ? { id: depId, status: depTask.status } : null
          })
          .filter(Boolean)

        if (missingSkills.length > 0 || pendingDeps.length > 0) {
          lines.push(`${indent}  blocked by:`)
          if (missingSkills.length > 0) {
            lines.push(`${indent}    - missing skills: ${missingSkills.join(", ")}`)
          }
          if (pendingDeps.length > 0) {
            const pendingList = pendingDeps.map(p => p && `${p.id} (${p.status === "in_progress" ? "in-progress" : p.status})`).filter(Boolean).join(", ")
            lines.push(`${indent}    - pending deps: ${pendingList}`)
          }
          if (missingSkills.length > 0) {
            const loadCommands = missingSkills.map(s => `skill(name="${s}")`).join(", ")
            lines.push(`${indent}  → Load skills: ${loadCommands}`)
          }
        }
      }
      for (const child of children.get(task.id) ?? []) render(child, depth + 1, nextSeen)
    }

    for (const root of roots) render(root, 0, new Set())

    return {
      title: "Task graph",
      output: lines.join("\n"),
      metadata: { tasks },
    }
  },
})

export const TrackerDeleteTaskTool = Tool.define("tracker_delete_task", {
  description: "Deletes a task from the tracker.",
  parameters: z.object({
    id: z.string().describe("The 6-character hex ID of the task to delete."),
  }),
  async execute(params, ctx) {
    await askWrite(ctx, "tracker_delete_task")
    const tracker = await Tracker.get()
const task = await tracker.deleteTask(params.id)
    
    return {
      title: `Deleted ${params.id}`,
      output: `Deleted task ${params.id}: ${task.title}`,
      metadata: { task },
    }
  },
})

export const TrackerDagUnblockTool = Tool.define("tracker_dag_unblock", {
  description: "Manually forces the DAG to evaluate and unblock downstream dependencies of a specific task. Useful if a task was resolved outside the normal flow.",
  parameters: z.object({
    id: z.string().describe("The 6-character hex ID of the task whose downstream dependencies should be evaluated."),
  }),
  async execute(params, ctx) {
    await askWrite(ctx, "tracker_dag_unblock")
    const tracker = await Tracker.get()
    
    // Check if task exists
    const task = await tracker.getTask(params.id)
    if (!task) throw new Error(`Task ${params.id} not found.`)
    
    await tracker.unblockDependentTasks(params.id)
    
    return {
      title: `Evaluated DAG for ${params.id}`,
      output: `Evaluated DAG dependencies for task ${params.id}. Downstream tasks whose dependencies are satisfied will be marked as open.`,
      metadata: { task },
    }
  },
})
