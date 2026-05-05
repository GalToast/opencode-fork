import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { git } from "@/util/git"
import { Flag } from "@/flag/flag"
import { SkillRegistry } from "@/skill/registry"
import { randomBytes } from "crypto"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { TaskStatus, TrackerTaskSchema, type TrackerTask } from "./types"

const log = Log.create({ service: "tracker" })

function trackerDir() {
  if (Instance.project.vcs) return path.join(Instance.worktree, ".tracker", "tasks")
  return path.join(Global.Path.data, "tracker", "tasks")
}

function trackerPattern() {
  return path.join(trackerDir(), "*")
}

export class TrackerService {
  private initialized = false

  constructor(private readonly tasksDir: string) {}

  private async ensureInitialized() {
    if (this.initialized) return
    await fs.mkdir(this.tasksDir, { recursive: true })
    this.initialized = true
  }

  private generateID() {
    return randomBytes(3).toString("hex")
  }

  private filePath(id: string) {
    return path.join(this.tasksDir, `${id}.json`)
  }

  private async readJSON<T>(filePath: string, schema: z.ZodSchema<T>) {
    try {
      const content = await fs.readFile(filePath, "utf8")
      return schema.parse(JSON.parse(content))
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null
      log.error("failed to read tracker file", { filePath, error })
      throw error
    }
  }

  async getTask(id: string) {
    await this.ensureInitialized()
    return this.readJSON(this.filePath(id), TrackerTaskSchema)
  }

  async listTasks() {
    await this.ensureInitialized()
    try {
      const entries = await fs.readdir(this.tasksDir)
      const files = entries.filter((entry) => entry.endsWith(".json")).sort()
      const tasks = await Promise.all(files.map((file) => this.readJSON(path.join(this.tasksDir, file), TrackerTaskSchema)))
      return tasks.filter((task): task is TrackerTask => task !== null)
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []
      throw error
    }
  }

  async createTask(taskData: Omit<TrackerTask, "id">) {
    await this.ensureInitialized()
    const updatedAt = Date.now()
    
    // Auto-block tasks with unmet requiredSkills
    let status = taskData.status
    if (taskData.requiredSkills && taskData.requiredSkills.length > 0) {
      const skillStatus = SkillRegistry.checkAllLoaded(taskData.requiredSkills)
      if (!skillStatus.allLoaded) {
        status = TaskStatus.BLOCKED
      }
    }
    
    const task: TrackerTask = {
      ...taskData,
      id: this.generateID(),
      status,
      metadata: {
        ...(taskData.metadata ?? {}),
        updatedAt,
      },
    }

    if (task.parentId) {
      const parent = await this.getTask(task.parentId)
      if (!parent) throw new Error(`Parent task with ID ${task.parentId} not found.`)
    }

    TrackerTaskSchema.parse(task)
    await this.saveTask(task)
    return task
  }

  async updateTask(id: string, updates: Partial<TrackerTask>) {
    const isClosing = updates.status === TaskStatus.CLOSED
    const changingDependencies = updates.dependencies !== undefined

    let taskMap: Map<string, TrackerTask> | undefined
    if (isClosing || changingDependencies) {
      const allTasks = await this.listTasks()
      taskMap = new Map(allTasks.map((task) => [task.id, task]))
    }

    const current = taskMap ? taskMap.get(id) : await this.getTask(id)
    if (!current) throw new Error(`Task with ID ${id} not found.`)

    const task: TrackerTask = {
      ...current,
      ...updates,
      id: current.id,
      metadata: {
        ...(current.metadata ?? {}),
        ...(updates.metadata ?? {}),
        updatedAt: Date.now(),
      },
    }

    if (task.parentId) {
      const parentExists = taskMap ? taskMap.has(task.parentId) : !!(await this.getTask(task.parentId))
      if (!parentExists) throw new Error(`Parent task with ID ${task.parentId} not found.`)
    }

    if (taskMap) {
      if (isClosing && current.status !== TaskStatus.CLOSED) this.validateCanClose(task, taskMap)
      if (changingDependencies) {
        taskMap.set(task.id, task)
        this.validateNoCircularDependencies(task, taskMap)
      }
    }

    TrackerTaskSchema.parse(task)
    await this.saveTask(task)
    
    if (isClosing && current.status !== TaskStatus.CLOSED) {
      await this.unblockDependentTasks(task.id, taskMap);
      await this.createGitCheckpoint(task);
    }
    
    return task
  }

