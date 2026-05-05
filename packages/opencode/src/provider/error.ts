import { APICallError } from "ai"
import { STATUS_CODES } from "http"
import { iife } from "@/util/iife"

type JsonRecord = Record<string, unknown>

// Adapted from overflow detection patterns in:
// https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/utils/overflow.ts
const OVERFLOW_PATTERNS = [
  /prompt is too long/i, // Anthropic
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI (Completions + Responses API message text)
  /input token count.*exceeds the maximum/i, // Google (Gemini)
  /maximum prompt length is \d+/i, // xAI (Grok)
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter, DeepSeek
  /exceeds the limit of \d+/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp server
  /greater than the context length/i, // LM Studio
  /context window exceeds limit/i, // MiniMax
  /exceeded model token limit/i, // Kimi For Coding, Moonshot
  /context[_ ]length[_ ]exceeded/i, // Generic fallback
  /range of input length should be \[1,\s*\d+\]/i, // DashScope / GLM-5
  /request entity too large/i, // HTTP 413
] as const

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJson(input: unknown): unknown {
  if (typeof input === "object" && input !== null) return input
  if (typeof input !== "string") return undefined
  try {
    return JSON.parse(input) as unknown
  } catch {
    return undefined
  }
}

function parseJsonObject(input: unknown): JsonRecord | undefined {
  const parsed = parseJson(input)
  if (!isRecord(parsed)) return undefined
  return parsed
}

function extractResponseMessage(responseBody: unknown): string | undefined {
  const body = parseJsonObject(responseBody)
  if (!body) return undefined

  const messageValue = body.message
  if (typeof messageValue === "string") return messageValue

  const errorValue = body.error
  if (typeof errorValue === "string") return errorValue
  if (isRecord(errorValue)) {
    const nestedMessage = errorValue.message
    if (typeof nestedMessage === "string") return nestedMessage
  }
}

function getStreamErrorCode(body: JsonRecord): string | undefined {
  const errorValue = body.error
  if (!isRecord(errorValue)) return undefined
  const code = errorValue.code
  return typeof code === "string" ? code : undefined
}

function getStreamErrorMessage(body: JsonRecord): string | undefined {
  const errorValue = body.error
  if (!isRecord(errorValue)) return undefined
  const rawMessage = errorValue.message
  return typeof rawMessage === "string" ? rawMessage : undefined
}

function isOpenAiErrorRetryable(apiError: APICallError) {
  const status = apiError.statusCode
  if (!status) return apiError.isRetryable
  // openai sometimes returns 404 for models that are actually available
  return status === 404 || apiError.isRetryable
}

// Providers not reliably handled in this function:
// - z.ai: can accept overflow silently (needs token-count/context-window checks)
export function isOverflowMessageText(messageText: string) {
  if (OVERFLOW_PATTERNS.some((pattern) => pattern.test(messageText))) return true

  // Providers/status patterns handled outside of regex list:
  // - Cerebras: often returns "400 (no body)" / "413 (no body)"
  // - Mistral: often returns "400 (no body)" / "413 (no body)"
  return /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(messageText)
}

function transformErrorMessage(providerID: string, apiError: APICallError) {
  return iife(() => {
    const messageText = apiError.message
    if (messageText === "") {
      if (apiError.responseBody) return apiError.responseBody
      if (apiError.statusCode) {
        const statusMessage = STATUS_CODES[apiError.statusCode]
        if (statusMessage) return statusMessage
      }
      return "Unknown error"
    }

    const copilotMessage = transformProviderSpecificError(providerID, apiError)
    if (copilotMessage !== messageText) return copilotMessage
    if (!apiError.responseBody || (apiError.statusCode && messageText !== STATUS_CODES[apiError.statusCode])) return messageText

    const errMsg = extractResponseMessage(apiError.responseBody)
    if (errMsg) return `${messageText}: ${errMsg}`

    // If responseBody is HTML (e.g. from a gateway or proxy error page),
    // provide a human-readable message instead of dumping raw markup
    if (/^\s*<!doctype|^\s*<html/i.test(apiError.responseBody)) {
      if (apiError.statusCode === 401) {
        return "Unauthorized: request was blocked by a gateway or proxy. Your authentication token may be missing or expired — try running `opencode auth login <your provider URL>` to re-authenticate."
      }
      if (apiError.statusCode === 403) {
        return "Forbidden: request was blocked by a gateway or proxy. You may not have permission to access this resource — check your account and provider settings."
      }
      return messageText
    }

    return `${messageText}: ${apiError.responseBody}`
  }).trim()
}

function transformProviderSpecificError(providerID: string, apiError: APICallError) {
  if (providerID.includes("github-copilot") && apiError.statusCode === 403) {
    return "Please reauthenticate with the copilot provider to ensure your credentials work properly with OpenCode."
  }

  return apiError.message
}

export type ParsedStreamError =
  | {
      type: "context_overflow"
      message: string
      responseBody: string
    }
  | {
      type: "api_error"
      message: string
      isRetryable: false
      responseBody: string
    }

export function parseStreamError(input: unknown): ParsedStreamError | undefined {
  const body = parseJson(input)
  if (!isRecord(body)) return
  const responseBody = JSON.stringify(body)
  if (body.type !== "error") return

  switch (getStreamErrorCode(body)) {
    case "context_length_exceeded":
      return {
        type: "context_overflow",
        message: "Input exceeds context window of this model",
        responseBody,
      }
    case "insufficient_quota":
      return {
        type: "api_error",
        message: "Quota exceeded. Check your plan and billing details.",
        isRetryable: false,
        responseBody,
      }
    case "usage_not_included":
      return {
        type: "api_error",
        message: "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.",
        isRetryable: false,
        responseBody,
      }
    case "invalid_prompt":
      return {
        type: "api_error",
        message: getStreamErrorMessage(body) ?? "Invalid prompt.",
        isRetryable: false,
        responseBody,
      }
  }
}

export type ParsedAPICallError =
  | {
      type: "context_overflow"
      message: string
      responseBody?: string
    }
  | {
      type: "api_error"
      message: string
      statusCode?: number
      isRetryable: boolean
      responseHeaders?: Record<string, string>
      responseBody?: string
      metadata?: Record<string, string>
    }

export function parseAPICallError(input: { providerID: string; error: APICallError }): ParsedAPICallError {
  const parsedMessage = transformErrorMessage(input.providerID, input.error)
  if (isOverflowMessageText(parsedMessage) || input.error.statusCode === 413) {
    return {
      type: "context_overflow",
      message: parsedMessage,
      responseBody: input.error.responseBody,
    }
  }

  const metadata = input.error.url ? { url: input.error.url } : undefined
  return {
    type: "api_error",
    message: parsedMessage,
    statusCode: input.error.statusCode,
    isRetryable: input.providerID.startsWith("openai")
      ? isOpenAiErrorRetryable(input.error)
      : input.error.isRetryable,
    responseHeaders: input.error.responseHeaders,
    responseBody: input.error.responseBody,
    metadata,
  }
}

export const ProviderError = {
  isOverflowMessageText,
  parseStreamError,
  parseAPICallError,
}
