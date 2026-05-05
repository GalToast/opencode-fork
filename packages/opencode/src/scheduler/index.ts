import { Instance } from "../project/instance"
import { Log } from "../util/log"

const log = Log.create({ service: "scheduler" })

export type Task = {
  id: string
  interval: number
  run: () => Promise<void>
  scope?: "instance" | "global"
}

type Timer = ReturnType<typeof setInterval>
type Entry = {
  tasks: Map<string, Task>
  timers: Map<string, Timer>
}

const create = (): Entry => {
  const tasks = new Map<string, Task>()
  const timers = new Map<string, Timer>()
  return { tasks, timers }
}

const shared = create()

const state = Instance.state(
  () => create(),
  (entry) => {
    for (const timer of entry.timers.values()) {
      clearInterval(timer)
    }
    entry.tasks.clear()
    entry.timers.clear()
  },
)

export function register(task: Task) {
  const scope = task.scope ?? "instance"
  const entry = scope === "global" ? shared : state()
  const current = entry.timers.get(task.id)
  if (current && scope === "global") return
  if (current) clearInterval(current)

  entry.tasks.set(task.id, task)
  void run(task)
  const timer = setInterval(() => {
    void run(task)
  }, task.interval)
  timer.unref()
  entry.timers.set(task.id, timer)
}

function run(task: Task): Promise<void> {
  log.info("run", { id: task.id })
  return task.run().catch((error) => {
    log.error("run failed", { id: task.id, error })
  })
}

export const Scheduler = {
  register,
}
