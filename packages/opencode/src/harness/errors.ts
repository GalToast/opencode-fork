/**
 * Structured error taxonomy for the OpenCode harness.
 *
 * Replaces string-based error handling with typed errors that support
 * automatic retry policies, model rotation, and healer decisions.
 */

import type { HarnessModelLane } from "./session"

export enum HarnessErrorCategory {
  TIMEOUT = "timeout",
  OOM = "oom",
  API = "api",
  PARSE = "parse",
  VALIDATION = "validation",
  AUTH = "auth",
  RATE_LIMIT = "rate_limit",
  CIRCUIT_BREAKER = "circuit_breaker",
  NETWORK = "network",
  SESSION = "session",
  UNKNOWN = "unknown",
}

export enum HarnessErrorSeverity {
  TRANSIENT = "transient", // Can retry immediately
  RECOVERABLE = "recoverable", // Can retry with backoff
  DEGRADED = "degraded", // Can retry with model rotation
  FATAL = "fatal", // Should not retry, stage immediately
}

export interface HarnessErrorContext {
  lane?: HarnessModelLane
  model?: string
  provider?: string
  attempt?: number
  sessionID?: string
  proposalID?: string
  timestamp?: number
  metadata?: Record<string, unknown>
}

export abstract class HarnessError extends Error {
  abstract readonly category: HarnessErrorCategory
  abstract readonly severity: HarnessErrorSeverity
  abstract readonly retryable: boolean
  abstract readonly retryAfterMS?: number

  context: HarnessErrorContext

  constructor(
    message: string,
    context: HarnessErrorContext = {},
  ) {
    super(message)
    this.name = this.constructor.name
    this.context = {
      timestamp: Date.now(),
      ...context,
    }
  }

  /**
   * Returns true if the error should trigger automatic model rotation.
   */
  shouldRotateModel(): boolean {
    return this.severity === HarnessErrorSeverity.DEGRADED ||
      (this.severity === HarnessErrorSeverity.RECOVERABLE && (this.context.attempt ?? 0) >= 2)
  }

  /**
   * Returns true if the error indicates a circuit breaker should open.
   */
  shouldOpenCircuitBreaker(): boolean {
    return this.category === HarnessErrorCategory.RATE_LIMIT ||
      (this.category === HarnessErrorCategory.API && this.severity === HarnessErrorSeverity.FATAL)
  }

  /**
   * Returns the recommended retry strategy for this error type.
   */
  getRetryStrategy(): RetryStrategy {
    switch (this.category) {
      case HarnessErrorCategory.TIMEOUT:
        return {
          maxRetries: 3,
          backoffMultiplier: 2,
          baseDelayMS: 5000,
          jitter: true,
        }
      case HarnessErrorCategory.RATE_LIMIT:
        return {
          maxRetries: 5,
          backoffMultiplier: 2,
          baseDelayMS: this.retryAfterMS ?? 10000,
          jitter: true,
        }
      case HarnessErrorCategory.OOM:
        return {
          maxRetries: 2,
          backoffMultiplier: 1.5,
          baseDelayMS: 1000,
          jitter: false,
        }
      case HarnessErrorCategory.API:
        return {
          maxRetries: 3,
          backoffMultiplier: 2,
          baseDelayMS: 2000,
          jitter: true,
        }
      case HarnessErrorCategory.NETWORK:
        return {
          maxRetries: 5,
          backoffMultiplier: 1.5,
          baseDelayMS: 1000,
          jitter: true,
        }
      default:
        return {
          maxRetries: 2,
          backoffMultiplier: 2,
          baseDelayMS: 1000,
          jitter: true,
        }
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      severity: this.severity,
      retryable: this.retryable,
      retryAfterMS: this.retryAfterMS,
      context: this.context,
      stack: this.stack,
    }
  }
}

export interface RetryStrategy {
  maxRetries: number
  baseDelayMS: number
  backoffMultiplier: number
  jitter: boolean
}

/**
 * Timeout error - provider timeout or stall detection
 */
