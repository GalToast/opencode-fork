import { spawn, type ChildProcess, execSync } from 'child_process'
import { accessSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { MCP } from './index'

export interface ChromeInstance {
  id: string
  port: number
  process: ChildProcess | null
  userDataDir: string
  workerId: string | null
  acquiredAt: Date | null
  lastHealthCheck: Date
  status: 'idle' | 'acquired' | 'crashed' | 'terminating'
  spawnAttempts: number
}

export interface ChromeInstancePoolOptions {
  basePort?: number
  instanceCount?: number
  healthCheckInterval?: number
  spawnTimeout?: number
  maxSpawnAttempts?: number
  userDataDirBase?: string
}

export interface AcquireOptions {
  workerId: string
  timeout?: number
}

const transientCleanupCodes = new Set(process.platform === "win32" ? ["EBUSY", "ENOTEMPTY", "EPERM"] : ["EBUSY"])

function hasErrorCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
}

function extractErrorCode(error: unknown): string {
  if (!hasErrorCode(error)) return ""
  if (typeof error.code === "string") return error.code
  if (typeof error.code === "number") return String(error.code)
  return ""
}

function isTransientCleanupError(error: unknown): boolean {
  return transientCleanupCodes.has(extractErrorCode(error))
}

export class ChromeInstancePool {
  private instances: Map<string, ChromeInstance> = new Map()
  private portToInstance: Map<number, string> = new Map()
  private workerToInstance: Map<string, string> = new Map()
  private availablePorts: number[] = []
  private nextPort: number
  private instanceCount: number
  private healthCheckInterval: number
  private spawnTimeout: number
  private maxSpawnAttempts: number
  private userDataDirBase: string
  private healthCheckTimer: NodeJS.Timeout | null = null
  private isCleaningUp = false
  private acquireMutex = false
  private acquireQueue: Array<{
    resolve: (instance: ChromeInstance) => void
    reject: (error: Error) => void
    workerId: string
    timeout: number
    startTime: number
  }> = []
  private currentAcquire: {
    reject: (error: Error) => void
    workerId: string
  } | null = null

  constructor(options: ChromeInstancePoolOptions = {}) {
    this.nextPort = options.basePort ?? 9222
    this.instanceCount = options.instanceCount ?? 3
    this.healthCheckInterval = options.healthCheckInterval ?? 30000
    this.spawnTimeout = options.spawnTimeout ?? 30000
    this.maxSpawnAttempts = options.maxSpawnAttempts ?? 3
    this.userDataDirBase = options.userDataDirBase ?? join(tmpdir(), 'chrome-instance-pool')
    
    this.startHealthChecks()
  }

