import { describe, it, expect } from "bun:test"
import {
  isSessionListResult,
  isMessageListResult,
  isAssistantMessage,
  extractSessionList,
  extractMessageList,
} from "@/harness/session"

describe("Harness Session Type Guards", () => {
  describe("isSessionListResult", () => {
    it("should return true for valid session list result", () => {
      const valid = {
        data: [
          { id: "session-1", parentID: "parent-1" },
          { id: "session-2", parentID: "parent-2" },
        ],
      }
      expect(isSessionListResult(valid)).toBe(true)
    })

    it("should return false for null", () => {
      expect(isSessionListResult(null)).toBe(false)
    })

    it("should return false for undefined", () => {
      expect(isSessionListResult(undefined)).toBe(false)
    })

    it("should return false for non-object", () => {
      expect(isSessionListResult("string")).toBe(false)
      expect(isSessionListResult(123)).toBe(false)
    })

    it("should return false for object without data array", () => {
      expect(isSessionListResult({})).toBe(false)
      expect(isSessionListResult({ data: "not-array" })).toBe(false)
    })

    it("should return true for empty data array", () => {
      expect(isSessionListResult({ data: [] })).toBe(true)
    })
  })

  describe("isMessageListResult", () => {
    it("should return true for valid message list result", () => {
      const valid = {
        data: [
          {
            id: "msg-1",
            info: { role: "assistant", time: { created: Date.now() } },
          },
        ],
      }
      expect(isMessageListResult(valid)).toBe(true)
    })

    it("should return false for null", () => {
      expect(isMessageListResult(null)).toBe(false)
    })

    it("should return false for object without data array", () => {
      expect(isMessageListResult({})).toBe(false)
      expect(isMessageListResult({ data: "not-array" })).toBe(false)
    })

    it("should return true for empty data array", () => {
      expect(isMessageListResult({ data: [] })).toBe(true)
    })
  })

  describe("isAssistantMessage", () => {
    it("should return true for valid assistant message", () => {
      const valid = {
        info: {
          role: "assistant",
          time: { created: Date.now() },
        },
        parts: [
          { type: "text", text: "Hello" },
          { type: "reasoning", text: "Thinking..." },
        ],
      }
      expect(isAssistantMessage(valid)).toBe(true)
    })

    it("should return true for assistant message with structured output", () => {
      const valid = {
        info: {
          role: "assistant",
          time: { completed: Date.now() },
          structured: { result: "success" },
        },
      }
      expect(isAssistantMessage(valid)).toBe(true)
    })

    it("should return false for null", () => {
      expect(isAssistantMessage(null)).toBe(false)
    })

    it("should return false for object without info", () => {
      expect(isAssistantMessage({})).toBe(false)
      expect(isAssistantMessage({ parts: [] })).toBe(false)
    })

    it("should return false for non-object info", () => {
      expect(isAssistantMessage({ info: "string" })).toBe(false)
      expect(isAssistantMessage({ info: 123 })).toBe(false)
    })

    it("should return true for minimal assistant message", () => {
      const minimal = { info: {} }
      expect(isAssistantMessage(minimal)).toBe(true)
    })
  })

  describe("extractSessionList", () => {
    it("should extract sessions from valid result", () => {
      const input = {
        data: [
          { id: "s1", parentID: "p1" },
          { id: "s2", parentID: "p2" },
          { id: "s3" },
        ],
      }
      const result = extractSessionList(input)
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ id: "s1", parentID: "p1" })
      expect(result[1]).toEqual({ id: "s2", parentID: "p2" })
      expect(result[2]).toEqual({ id: "s3" })
    })

    it("should return empty array for invalid input", () => {
      expect(extractSessionList(null)).toEqual([])
      expect(extractSessionList(undefined)).toEqual([])
      expect(extractSessionList({})).toEqual([])
    })

    it("should return empty array for empty data", () => {
      expect(extractSessionList({ data: [] })).toEqual([])
    })

    it("should filter out non-object items", () => {
      const input = {
        data: [
          { id: "s1", parentID: "p1" },
          null,
          "string",
          123,
          { id: "s2", parentID: "p2" },
        ],
      }
      const result = extractSessionList(input as any)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ id: "s1", parentID: "p1" })
      expect(result[1]).toEqual({ id: "s2", parentID: "p2" })
    })
  })

  describe("extractMessageList", () => {
    it("should extract messages from valid result", () => {
      const input = {
        data: [
          {
            id: "m1",
            info: { role: "assistant", time: { created: 123 } },
            parts: [{ type: "text", text: "Hello" }],
          },
          {
            id: "m2",
            info: { role: "user", time: { created: 124 } },
          },
        ],
      }
      const result = extractMessageList(input)
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe("m1")
      expect(result[1].id).toBe("m2")
    })

    it("should return empty array for invalid input", () => {
      expect(extractMessageList(null)).toEqual([])
      expect(extractMessageList(undefined)).toEqual([])
      expect(extractMessageList({})).toEqual([])
    })

    it("should return empty array for empty data", () => {
      expect(extractMessageList({ data: [] })).toEqual([])
    })

    it("should filter out non-object items", () => {
      const input = {
        data: [
          { id: "m1", info: { role: "assistant" } },
          null,
          "string",
          { id: "m2", info: { role: "user" } },
        ],
      }
      const result = extractMessageList(input as any)
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe("m1")
      expect(result[1].id).toBe("m2")
    })
  })
})

describe("Harness Session Type Safety", () => {
  it("should handle assistant message with all optional fields", () => {
    const message = {
      info: {
        role: "assistant" as const,
        time: {
          created: Date.now(),
          updated: Date.now(),
          completed: Date.now(),
          start: Date.now(),
        },
        structured: { key: "value" },
        model: {
          providerID: "openai" as any,
          modelID: "gpt-4" as any,
        },
      },
      parts: [
        {
          type: "text",
          text: "Response text",
          id: "part-1",
          time: { start: Date.now(), end: Date.now() },
        },
        {
          type: "reasoning",
          text: "Reasoning text",
          id: "part-2",
          time: { start: Date.now(), end: Date.now() },
        },
      ],
    }

    expect(isAssistantMessage(message)).toBe(true)
  })

  it("should handle assistant message with minimal fields", () => {
    const message = {
      info: {
        role: "assistant",
      },
    }

    expect(isAssistantMessage(message)).toBe(true)
  })

  it("should handle assistant message with unknown fields", () => {
    const message = {
      info: {
        role: "assistant",
        customField: "custom value",
        nestedCustom: { deep: "value" },
      },
      parts: [
        {
          type: "text",
          text: "Hello",
          customPartField: 123,
        },
      ],
      unknownTopLevel: "field",
    }

    expect(isAssistantMessage(message)).toBe(true)
  })
})
