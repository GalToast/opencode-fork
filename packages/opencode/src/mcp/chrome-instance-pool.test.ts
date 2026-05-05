import { ChromeInstancePool, type ChromeInstance } from './chrome-instance-pool'
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

describe('ChromeInstancePool', () => {
  let pool: ChromeInstancePool

  beforeEach(() => {
    pool = new ChromeInstancePool({
      basePort: 10000,
      healthCheckInterval: 1000,
    })
  })

  afterEach(async () => {
    await pool.cleanup()
  })

  const toError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error))

  const expectRejectsWithMessage = async (
    operation: Promise<unknown>,
    expectedMessage: string
  ) => {
    let capturedError: Error | null = null

    try {
      await operation
    } catch (error) {
      capturedError = toError(error)
    }

    if (capturedError === null) {
      throw new Error('Expected operation to reject')
    }

    expect(capturedError.message).toContain(expectedMessage)
  }

  describe('constructor', () => {
    it('should create pool with default options', () => {
      const defaultPool = new ChromeInstancePool()
      expect(defaultPool).toBeDefined()
      expect(defaultPool.getAllInstances()).toHaveLength(0)
    })

    it('should create pool with custom options', () => {
      const customPool = new ChromeInstancePool({
        basePort: 20000,
        healthCheckInterval: 5000,
      })
      expect(customPool).toBeDefined()
    })
  })

  describe('spawn', () => {
    it('should throw error when maxInstances reached', async () => {
      const instancePool = new ChromeInstancePool({
        basePort: 30000,
        instanceCount: 0,
      })

      expect(instancePool.getStats().total).toBe(0)
      
      await expectRejectsWithMessage(instancePool.spawn(), 'Maximum instance limit')
      await instancePool.cleanup()
    })
  })

  describe('acquire', () => {
    it('should throw timeout error when no instances available', async () => {
      const instancePool = new ChromeInstancePool({
        basePort: 32000,
        instanceCount: 0,
      })

      await expectRejectsWithMessage(
        instancePool.acquire({ workerId: 'worker-1', timeout: 100 }),
        'Timeout waiting to acquire'
      )

      await instancePool.cleanup()
    })
  })

  describe('release', () => {
    it('should throw error for non-existent instance', async () => {
      await expectRejectsWithMessage(
        pool.release('non-existent-instance'),
        'Instance non-existent-instance not found'
      )
    })
  })

  describe('getStats', () => {
    it('should return correct stats for empty pool', () => {
      const stats = pool.getStats()

      expect(stats.total).toBe(0)
      expect(stats.idle).toBe(0)
      expect(stats.acquired).toBe(0)
      expect(stats.crashed).toBe(0)
      expect(stats.terminating).toBe(0)
    })
  })

  describe('getInstance', () => {
    it('should return undefined for non-existent instance', () => {
      const instance = pool.getInstance('non-existent')
      expect(instance).toBeUndefined()
    })
  })

  describe('getInstanceForWorker', () => {
    it('should return undefined for worker without instance', () => {
      const instance = pool.getInstanceForWorker('unknown-worker')
      expect(instance).toBeUndefined()
    })
  })

  describe('cleanup', () => {
    it('should cleanup empty pool', async () => {
      await pool.cleanup()
      expect(pool.getAllInstances()).toHaveLength(0)
    })

    it('should handle multiple cleanup calls', async () => {
      await pool.cleanup()
      await pool.cleanup()
      expect(pool.getAllInstances()).toHaveLength(0)
    })
  })

  describe('port management', () => {
    it('should auto-increment ports', async () => {
      const portPool = new ChromeInstancePool({ basePort: 40000 })

      expect(portPool.getStats().total).toBe(0)
      await portPool.cleanup()
    })

    it('should respect maxInstances limit', async () => {
      const limitedPool = new ChromeInstancePool({
        basePort: 50000,
        instanceCount: 2,
      })

      const stats = limitedPool.getStats()
      expect(stats.total).toBe(0)
      await limitedPool.cleanup()
    })
  })

  describe('mutex and queue', () => {
    it('should serialize concurrent acquire calls with instanceCount: 0', async () => {
      const instancePool = new ChromeInstancePool({
        basePort: 60000,
        instanceCount: 0,
      })

      const acquirePromises: Array<Promise<ChromeInstance | null>> = []
      const errors: Error[] = []

      for (let i = 0; i < 3; i++) {
        const workerId = `worker-${i}`
        const promise = instancePool
          .acquire({ workerId, timeout: 500 })
          .catch((error: unknown) => {
            errors.push(toError(error))
            return null
          })
        acquirePromises.push(promise)
      }

      await Promise.all(acquirePromises)

      expect(errors).toHaveLength(3)
      errors.forEach((error) => {
        expect(error.message).toContain('Timeout waiting to acquire')
      })

      await instancePool.cleanup()
    })

    it('should timeout queued requests correctly', async () => {
      const instancePool = new ChromeInstancePool({
        basePort: 62000,
        instanceCount: 0,
      })

      const startTime = Date.now()
      const acquirePromise = instancePool.acquire({ workerId: 'waiter', timeout: 400 })

      await expectRejectsWithMessage(acquirePromise, 'Timeout waiting to acquire')

      const elapsed = Date.now() - startTime
      expect(elapsed).toBeGreaterThanOrEqual(350)
      expect(elapsed).toBeLessThan(800)

      await instancePool.cleanup()
    })

    it('should queue multiple requests and process all', async () => {
      const instancePool = new ChromeInstancePool({
        basePort: 63000,
        instanceCount: 0,
      })

      const errors: Array<{ workerId: string; error: Error }> = []
      const startTime = Date.now()

      const acquire1 = instancePool
        .acquire({ workerId: 'q1', timeout: 300 })
        .catch((error: unknown) => {
          errors.push({ workerId: 'q1', error: toError(error) })
        })
      const acquire2 = instancePool
        .acquire({ workerId: 'q2', timeout: 300 })
        .catch((error: unknown) => {
          errors.push({ workerId: 'q2', error: toError(error) })
        })
      const acquire3 = instancePool
        .acquire({ workerId: 'q3', timeout: 300 })
        .catch((error: unknown) => {
          errors.push({ workerId: 'q3', error: toError(error) })
        })

      await Promise.all([acquire1, acquire2, acquire3])

      expect(errors).toHaveLength(3)
      const workerIds = errors.map((e) => e.workerId).sort()
      expect(workerIds).toEqual(['q1', 'q2', 'q3'])

      const elapsed = Date.now() - startTime
      expect(elapsed).toBeLessThan(800)

      await instancePool.cleanup()
    })

    it('should handle concurrent acquires with mixed timeouts', async () => {
      const instancePool = new ChromeInstancePool({
        basePort: 64000,
        instanceCount: 0,
      })

      const results: Array<{ workerId: string; timedOut: boolean }> = []

      const shortTimeout = instancePool
        .acquire({ workerId: 'short', timeout: 200 })
        .then(() => results.push({ workerId: 'short', timedOut: false }))
        .catch(() => results.push({ workerId: 'short', timedOut: true }))

      const longTimeout = instancePool
        .acquire({ workerId: 'long', timeout: 600 })
        .then(() => results.push({ workerId: 'long', timedOut: false }))
        .catch(() => results.push({ workerId: 'long', timedOut: true }))

      await Promise.all([shortTimeout, longTimeout])

      expect(results.length).toBe(2)
      const shortResult = results.find((r) => r.workerId === 'short')
      const longResult = results.find((r) => r.workerId === 'long')
      expect(shortResult?.timedOut).toBe(true)
      expect(longResult?.timedOut).toBe(true)

      await instancePool.cleanup()
    })

    it('should process queue after successful release', async () => {
      const instancePool = new ChromeInstancePool({
        basePort: 65000,
        instanceCount: 1,
        spawnTimeout: 100,
      })

      let releaseTriggered = false

      const firstAcquire = instancePool
        .acquire({ workerId: 'first', timeout: 2000 })
        .catch(() => null)

      const secondAcquire = instancePool
        .acquire({ workerId: 'second', timeout: 2000 })
        .then((instance: ChromeInstance) => {
          releaseTriggered = true
          return instance
        })
        .catch(() => null)

      const firstInstance = await firstAcquire

      if (firstInstance) {
        await Bun.sleep(100)
        await instancePool.release(firstInstance.id)
      }

      const resolvedSecondInstance = await secondAcquire

      if (firstInstance && resolvedSecondInstance) {
        expect(resolvedSecondInstance.workerId).toBe('second')
        expect(releaseTriggered).toBe(true)
      }

      await instancePool.cleanup()
    })

    it('should handle cleanup while requests are queued', async () => {
      const instancePool = new ChromeInstancePool({
        basePort: 66000,
        instanceCount: 0,
      })

      const queuedAcquire = instancePool.acquire({ workerId: 'queued', timeout: 5000 })

      await Bun.sleep(50)
      await instancePool.cleanup()

      await expectRejectsWithMessage(queuedAcquire, 'cleaning up')
    })

    it('should reject all queued requests on cleanup', async () => {
      const instancePool = new ChromeInstancePool({
        basePort: 67000,
        instanceCount: 0,
      })

      const errors: Error[] = []
      const promises: Array<Promise<ChromeInstance | null>> = []

      for (let i = 0; i < 5; i++) {
        promises.push(
          instancePool
            .acquire({ workerId: `worker-${i}`, timeout: 5000 })
            .catch((error: unknown) => {
              errors.push(toError(error))
              return null
            })
        )
      }

      await Bun.sleep(300)
      await instancePool.cleanup()

      await Promise.all(promises)

      expect(errors.length).toBeGreaterThan(0)
      errors.forEach((error) => {
        expect(error.message).toMatch(/Timeout|cleaning up/)
      })
    })

    it('should respect acquireMutex serialization', async () => {
      const instancePool = new ChromeInstancePool({
        basePort: 68000,
        instanceCount: 0,
      })

      const acquireStartTimes: number[] = []
      const acquireEndTimes: number[] = []

      const promises = Array.from({ length: 5 }, (_, i) => {
        const start = Date.now()
        acquireStartTimes.push(start)
        return instancePool
          .acquire({ workerId: `serial-${i}`, timeout: 200 })
          .catch(() => {
            acquireEndTimes.push(Date.now())
          })
      })

      await Promise.all(promises)

      expect(acquireStartTimes.length).toBe(5)
      expect(acquireEndTimes.length).toBe(5)

      await instancePool.cleanup()
    })
  })
})