  private generateInstanceId(): string {
    return `chrome-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  private getNextPort(): number {
    if (this.availablePorts.length > 0) {
      return this.availablePorts.shift()!
    }
    const port = this.nextPort
    this.nextPort++
    return port
  }

  private releasePort(port: number): void {
    this.availablePorts.push(port)
    this.availablePorts.sort((a, b) => a - b)
  }

  async spawn(): Promise<ChromeInstance> {
    if (this.isCleaningUp) {
      throw new Error('Cannot spawn instance while pool is cleaning up')
    }

    if (this.instances.size >= this.instanceCount) {
      throw new Error(`Maximum instance limit (${this.instanceCount}) reached`)
    }

    const id = this.generateInstanceId()
    const port = this.getNextPort()
    const userDataDir = join(this.userDataDirBase, id)

    await mkdir(userDataDir, { recursive: true })

    const instance: ChromeInstance = {
      id,
      port,
      process: null,
      userDataDir,
      workerId: null,
      acquiredAt: null,
      lastHealthCheck: new Date(),
      status: 'idle',
      spawnAttempts: 0,
    }

    try {
      const chromeProcess = await this.spawnChromeProcess(instance)
      instance.process = chromeProcess
      instance.status = 'idle'

      this.instances.set(id, instance)
      this.portToInstance.set(port, id)

      this.setupProcessHandlers(instance)

      return instance
    } catch (error) {
      await this.cleanupInstance(instance)
      throw error
    }
  }

  private detectChromePath(): string {
    const customPath = process.env.OPENCODE_CHROME_PATH
    if (customPath) {
      try {
        accessSync(customPath)
        return customPath
      } catch {
        throw new Error(`Custom Chrome path not found: ${customPath}`)
      }
    }

    if (process.platform === 'win32') {
      try {
        execSync('where chrome.exe', { stdio: 'ignore' })
        return 'chrome.exe'
      } catch {
        const commonPaths = [
          join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]
        for (const path of commonPaths) {
          try {
            accessSync(path)
            return path
          } catch {
            continue
          }
        }
      }
      throw new Error(
        'Chrome not found on Windows. Install Chrome or set OPENCODE_CHROME_PATH environment variable to the chrome.exe path.'
      )
    }

    if (process.platform === 'darwin') {
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    }

    return 'google-chrome'
  }

  private spawnChromeProcess(instance: ChromeInstance): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      instance.spawnAttempts++
      
      const args = [
        `--remote-debugging-port=${instance.port}`,
        `--user-data-dir=${instance.userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--headless',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        'about:blank',
      ]

      const chromePath = this.detectChromePath()

      const childProcess = spawn(chromePath, args, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let spawnTimeoutId: NodeJS.Timeout | null = null

      const cleanup = () => {
        if (spawnTimeoutId) {
          clearTimeout(spawnTimeoutId)
        }
        childProcess.removeAllListeners()
      }

      spawnTimeoutId = setTimeout(() => {
        cleanup()
        childProcess.kill('SIGTERM')
        reject(new Error(`Chrome spawn timeout after ${this.spawnTimeout}ms`))
      }, this.spawnTimeout)

      childProcess.on('error', (error) => {
        cleanup()
        reject(new Error(`Failed to spawn Chrome: ${error.message}`))
      })

      childProcess.on('exit', (code) => {
        if (code !== 0 && instance.status !== 'terminating') {
          instance.status = 'crashed'
          cleanup()
          reject(new Error(`Chrome process exited with code ${code}`))
        }
      })

      const handleOutput = (data: unknown) => {
        const output = this.extractOutputText(data)
        if (!output) {
          return
        }

        if (output.includes('DevTools listening') || output.includes('ws://')) {
          cleanup()
          resolve(childProcess)
        }
      }

      childProcess.stdout?.on('data', handleOutput)
      childProcess.stderr?.on('data', handleOutput)

      setTimeout(() => {
        if (childProcess.pid && !childProcess.killed) {
          cleanup()
          resolve(childProcess)
        }
      }, 2000)
    })
  }

  private extractOutputText(data: unknown): string | null {
    if (typeof data === 'string') return data
    if (data instanceof Uint8Array) return Buffer.from(data).toString()
    return null
  }

  private setupProcessHandlers(instance: ChromeInstance): void {
    const process = instance.process
    if (!process) return

    process.on('exit', (code) => {
      if (instance.status !== 'terminating') {
        instance.status = 'crashed'
      }
      this.handleProcessExit(instance, code)
    })

    process.on('error', (error) => {
      console.error(`Chrome instance ${instance.id} error:`, error)
      instance.status = 'crashed'
    })
  }

  private handleProcessExit(instance: ChromeInstance, code: number | null): void {
    console.log(`Chrome instance ${instance.id} exited with code ${code}`)
    
    if (instance.status !== 'terminating' && instance.workerId) {
      this.workerToInstance.delete(instance.workerId)
    }

    if (instance.status === 'crashed' && instance.spawnAttempts < this.maxSpawnAttempts) {
      console.log(`Attempting to respawn instance ${instance.id}`)
      this.respawnInstance(instance).catch((error) => {
        console.error(`Failed to respawn instance ${instance.id}:`, error)
        this.removeInstance(instance.id)
      })
    } else if (instance.status === 'terminating') {
      this.removeInstance(instance.id)
    }
  }

  private async respawnInstance(instance: ChromeInstance): Promise<void> {
    try {
      const newProcess = await this.spawnChromeProcess(instance)
      instance.process = newProcess
      instance.status = instance.workerId ? 'acquired' : 'idle'
      instance.lastHealthCheck = new Date()
      this.setupProcessHandlers(instance)
    } catch (error) {
      instance.status = 'crashed'
      throw error
    }
  }

  private hardKillProcess(processToKill: ChildProcess): void {
    const pid = processToKill.pid
    if (!pid) return

    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /f /t /pid ${pid}`, { stdio: 'ignore' })
      } catch {
        // Ignore cleanup failures in hard kill path.
      }
      return
    }

    try {
      processToKill.kill('SIGKILL')
    } catch {
      // Ignore cleanup failures in hard kill path.
    }
  }

  private removeInstance(id: string): void {
    const instance = this.instances.get(id)
    if (!instance) return

    this.instances.delete(id)
    this.portToInstance.delete(instance.port)
    this.releasePort(instance.port)
    
    if (instance.workerId) {
      this.workerToInstance.delete(instance.workerId)
    }

    this.cleanupInstance(instance).catch((error) => {
      console.error(`Error cleaning up instance ${id}:`, error)
    })
  }

  private async cleanupInstance(instance: ChromeInstance): Promise<void> {
    if (instance.process && !instance.process.killed) {
      const processToKill = instance.process
      instance.status = 'terminating'
      processToKill.kill('SIGTERM')

      if (processToKill.exitCode !== null || processToKill.signalCode !== null) {
        // Process already exited before hard cleanup could start.
      } else {
        await new Promise((resolve) => {
          let finished = false
          const done = () => {
            if (finished) return
            finished = true
            resolve(undefined)
          }

          const timeout = setTimeout(() => {
            if (!finished) {
              this.hardKillProcess(processToKill)
              done()
            }
          }, 5000)

          const finalize = () => {
            clearTimeout(timeout)
            done()
          }

          processToKill.once('exit', finalize)
          processToKill.once('error', finalize)
        })
      }
    }

    try {
      await this.cleanupDirectory(instance.userDataDir)
    } catch (error) {
      console.warn(`Failed to cleanup user data dir ${instance.userDataDir}:`, error)
    }
  }

  private async cleanupDirectory(target: string, attempts = 12): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await rm(target, { recursive: true, force: true })
        return
      } catch (error) {
        if (!isTransientCleanupError(error) || attempt === attempts) {
          throw error
        }
        await Bun.sleep(Math.min(500, attempt * 75))
      }
    }
  }

  async acquire(options: AcquireOptions): Promise<ChromeInstance> {
    const { workerId, timeout = 30000 } = options

    if (this.isCleaningUp) {
      throw new Error('Cannot acquire instance while pool is cleaning up')
    }

    const existingInstanceId = this.workerToInstance.get(workerId)
    if (existingInstanceId) {
      const existingInstance = this.instances.get(existingInstanceId)
      if (existingInstance && existingInstance.status === 'acquired') {
        return existingInstance
      }
    }

    return new Promise((resolve, reject) => {
      this.acquireWithMutex({ workerId, timeout, resolve, reject })
    })
  }

  private acquireWithMutex(params: {
    workerId: string
    timeout: number
    resolve: (instance: ChromeInstance) => void
    reject: (error: Error) => void
  }): void {
    const { workerId, timeout, resolve, reject } = params
    const startTime = Date.now()

    if (this.acquireMutex) {
      const queueEntry = {
        resolve,
        reject,
        workerId,
        timeout,
        startTime,
      }
      this.acquireQueue.push(queueEntry)
      
      const timeoutId = setTimeout(() => {
        const index = this.acquireQueue.indexOf(queueEntry)
        if (index !== -1) {
          this.acquireQueue.splice(index, 1)
          reject(new Error(`Timeout waiting to acquire Chrome instance for worker ${workerId}`))
        }
      }, timeout)

      queueEntry.resolve = (instance) => {
        clearTimeout(timeoutId)
        resolve(instance)
      }
      queueEntry.reject = (error) => {
        clearTimeout(timeoutId)
        reject(error)
      }
      return
    }

    this.acquireMutex = true
    this.currentAcquire = { reject, workerId }
    void this.executeAcquire({ workerId, timeout, resolve, reject, startTime })
  }

  private async executeAcquire(params: {
    workerId: string
    timeout: number
    resolve: (instance: ChromeInstance) => void
    reject: (error: Error) => void
    startTime: number
  }): Promise<void> {
    const { workerId, timeout, resolve, reject, startTime } = params

    try {
      while (true) {
        if (this.isCleaningUp) {
          this.acquireMutex = false
          this.currentAcquire = null
          this.processQueue()
          reject(new Error('Cannot acquire instance while pool is cleaning up'))
          return
        }

        const elapsed = Date.now() - startTime
        const remainingTimeout = timeout - elapsed

        if (remainingTimeout <= 0) {
          this.acquireMutex = false
          this.currentAcquire = null
          this.processQueue()
          reject(new Error(`Timeout waiting to acquire Chrome instance for worker ${workerId}`))
          return
        }

        for (const instance of this.instances.values()) {
          if (instance.status === 'idle') {
            instance.workerId = workerId
            instance.acquiredAt = new Date()
            instance.status = 'acquired'
            this.workerToInstance.set(workerId, instance.id)
            this.acquireMutex = false
            this.currentAcquire = null
            this.processQueue()
            resolve(instance)
            return
          }
        }

        if (this.instances.size < this.instanceCount) {
          try {
            const instance = await this.spawn()
            instance.workerId = workerId
            instance.acquiredAt = new Date()
            instance.status = 'acquired'
            this.workerToInstance.set(workerId, instance.id)
            this.acquireMutex = false
            this.currentAcquire = null
            this.processQueue()
            resolve(instance)
            return
          } catch (error) {
            const elapsedAfterSpawn = Date.now() - startTime
            if (elapsedAfterSpawn >= timeout) {
              this.acquireMutex = false
              this.currentAcquire = null
              this.processQueue()
              reject(error instanceof Error ? error : new Error(String(error)))
              return
            }
          }
        }

        await new Promise((resolveWait) => setTimeout(resolveWait, 100))
      }
    } catch (error) {
      this.acquireMutex = false
      this.currentAcquire = null
      this.processQueue()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private processQueue(): void {
    if (this.acquireQueue.length === 0 || this.acquireMutex) {
      return
    }

    const now = Date.now()
    const queueEntry = this.acquireQueue.shift()
    
    if (!queueEntry) return

    const elapsed = now - queueEntry.startTime
    if (elapsed >= queueEntry.timeout) {
      queueEntry.reject(new Error(`Timeout waiting to acquire Chrome instance for worker ${queueEntry.workerId}`))
      this.processQueue()
      return
    }

    const remainingTimeout = queueEntry.timeout - elapsed
    this.acquireWithMutex({
      workerId: queueEntry.workerId,
      timeout: remainingTimeout,
      resolve: queueEntry.resolve,
      reject: queueEntry.reject,
    })
  }

  release(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId)
    if (!instance) {
      return Promise.reject(new Error(`Instance ${instanceId} not found`))
    }

    if (instance.status !== 'acquired') {
      return Promise.resolve()
    }

    if (instance.workerId) {
      this.workerToInstance.delete(instance.workerId)
    }

    instance.workerId = null
    instance.acquiredAt = null
    instance.status = 'idle'
    instance.lastHealthCheck = new Date()

    return Promise.resolve()
  }

  async cleanup(): Promise<void> {
    this.isCleaningUp = true
    this.stopHealthChecks()

    if (this.currentAcquire) {
      this.currentAcquire.reject(new Error('Cannot acquire instance while pool is cleaning up'))
      this.currentAcquire = null
    }

    for (const queueEntry of this.acquireQueue) {
      queueEntry.reject(new Error('Cannot acquire instance while pool is cleaning up'))
    }
    this.acquireQueue = []
    this.acquireMutex = false

    const cleanupPromises: Promise<void>[] = []
    
    for (const instance of this.instances.values()) {
      instance.status = 'terminating'
      cleanupPromises.push(this.cleanupInstance(instance))
    }

    await Promise.all(cleanupPromises)

    this.instances.clear()
    this.portToInstance.clear()
    this.workerToInstance.clear()
    this.availablePorts = []
    
    try {
      await this.cleanupDirectory(this.userDataDirBase)
    } catch (error) {
      console.warn(`Failed to cleanup base directory ${this.userDataDirBase}:`, error)
    }

    this.isCleaningUp = false
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(() => {
      void this.performHealthChecks()
    }, this.healthCheckInterval)
    this.healthCheckTimer.unref()
  }

  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  private async performHealthChecks(): Promise<void> {
    for (const instance of this.instances.values()) {
      if (instance.status === 'terminating') continue

      const isHealthy = await this.checkInstanceHealth(instance)
      instance.lastHealthCheck = new Date()

      if (!isHealthy && instance.status !== 'crashed') {
        console.warn(`Instance ${instance.id} failed health check`)
        instance.status = 'crashed'
        
        if (instance.spawnAttempts < this.maxSpawnAttempts) {
          this.respawnInstance(instance).catch((error) => {
            console.error(`Failed to respawn instance ${instance.id}:`, error)
          })
        }
      }
    }
  }

  private async checkInstanceHealth(instance: ChromeInstance): Promise<boolean> {
    if (!instance.process || instance.process.killed) {
      return false
    }

    try {
      const response = await fetch(`http://localhost:${instance.port}/json/version`, {
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  getInstance(id: string): ChromeInstance | undefined {
    return this.instances.get(id)
  }

  getInstanceForWorker(workerId: string): ChromeInstance | undefined {
    const instanceId = this.workerToInstance.get(workerId)
    if (instanceId) {
      return this.instances.get(instanceId)
    }
    return undefined
  }

  getAllInstances(): ChromeInstance[] {
    return Array.from(this.instances.values())
  }

  getStats(): {
    total: number
    idle: number
    acquired: number
    crashed: number
    terminating: number
  } {
    const instances = this.getAllInstances()
    return {
      total: instances.length,
      idle: instances.filter((i) => i.status === 'idle').length,
      acquired: instances.filter((i) => i.status === 'acquired').length,
      crashed: instances.filter((i) => i.status === 'crashed').length,
      terminating: instances.filter((i) => i.status === 'terminating').length,
    }
  }
}