export class TimeoutError extends HarnessError {
  readonly category = HarnessErrorCategory.TIMEOUT
  readonly severity = HarnessErrorSeverity.RECOVERABLE
  readonly retryable = true
  readonly retryAfterMS?: number

  constructor(
    message: string,
    context: HarnessErrorContext & { timeoutMS?: number; lastProgress?: string },
  ) {
    super(message, context)
    this.retryAfterMS = context.timeoutMS
  }

  /**
   * Returns true if this was a startup timeout (session_start stall).
   */
  isStartupTimeout(): boolean {
    const timeoutContext = this.context as HarnessErrorContext & { lastProgress?: string }
    return timeoutContext.lastProgress === "session_start" ||
      /session_start/i.test(this.message)
  }
}

/**
 * Out of memory error during generation
 */
export class OOMError extends HarnessError {
  readonly category = HarnessErrorCategory.OOM
  readonly severity = HarnessErrorSeverity.DEGRADED
  readonly retryable = true
  readonly retryAfterMS = 1000
}

/**
 * API error - authentication, server errors, etc.
 */
export class APIError extends HarnessError {
  readonly category = HarnessErrorCategory.API
  readonly severity: HarnessErrorSeverity
  readonly retryable: boolean
  readonly retryAfterMS?: number
  readonly statusCode?: number

  constructor(
    message: string,
    context: HarnessErrorContext & { statusCode?: number; retryable?: boolean },
  ) {
    super(message, context)
    this.statusCode = context.statusCode

    // Determine severity based on status code
    if (context.statusCode) {
      if (context.statusCode >= 500) {
        this.severity = HarnessErrorSeverity.RECOVERABLE
        this.retryable = context.retryable ?? true
        this.retryAfterMS = 5000
      } else if (context.statusCode === 429) {
        this.severity = HarnessErrorSeverity.DEGRADED
        this.retryable = true
        this.retryAfterMS = 10000
      } else if (context.statusCode === 401 || context.statusCode === 403) {
        this.severity = HarnessErrorSeverity.FATAL
        this.retryable = false
      } else {
        this.severity = HarnessErrorSeverity.RECOVERABLE
        this.retryable = context.retryable ?? true
      }
    } else {
      this.severity = HarnessErrorSeverity.RECOVERABLE
      this.retryable = context.retryable ?? true
    }
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403 ||
      /authentication|unauthorized|forbidden/i.test(this.message)
  }
}

/**
 * Parse error - JSON parsing failures
 */
export class ParseError extends HarnessError {
  readonly category = HarnessErrorCategory.PARSE
  readonly severity = HarnessErrorSeverity.RECOVERABLE
  readonly retryable = true
  readonly retryAfterMS = 0
}

/**
 * Validation error - patch validation failures
 */
export class ValidationError extends HarnessError {
  readonly category = HarnessErrorCategory.VALIDATION
  readonly severity = HarnessErrorSeverity.RECOVERABLE
  readonly retryable = true
  readonly retryAfterMS = 0

  constructor(
    message: string,
    context: HarnessErrorContext & {
      patchText?: string
      validationType?: "syntax" | "context" | "scope" | "strategy"
    },
  ) {
    super(message, context)
  }

  /**
   * Returns true if this is a stale context error (hunk context mismatch).
   */
  isStaleContext(): boolean {
    return /failed to find expected lines|stale context/i.test(this.message)
  }

  /**
   * Returns true if this is a malformed patch error.
   */
  isMalformedPatch(): boolean {
    return /missing begin\/end markers|contained no apply_patch hunks|valid apply_patch body/i.test(this.message)
  }

  /**
   * Returns true if this is a git diff syntax error.
   */
  isGitDiffSyntax(): boolean {
    return /git diff syntax/i.test(this.message)
  }
}

/**
 * Authentication error
 */
export class AuthError extends HarnessError {
  readonly category = HarnessErrorCategory.AUTH
  readonly severity = HarnessErrorSeverity.FATAL
  readonly retryable = false
  readonly retryAfterMS = undefined
}

/**
 * Rate limit error
 */
