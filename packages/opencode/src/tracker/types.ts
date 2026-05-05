import z from "zod"

export const TaskType = {
  EPIC: "epic",
  TASK: "task",
  BUG: "bug",
} as const

export const TaskStatus = {
  OPEN: "open",
  IN_PROGRESS: "in_progress",
  BLOCKED: "blocked",
  CLOSED: "closed",
} as const

export const TaskTypeSchema = z.enum([TaskType.EPIC, TaskType.TASK, TaskType.BUG])
export const TaskStatusSchema = z.enum([
  TaskStatus.OPEN,
  TaskStatus.IN_PROGRESS,
  TaskStatus.BLOCKED,
  TaskStatus.CLOSED,
])

export const TrackerTaskSchema = z.object({
  id: z.string().length(6),
  title: z.string(),
  description: z.string(),
  type: TaskTypeSchema,
  status: TaskStatusSchema,
  parentId: z.string().optional(),
  dependencies: z.array(z.string()),
  requiredSkills: z.array(z.string()).optional(), // Skills that must be loaded for this task to unblock
  subagentSessionId: z.string().optional(),
  results: z.record(z.string(), z.unknown()).optional(),
  artifacts: z.array(z.string()).optional(),
  conditionalGates: z.record(z.string(), z.string()).optional(), // Maps result keys to next taskId signals
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type TaskTypeValue = z.infer<typeof TaskTypeSchema>
export type TaskStatusValue = z.infer<typeof TaskStatusSchema>
export type TrackerTask = z.infer<typeof TrackerTaskSchema>
