/**
 * Retry policy framework with exponential backoff and circuit breaker pattern.
 */

import {
  HarnessError,
  HarnessErrorCategory,
  TimeoutError,
  RateLimitError,
  CircuitBreakerError,
  CircuitBreakerError as CircuitBreakerOpenError,
  HarnessErrorSeverity,
  UnknownError,
} from "./errors"
import type { HarnessErrorContext } from "./errors"
import type { HarnessModelLane } from "./session"

export interface RetryPolicy {
  maxRetries: number
  baseDelayMS: number
  maxDelayMS: number
  backoffMultiplier: number
  jitter: boolean
  perErrorType?: Partial<Record<HarnessErrorCategory, RetryPolicyOverride>>
}

export interface RetryPolicyOverride {
  maxRetries?: number
  baseDelayMS?: number
  backoffMultiplier?: number
}

export interface RetryState {
  attempt: number
  lastError?: HarnessError
  cumulativeDelayMS: number
  startedAt: number
}

export interface CircuitBreakerConfig {
  failureThreshold: number
  recoveryTimeoutMS: number
  halfOpenMaxRequests: number
}

type CircuitState = "closed" | "open" | "half-open"

interface CircuitBreakerState {
  state: CircuitState
  failureCount: number
  lastFailureAt?: number
  halfOpenRequests: number
  openedAt?: number
}

export class CircuitBreaker {
  private state: CircuitBreakerState
  private readonly config: CircuitBreakerConfig
  private readonly name: string

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      recoveryTimeoutMS: config.recoveryTimeoutMS ?? 30000,
      halfOpenMaxRequests: config.halfOpenMaxRequests ?? 3,
    }
    this.state = {
      state: "closed",
      failureCount: 0,
      halfOpenRequests: 0,
    }
  }

  /**
   * Check if the circuit breaker allows the request.
   */
  canExecute(): boolean {
    this.transition()
    return this.state.state !== "open"
  }

  /**
   * Record a successful execution.
   */
  recordSuccess(): void {
    if (this.state.state === "half-open") {
      this.state.halfOpenRequests -= 1
      if (this.state.halfOpenRequests <= 0) {
        this.reset()
      }
    } else {
      this.state.failureCount = 0
    }
  }

  /**
   * Record a failed execution.
   */
  recordFailure(error?: HarnessError): void {
    if (this.state.state === "half-open") {
      this.trip(error)
      return
    }

    this.state.failureCount += 1
    this.state.lastFailureAt = Date.now()

    if (this.state.failureCount >= this.config.failureThreshold ||
        (error?.shouldOpenCircuitBreaker() ?? false)) {
      this.trip(error)
    }
  }

  /**
   * Get current circuit state.
   */
  getState(): CircuitState {
    this.transition()
    return this.state.state
  }

  /**
   * Get statistics for monitoring.
   */
  getStats(): Record<string, unknown> {
    return {
      name: this.name,
      state: this.state.state,
      failureCount: this.state.failureCount,
      lastFailureAt: this.state.lastFailureAt,
      openedAt: this.state.openedAt,
    }
  }

  private transition(): void {
    if (this.state.state !== "open") return

    const now = Date.now()
    if (this.state.openedAt && now - this.state.openedAt >= this.config.recoveryTimeoutMS) {
      this.state.state = "half-open"
      this.state.halfOpenRequests = this.config.halfOpenMaxRequests
    }
  }

  private trip(error?: HarnessError): void {
    this.state.state = "open"
    this.state.openedAt = Date.now()
    this.state.failureCount = this.config.failureThreshold
  }

  private reset(): void {
    this.state.state = "closed"
    this.state.failureCount = 0
    this.state.lastFailureAt = undefined
    this.state.halfOpenRequests = 0
    this.state.openedAt = undefined
  }
}

/**
 * Global circuit breaker registry per lane/model combination.
 */
export class CircuitBreakerRegistry {
  private static breakers = new Map<string, CircuitBreaker>()

  static get(lane: HarnessModelLane, model: string): CircuitBreaker {
    const key = `${lane}:${model}`
    if (!this.breakers.has(key)) {
      this.breakers.set(key, new CircuitBreaker(key, {
        failureThreshold: 3,
        recoveryTimeoutMS: 60000,
        halfOpenMaxRequests: 1,
      }))
    }
    return this.breakers.get(key)!
  }

  static getForProvider(providerID: string): CircuitBreaker {
    const key = `provider:${providerID}`
    if (!this.breakers.has(key)) {
      this.breakers.set(key, new CircuitBreaker(key, {
        failureThreshold: 5,
        recoveryTimeoutMS: 120000,
        halfOpenMaxRequests: 2,
      }))
    }
    return this.breakers.get(key)!
  }

  static clear(): void {
    this.breakers.clear()
  }

  static getAllStats(): Record<string, unknown>[] {
    return Array.from(this.breakers.values()).map((cb) => cb.getStats())
  }
}

/**
 * Default retry policy configuration.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMS: 1000,
  maxDelayMS: 60000,
  backoffMultiplier: 2,
  jitter: true,
  perErrorType: {
    [HarnessErrorCategory.TIMEOUT]: { maxRetries: 3, baseDelayMS: 5000 },
    [HarnessErrorCategory.RATE_LIMIT]: { maxRetries: 5, baseDelayMS: 10000, backoffMultiplier: 2 },
    [HarnessErrorCategory.OOM]: { maxRetries: 2, baseDelayMS: 1000 },
    [HarnessErrorCategory.NETWORK]: { maxRetries: 5, baseDelayMS: 1000 },
    [HarnessErrorCategory.API]: { maxRetries: 3, baseDelayMS: 2000 },
  },
}

/**
 * Retry executor with exponential backoff.
 */