export class RateLimitError extends HarnessError {
  readonly category = HarnessErrorCategory.RATE_LIMIT
  readonly severity = HarnessErrorSeverity.DEGRADED
  readonly retryable = true
  readonly retryAfterMS: number

  constructor(
    message: string,
    context: HarnessErrorContext & { retryAfterMS?: number },
  ) {
    super(message, context)
    this.retryAfterMS = context.retryAfterMS ?? 60000
  }
}

/**
 * Network error
 */
export class NetworkError extends HarnessError {
  readonly category = HarnessErrorCategory.NETWORK
  readonly severity = HarnessErrorSeverity.RECOVERABLE
  readonly retryable = true
  readonly retryAfterMS = 1000
}

/**
 * Session error - session creation/management failures
 */
export class SessionError extends HarnessError {
  readonly category = HarnessErrorCategory.SESSION
  readonly severity = HarnessErrorSeverity.RECOVERABLE
  readonly retryable = true
  readonly retryAfterMS = 2000

  /**
   * Returns true if this was a session startup failure.
   */
  isStartupFailure(): boolean {
    return /session_start|root_session|child_session/i.test(this.message)
  }
}

/**
 * Circuit breaker open error
 */
export class CircuitBreakerError extends HarnessError {
  readonly category = HarnessErrorCategory.CIRCUIT_BREAKER
  readonly severity = HarnessErrorSeverity.FATAL
  readonly retryable = false
  readonly retryAfterMS = undefined
}

/**
 * Catch-all error when no more specific taxonomy matches.
 */
export class UnknownError extends HarnessError {
  readonly category = HarnessErrorCategory.UNKNOWN
  readonly severity = HarnessErrorSeverity.RECOVERABLE
  readonly retryable = true
  readonly retryAfterMS = 1000
}

/**
 * Error classification utilities
 */
export function classifyError(error: unknown, context?: HarnessErrorContext): HarnessError {
  if (error instanceof HarnessError) {
    if (context) {
      error.context = { ...error.context, ...context }
    }
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  const mergedContext = { timestamp: Date.now(), ...context }

  if (/timed out|timeout|stall/i.test(message)) {
    return new TimeoutError(message, { ...mergedContext, lastProgress: extractLastProgress(message) })
  }

  if (/oom|out of memory|memory limit|context length|token limit/i.test(message)) {
    return new OOMError(message, mergedContext)
  }

  if (/rate limit|rate_limit|too many requests/i.test(message)) {
    const retryAfter = extractRetryAfter(message)
    return new RateLimitError(message, { ...mergedContext, retryAfterMS: retryAfter })
  }

  if (/authentication|unauthorized|forbidden|auth|api key|invalid key/i.test(message)) {
    return new AuthError(message, mergedContext)
  }

  if (/network|connection|econnrefused|socket/i.test(message)) {
    return new NetworkError(message, mergedContext)
  }

  if (/session|session_start|root_session|child_session/i.test(message)) {
    return new SessionError(message, mergedContext)
  }

  if (/parse|syntax|json|malformed/i.test(message)) {
    return new ParseError(message, mergedContext)
  }

  if (/validation|invalid|failed to find expected lines|patch.*hunk|apply_patch|begin patch/i.test(message)) {
    return new ValidationError(message, mergedContext)
  }

  return new UnknownError(message, mergedContext)
}

function extractLastProgress(message: string): string | undefined {
  const match = message.match(/last progress:\s*(\S+)/i)
  return match?.[1]
}

function extractRetryAfter(message: string): number | undefined {
  const match = message.match(/retry after (\d+)/i)
  if (match) return parseInt(match[1], 10) * 1000
  return undefined
}

/**
 * Type guards for error classification
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError
}

export function isOOMError(error: unknown): error is OOMError {
  return error instanceof OOMError
}

export function isAPIError(error: unknown): error is APIError {
  return error instanceof APIError
}

export function isParseError(error: unknown): error is ParseError {
  return error instanceof ParseError
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError
}

export function isSessionError(error: unknown): error is SessionError {
  return error instanceof SessionError
}

export function isCircuitBreakerError(error: unknown): error is CircuitBreakerError {
  return error instanceof CircuitBreakerError
}
