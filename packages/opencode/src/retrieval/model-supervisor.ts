import { spawn, type ChildProcess } from "child_process"

interface SupervisorConfig {
  key: string
  kind: "embedding" | "reranking"
  endpoint: string
  healthURL: string
  startupTimeoutMS: number
  healthCheckIntervalMS: number
  idleTimeoutMS: number
  command: string
  args: string[]
  modelPath?: string
  modelID?: string
}

interface TestHooks {
  healthCheck: (url: string) => Promise<boolean>
  spawn: (config: SupervisorConfig) => ChildProcess
}

interface SupervisorState {
  process: ChildProcess | null
  healthy: boolean
  lastUsed: number
  idleTimer: NodeJS.Timeout | null
  healthCheckTimer: NodeJS.Timeout | null
}

const supervisors = new Map<string, SupervisorState>()
let testHooks: TestHooks | null = null

async function defaultHealthCheck(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

function defaultSpawn(config: SupervisorConfig): ChildProcess {
  return spawn(config.command, config.args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  })
}

async function healthCheck(url: string): Promise<boolean> {
  if (testHooks) {
    return testHooks.healthCheck(url)
  }
  return defaultHealthCheck(url)
}

function spawnProcess(config: SupervisorConfig): ChildProcess {
  if (testHooks) {
    return testHooks.spawn(config)
  }
  return defaultSpawn(config)
}

async function waitForHealthy(config: SupervisorConfig): Promise<void> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < config.startupTimeoutMS) {
    const healthy = await healthCheck(config.healthURL)
    if (healthy) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, config.healthCheckIntervalMS))
  }
  
  throw new Error(`Model supervisor exited before becoming healthy at ${config.healthURL}`)
}

function startIdleTimer(key: string, config: SupervisorConfig): void {
  const state = supervisors.get(key)
  if (!state) return
  
  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
  }
  
  if (config.idleTimeoutMS > 0) {
    state.idleTimer = setTimeout(() => {
      const currentState = supervisors.get(key)
      if (currentState && Date.now() - currentState.lastUsed >= config.idleTimeoutMS) {
        shutdownSupervisor(key)
      }
    }, config.idleTimeoutMS)
  }
}

function shutdownSupervisor(key: string): void {
  const state = supervisors.get(key)
  if (!state) return
  
  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
  }
  if (state.healthCheckTimer) {
    clearInterval(state.healthCheckTimer)
  }
  
  if (state.process) {
    state.process.kill()
    state.process = null
  }
  
  state.healthy = false
  supervisors.delete(key)
}

async function startSupervisor(config: SupervisorConfig): Promise<void> {
  const dedupeKey = config.healthURL
  
  const existing = supervisors.get(dedupeKey)
  if (existing && existing.healthy) {
    existing.lastUsed = Date.now()
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer)
    }
    startIdleTimer(dedupeKey, config)
    return
  }
  
  if (existing) {
    shutdownSupervisor(dedupeKey)
  }
  
  const process = spawnProcess(config)
  let exitHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
  
  const state: SupervisorState = {
    process,
    healthy: false,
    lastUsed: Date.now(),
    idleTimer: null,
    healthCheckTimer: null,
  }
  
  exitHandler = (code: number | null, signal: NodeJS.Signals | null) => {
    state.healthy = false
    if (state.healthCheckTimer) {
      clearInterval(state.healthCheckTimer)
    }
    if (state.idleTimer) {
      clearTimeout(state.idleTimer)
    }
    supervisors.delete(dedupeKey)
  }
  
  process.once("exit", exitHandler)
  
  supervisors.set(dedupeKey, state)
  
  try {
    await waitForHealthy(config)
    state.healthy = true
    
    state.healthCheckTimer = setInterval(async () => {
      const healthy = await healthCheck(config.healthURL)
      if (!healthy && supervisors.has(dedupeKey)) {
        state.healthy = false
        shutdownSupervisor(dedupeKey)
      }
    }, config.healthCheckIntervalMS * 10)
    
    startIdleTimer(dedupeKey, config)
  } catch (error) {
    shutdownSupervisor(dedupeKey)
    throw error
  }
}

export namespace RetrievalModelSupervisor {
  export function configureTestHooks(hooks: {
    healthCheck: (url: string) => Promise<boolean>
    spawn: (config: SupervisorConfig) => ChildProcess
  }): void {
    testHooks = hooks
  }
  
  export function reset(): void {
    for (const [key, state] of supervisors.entries()) {
      shutdownSupervisor(key)
    }
    supervisors.clear()
    testHooks = null
  }
  
  export async function ensureReady(input: SupervisorConfig): Promise<void> {
    await startSupervisor(input)
  }
  
  export async function ensure(input: SupervisorConfig): Promise<{ modelPath?: string; modelID?: string }> {
    await startSupervisor(input)
    return {
      modelPath: input.modelPath,
      modelID: input.modelID,
    }
  }
}