export class RetryExecutor {
  private readonly policy: RetryPolicy
  private state: RetryState

  constructor(policy: Partial<RetryPolicy> = {}) {
    this.policy = { ...DEFAULT_RETRY_POLICY, ...policy }
    this.state = {
      attempt: 0,
      cumulativeDelayMS: 0,
      startedAt: Date.now(),
    }
  }

  /**
   * Execute a function with retry logic.
   */
  async execute<T>(
    fn: (attempt: number) => Promise<T>,
    context?: HarnessErrorContext,
  ): Promise<T> {
    while (true) {
      this.state.attempt += 1

      try {
        const result = await fn(this.state.attempt)
        return result
      } catch (error) {
        const harnessError = error instanceof HarnessError
          ? error
          : new UnknownError(error instanceof Error ? error.message : String(error), context ?? {})

        this.state.lastError = harnessError

        // Check if we should retry
        if (!this.shouldRetry(harnessError)) {
          throw harnessError
        }

        // Calculate and wait for backoff
        const delay = this.calculateBackoff(harnessError)
        this.state.cumulativeDelayMS += delay
        await this.sleep(delay)
      }
    }
  }

  /**
   * Get current retry state.
   */
  getState(): RetryState {
    return { ...this.state }
  }

  private shouldRetry(error: HarnessError): boolean {
    if (!error.retryable) return false

    const maxRetries = this.getMaxRetries(error)
    return this.state.attempt < maxRetries
  }

  private getMaxRetries(error: HarnessError): number {
    const override = this.policy.perErrorType?.[error.category]
    return override?.maxRetries ?? this.policy.maxRetries
  }

  private calculateBackoff(error: HarnessError): number {
    const override = this.policy.perErrorType?.[error.category]
    const baseDelay = error.retryAfterMS ??
      override?.baseDelayMS ??
      this.policy.baseDelayMS
    const multiplier = override?.backoffMultiplier ?? this.policy.backoffMultiplier

    let delay = baseDelay * Math.pow(multiplier, this.state.attempt - 1)
    delay = Math.min(delay, this.policy.maxDelayMS)

    if (this.policy.jitter) {
      delay = this.addJitter(delay)
    }

    return Math.floor(delay)
  }

  private addJitter(delay: number): number {
    // Add 0-25% jitter
    const jitter = delay * 0.25 * Math.random()
    return delay + jitter
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Execute with circuit breaker protection.
 */
export async function executeWithCircuitBreaker<T>(
  lane: HarnessModelLane,
  model: string,
  fn: () => Promise<T>,
): Promise<T> {
  const breaker = CircuitBreakerRegistry.get(lane, model)

  if (!breaker.canExecute()) {
    throw new CircuitBreakerOpenError(
      `Circuit breaker is open for ${lane}:${model}`,
      { lane, model },
    )
  }

  try {
    const result = await fn()
    breaker.recordSuccess()
    return result
  } catch (error) {
    const harnessError = error instanceof HarnessError
      ? error
      : new (class extends HarnessError {
        readonly category = HarnessErrorCategory.UNKNOWN
        readonly severity = HarnessErrorSeverity.RECOVERABLE
        readonly retryable = true
        readonly retryAfterMS = 1000
        constructor() {
          super(error instanceof Error ? error.message : String(error), { lane, model })
        }
      })()
    breaker.recordFailure(harnessError)
    throw harnessError
  }
}

/**
 * Model rotation recommendation.
 */
export interface ModelRotationRecommendation {
  shouldRotate: boolean
  reason: string
  suggestedLane?: HarnessModelLane
  excludeModels?: string[]
}

/**
 * Determine if model rotation is recommended based on error history.
 */
export function shouldRotateModel(
  errors: HarnessError[],
  currentModel: string,
): ModelRotationRecommendation {
  if (errors.length === 0) {
    return { shouldRotate: false, reason: "No errors recorded" }
  }

  const lastError = errors[errors.length - 1]

  // Rotate on degraded severity
  if (lastError.severity === HarnessErrorSeverity.DEGRADED) {
    return {
      shouldRotate: true,
      reason: `Last error was degraded severity: ${lastError.category}`,
      excludeModels: [currentModel],
    }
  }

  // Rotate after multiple recoverable failures
  const recentRecoverable = errors.slice(-3).filter(
    (e) => e.severity === HarnessErrorSeverity.RECOVERABLE && e.retryable
  )
  if (recentRecoverable.length >= 3) {
    return {
      shouldRotate: true,
      reason: `3+ consecutive recoverable failures`,
      excludeModels: [currentModel],
    }
  }

  // Rotate on repeated timeouts with same model
  const recentTimeouts = errors.slice(-2).filter((e) => e instanceof TimeoutError)
  if (recentTimeouts.length >= 2) {
    return {
      shouldRotate: true,
      reason: "2+ consecutive timeouts",
      excludeModels: [currentModel],
    }
  }

  // Rotate on rate limit
  if (lastError instanceof RateLimitError) {
    return {
      shouldRotate: true,
      reason: "Rate limit hit",
      excludeModels: [currentModel],
    }
  }

  return { shouldRotate: false, reason: "Current model still viable" }
}

/**
 * Wait for circuit breaker to close.
 */
export async function waitForCircuitBreaker(
  lane: HarnessModelLane,
  model: string,
  maxWaitMS: number = 120000,
): Promise<boolean> {
  const breaker = CircuitBreakerRegistry.get(lane, model)
  const start = Date.now()

  while (breaker.getState() === "open") {
    if (Date.now() - start >= maxWaitMS) {
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  return true
}
