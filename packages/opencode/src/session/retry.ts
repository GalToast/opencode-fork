import type { NamedError } from "@opencode-ai/util/error"
import { Cause, Clock, Duration, Effect, Schedule } from "effect"
import { MessageV2 } from "./message-v2"

export type Err = ReturnType<NamedError["toObject"]>

type RetryError = Err
type RetryErrorPayload = {
  code?: string
  type?: string
  error?: {
    type?: string
    code?: string
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null
}

const asString = (value: unknown): value is string => {
  return typeof value === "string"
}

const parseMessagePayload = (error: RetryError): RetryErrorPayload | undefined => {
  if (!isRecord(error.data)) return undefined
  const message = error.data.message
  if (!asString(message)) return undefined

  try {
    const parsed = JSON.parse(message) as unknown
    if (!isRecord(parsed)) return undefined
    const code = asString(parsed.code) ? parsed.code : undefined
    const type = asString(parsed.type) ? parsed.type : undefined
    const parsedError = isRecord(parsed.error) ? parsed.error : undefined
    const nestedType = asString(parsedError?.type) ? parsedError.type : undefined
    const nestedCode = asString(parsedError?.code) ? parsedError.code : undefined

    return {
      code,
      type,
      error: {
        type: nestedType,
        code: nestedCode,
      },
    }
  } catch {
    return undefined
  }
}

export const RETRY_INITIAL_DELAY = 2000
export const RETRY_BACKOFF_FACTOR = 2
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout

export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(handleTimeout, Math.min(ms, RETRY_MAX_DELAY))

    function handleTimeout() {
      signal.removeEventListener("abort", handleAbort)
      resolve()
    }

    function handleAbort() {
      clearTimeout(timeout)
      reject(new DOMException("Aborted", "AbortError"))
    }

    signal.addEventListener("abort", handleAbort, { once: true })
  })
}

export function delay(attempt: number, error?: MessageV2.APIError) {
  if (error) {
    const headers = error.data.responseHeaders
    if (headers) {
      const retryAfterMs = headers["retry-after-ms"]
      if (retryAfterMs) {
        const parsedMs = Number.parseFloat(retryAfterMs)
        if (!Number.isNaN(parsedMs)) {
          return parsedMs
        }
      }

      const retryAfter = headers["retry-after"]
      if (retryAfter) {
        const parsedSeconds = Number.parseFloat(retryAfter)
        if (!Number.isNaN(parsedSeconds)) {
          // convert seconds to milliseconds
          return Math.ceil(parsedSeconds * 1000)
        }
        // Try parsing as HTTP date format
        const parsed = Date.parse(retryAfter) - Date.now()
        if (!Number.isNaN(parsed) && parsed > 0) {
          return Math.ceil(parsed)
        }
      }

      return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
    }
  }

  return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS)
}

export function retryable(error: RetryError) {
  // context overflow errors should not be retried
  if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
  if (MessageV2.APIError.isInstance(error)) {
    if (!error.data.isRetryable) return undefined
    if (error.data.responseBody?.includes("FreeUsageLimitError")) return `Free usage exceeded, add credits https://opencode.ai/zen`
    return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
  }

  const json = parseMessagePayload(error)
  if (!json) return undefined
  const code = json.code

  if (json.type === "error" && json.error?.type === "too_many_requests") {
    return "Too Many Requests"
  }
  if (code?.includes("exhausted") || code?.includes("unavailable")) {
    return "Provider is overloaded"
  }
  if (json.type === "error" && json.error?.code?.includes("rate_limit")) {
    return "Rate Limited"
  }
  return JSON.stringify(json)
}

function cap(ms: number) {
  return Math.min(ms, RETRY_MAX_DELAY)
}

function delayWithCap(attempt: number, error?: MessageV2.APIError) {
  return cap(delay(attempt, error))
}

const outerSleep = sleep
const outerDelay = delay
const outerRetryable = retryable

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000
  export const RETRY_MAX_DELAY = 2_147_483_647
  export const sleep = outerSleep
  export const delay = outerDelay
  export const retryable = outerRetryable

  export function policy(opts: {
    parse: (error: unknown) => Err
    set: (input: { attempt: number; message: string; next: number }) => Effect.Effect<void>
  }) {
    return Schedule.fromStepWithMetadata(
      Effect.succeed((meta: Schedule.InputMetadata<unknown>) => {
        const error = opts.parse(meta.input)
        const message = outerRetryable(error)
        if (!message) return Cause.done(meta.attempt)
        return Effect.gen(function* () {
          const wait = delayWithCap(meta.attempt, MessageV2.APIError.isInstance(error) ? error : undefined)
          const now = yield* Clock.currentTimeMillis
          yield* opts.set({ attempt: meta.attempt, message, next: now + wait })
          return [meta.attempt, Duration.millis(wait)] as [number, Duration.Duration]
        })
      }),
    )
  }
}