  async unblockDependentTasks(closedTaskId: string, initialTaskMap?: Map<string, TrackerTask>) {
    const allTasks = initialTaskMap ? Array.from(initialTaskMap.values()) : await this.listTasks();
    const map = initialTaskMap || new Map(allTasks.map(t => [t.id, t]));

    // Refresh the closed task in the map to ensure it's seen as closed
    const closedTask = await this.getTask(closedTaskId);
    if (!closedTask) return;
    map.set(closedTaskId, closedTask);

    for (const t of allTasks) {
      if (t.status === TaskStatus.BLOCKED && t.dependencies.includes(closedTaskId)) {
        // Evaluate conditional gates if present
        if (closedTask.conditionalGates && Object.keys(closedTask.conditionalGates).length > 0) {
          const results = closedTask.results || {};
          let gateSatisfied = true;
          for (const [key, targetTaskId] of Object.entries(closedTask.conditionalGates)) {
            // If the gate maps a key to this task, but the result for that key is falsy, we skip unblocking this branch
            if (targetTaskId === t.id && !results[key]) {
              gateSatisfied = false;
              break;
            }
          }
          if (!gateSatisfied) continue;
        }

        const canUnblock = this.validateDependenciesSatisfied(t.id, map);
        if (canUnblock) {
          log.info(`DAG: Unblocking task ${t.id} because dependency ${closedTaskId} closed`);
          await this.updateTask(t.id, { status: TaskStatus.OPEN }); 
        }
      }
    }
  }

  async addArtifact(taskId: string, filePath: string) {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);
    const artifacts = [...(task.artifacts || []), filePath];
    return this.updateTask(taskId, { artifacts });
  }

  async setResults(taskId: string, results: Record<string, unknown>) {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);
    const mergedResults = { ...(task.results || {}), ...results };
    return this.updateTask(taskId, { results: mergedResults });
  }
  private async createGitCheckpoint(task: TrackerTask) {
    if (!Flag.OPENCODE_ENABLE_TIME_TRAVEL) return
    if (!Instance.project.vcs) return

    try {
      await git(["add", "-A"], { cwd: Instance.worktree })
      await git(["commit", "--allow-empty", "-m", `[opencode] DAG Checkpoint: ${task.id} - ${task.title}`], { cwd: Instance.worktree })
      log.info(`DAG checkpoint created for task ${task.id}`)
    } catch (error) {
      log.warn("Failed to create git checkpoint", { taskId: task.id, error })
    }
  }

  private async saveTask(task: TrackerTask) {
    await this.ensureInitialized()
    await fs.writeFile(this.filePath(task.id), JSON.stringify(task, null, 2) + "\n", "utf8")
  }

  async deleteTask(id: string) {
    await this.ensureInitialized()
    const task = await this.getTask(id)
    if (!task) throw new Error(`Task with ID ${id} not found.`)
    await fs.unlink(this.filePath(id))
    return task
  }

  private validateCanClose(task: TrackerTask, taskMap: Map<string, TrackerTask>) {
    for (const depID of task.dependencies) {
      const dep = taskMap.get(depID)
      if (!dep) throw new Error(`Dependency ${depID} not found for task ${task.id}.`)
      if (dep.status !== TaskStatus.CLOSED) {
        throw new Error(`Cannot close task ${task.id} because dependency ${depID} is still ${dep.status}.`)
      }
    }
  }

  validateDependenciesSatisfied(taskId: string, taskMap: Map<string, TrackerTask>): boolean {
    const task = taskMap.get(taskId)
    if (!task) return false
    
    // Check task dependencies are satisfied
    for (const depID of task.dependencies) {
      const dep = taskMap.get(depID)
      if (!dep) return false
      if (dep.status !== TaskStatus.CLOSED) {
        return false
      }
    }
    
    // Check required skills are loaded
    if (task.requiredSkills && task.requiredSkills.length > 0) {
      const skillStatus = SkillRegistry.checkAllLoaded(task.requiredSkills)
      if (!skillStatus.allLoaded) {
        log.info(`task ${taskId} blocked by missing skills: ${skillStatus.missing.join(", ")}`)
        return false
      }
    }
    
    return true
  }

  private validateNoCircularDependencies(task: TrackerTask, taskMap: Map<string, TrackerTask>) {
    const visited = new Set<string>()
    const stack = new Set<string>()

    const walk = (taskID: string) => {
      if (stack.has(taskID)) throw new Error(`Circular dependency detected involving task ${taskID}.`)
      if (visited.has(taskID)) return

      visited.add(taskID)
      stack.add(taskID)

      const current = taskMap.get(taskID)
      if (!current) throw new Error(`Dependency ${taskID} not found.`)
      for (const depID of current.dependencies) walk(depID)
      stack.delete(taskID)
    }

    walk(task.id)
  }
}

const trackerState = Instance.state(() => Promise.resolve(new TrackerService(trackerDir())))

function getTracker() {
  return trackerState()
}

export const TrackerStorage = {
  dir: trackerDir,
  pattern: trackerPattern,
}

export const Tracker = {
  state: trackerState,
  get: getTracker,
}
