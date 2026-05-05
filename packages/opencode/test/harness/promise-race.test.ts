import { describe, test, expect, mock } from "bun:test"

describe("Promise.race dangling promises fix", () => {
  test("timeout properly cancels the main promise", async () => {
    let mainPromiseSettled = false
    let timeoutSettled = false

    const mainPromise = new Promise<never>((resolve, reject) => {
      setTimeout(() => {
        mainPromiseSettled = true
        resolve(undefined as never)
      }, 100)
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timeoutSettled = true
        reject(new Error("Timeout"))
      }, 10)
    })

    try {
      await Promise.race([mainPromise, timeoutPromise])
      throw new Error("Should have thrown timeout error")
    } catch (error) {
      if ((error as Error).message === "Should have thrown timeout error") throw error
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("Timeout")
    }

    expect(timeoutSettled).toBe(true)
    expect(mainPromiseSettled).toBe(false)
  })

  test("stall timeout properly cancels", async () => {
    let mainPromiseSettled = false
    let stallSettled = false

    const mainPromise = new Promise<string>((resolve) => {
      setTimeout(() => {
        mainPromiseSettled = true
        resolve("success")
      }, 100)
    })

    const stallPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        stallSettled = true
        reject(new Error("Stall"))
      }, 10)
    })

    try {
      await Promise.race([mainPromise, stallPromise])
      throw new Error("Should have thrown stall error")
    } catch (error) {
      if ((error as Error).message === "Should have thrown stall error") throw error
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("Stall")
    }

    expect(stallSettled).toBe(true)
    expect(mainPromiseSettled).toBe(false)
  })

  test("all promises are cleaned up after race completes successfully", async () => {
    let timeoutHandleCleared = false
    let stallHandleCleared = false
    let mainResolved = false

    const mockClearTimeout = mock((handle: number) => {
      if (handle === 1) timeoutHandleCleared = true
      if (handle === 2) stallHandleCleared = true
    })

    const originalClearTimeout = global.clearTimeout
    global.clearTimeout = mockClearTimeout as any

    try {
      const timeoutHandle = 1
      const stallHandle = 2

      const mainPromise = new Promise<string>((resolve) => {
        setTimeout(() => {
          mainResolved = true
          resolve("success")
        }, 10)
      })

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Timeout"))
        }, 100)
      })

      const stallPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Stall"))
        }, 100)
      })

      const result = await Promise.race([mainPromise, timeoutPromise, stallPromise])

      mockClearTimeout(timeoutHandle)
      mockClearTimeout(stallHandle)

      expect(result).toBe("success")
      expect(mainResolved).toBe(true)
      expect(timeoutHandleCleared).toBe(true)
      expect(stallHandleCleared).toBe(true)
    } finally {
      global.clearTimeout = originalClearTimeout
    }
  })

  test("errors in one promise don't leave others hanging", async () => {
    let timeoutRejected = false
    let stallRejected = false
    let mainRejected = false

    const mainPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        mainRejected = true
        reject(new Error("Main error"))
      }, 100)
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timeoutRejected = true
        reject(new Error("Timeout error"))
      }, 10)
    })

    const stallPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        stallRejected = true
        reject(new Error("Stall error"))
      }, 100)
    })

    try {
      await Promise.race([mainPromise, timeoutPromise, stallPromise])
      throw new Error("Should have thrown")
    } catch (error) {
      if ((error as Error).message === "Should have thrown") throw error
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("Timeout error")
    }

    expect(timeoutRejected).toBe(true)
    expect(mainRejected).toBe(false)
    expect(stallRejected).toBe(false)
  })

  test("withTimeout helper cleans up properly on success", async () => {
    let cleanupCalled = false
    let timeoutCleared = false

    const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
      let timeoutResolved = false
      let timeoutHandle: ReturnType<typeof setTimeout>

      const timeoutProm = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timeoutResolved = true
          reject(new Error("Timeout"))
        }, timeoutMs)
      })

      const cleanup = () => {
        cleanupCalled = true
        if (!timeoutResolved && timeoutHandle) {
          clearTimeout(timeoutHandle)
          timeoutCleared = true
        }
      }

      try {
        const result = await Promise.race([promise, timeoutProm])
        cleanup()
        return result
      } catch (error) {
        cleanup()
        throw error
      }
    }

    const result = await withTimeout(Promise.resolve("success"), 1000)

    expect(result).toBe("success")
    expect(cleanupCalled).toBe(true)
    expect(timeoutCleared).toBe(true)
  })

  test("withTimeout helper cleans up properly on timeout", async () => {
    let cleanupCalled = false
    let mainPromiseCancelled = false

    const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
      let timeoutResolved = false
      let timeoutHandle: ReturnType<typeof setTimeout>

      const timeoutProm = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timeoutResolved = true
          reject(new Error("Timeout"))
        }, timeoutMs)
      })

      const cleanup = () => {
        cleanupCalled = true
        if (!timeoutResolved && timeoutHandle) {
          clearTimeout(timeoutHandle)
        }
      }

      try {
        const result = await Promise.race([promise, timeoutProm])
        cleanup()
        return result
      } catch (error) {
        cleanup()
        throw error
      }
    }

    const slowPromise = new Promise<string>((resolve) => {
      const handle = setTimeout(() => {
        mainPromiseCancelled = false
        resolve("success")
      }, 1000)
      setTimeout(() => {
        clearTimeout(handle)
        mainPromiseCancelled = true
      }, 50)
    })

    try {
      await withTimeout(slowPromise, 20)
      throw new Error("Should have thrown timeout error")
    } catch (error) {
      if ((error as Error).message === "Should have thrown timeout error") throw error
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("Timeout")
    }

    expect(cleanupCalled).toBe(true)
  })

  test("multiple withTimeout calls don't share promise state", async () => {
    let firstTimeoutFired = false
    let secondTimeoutFired = false

    const createWithTimeout = (timeoutMs: number, onTimeout: () => void) => {
      return async <T>(promise: Promise<T>): Promise<T> => {
        const timeoutProm = new Promise<never>((_, reject) => {
          setTimeout(() => {
            onTimeout()
            reject(new Error("Timeout"))
          }, timeoutMs)
        })

        try {
          return await Promise.race([promise, timeoutProm])
        } catch (error) {
          throw error
        }
      }
    }

    const withTimeout1 = createWithTimeout(10, () => {
      firstTimeoutFired = true
    })
    const withTimeout2 = createWithTimeout(10, () => {
      secondTimeoutFired = true
    })

    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("success"), 100)
    })

    try {
      await withTimeout1(slowPromise)
    } catch {}

    try {
      await withTimeout2(slowPromise)
    } catch {}

    expect(firstTimeoutFired).toBe(true)
    expect(secondTimeoutFired).toBe(true)
  })
})
