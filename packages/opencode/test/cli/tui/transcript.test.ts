import { describe, expect, test } from "bun:test"
import {
  deriveTurnCeremony,
  deriveCeremonyRoleLabel,
  deriveTurnBoundary,
  formatAssistantHeader,
  deriveTurnSurface,
  formatMessage,
  formatPart,
  formatTranscript,
} from "../../../src/cli/cmd/tui/util/transcript"
import type { AssistantMessage, Part, Provider, UserMessage } from "@opencode-ai/sdk/v2"

const providers: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    source: "api",
    env: [],
    options: {},
    models: {
      "claude-sonnet-4-20250514": {
        id: "claude-sonnet-4-20250514",
        providerID: "anthropic" as any,
        api: {
          id: "claude-sonnet-4-20250514",
          url: "https://example.com/claude-sonnet-4-20250514",
          npm: "@ai-sdk/anthropic",
        },
        name: "Claude Sonnet 4",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: {
            text: true,
            audio: false,
            image: true,
            video: false,
            pdf: true,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: false,
        },
        cost: {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: 200_000,
          output: 8_192,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2025-05-14",
      },
    },
  },
]

describe("transcript", () => {
  describe("formatAssistantHeader", () => {
    const baseMsg: AssistantMessage = {
      id: "msg_123",
      sessionID: "ses_123" as any,
      role: "assistant",
      agent: "build",
      modelID: "claude-sonnet-4-20250514" as any,
      providerID: "anthropic" as any,
      mode: "",
      parentID: "msg_parent",
      path: { cwd: "/test", root: "/test" },
      cost: 0.001,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1000000, completed: 1005400 },
    }

    test("includes metadata when enabled", () => {
      const result = formatAssistantHeader(baseMsg, true)
      expect(result).toBe("## Assistant (Build · claude-sonnet-4-20250514 · 5.4s)\n\n")
    })

    test("uses model display name when available", () => {
      const result = formatAssistantHeader(baseMsg, true, providers)
      expect(result).toBe("## Assistant (Build · Claude Sonnet 4 · 5.4s)\n\n")
    })

    test("excludes metadata when disabled", () => {
      const result = formatAssistantHeader(baseMsg, false)
      expect(result).toBe("## Assistant\n\n")
    })

    test("handles missing completed time", () => {
      const msg = { ...baseMsg, time: { created: 1000000 } }
      const result = formatAssistantHeader(msg as AssistantMessage, true)
      expect(result).toBe("## Assistant (Build · claude-sonnet-4-20250514)\n\n")
    })

    test("titlecases agent name", () => {
      const msg = { ...baseMsg, agent: "plan" }
      const result = formatAssistantHeader(msg, true)
      expect(result).toContain("Plan")
    })
  })

  describe("formatPart", () => {
    const options = { thinking: true, toolDetails: true, assistantMetadata: true }

    test("formats text part", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123" as any,
        messageID: "msg_123" as any,
        type: "text",
        text: "Hello world",
      }
      const result = formatPart(part, options)
      expect(result).toBe("Hello world\n\n")
    })

    test("skips synthetic text parts", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123" as any,
        messageID: "msg_123" as any,
        type: "text",
        text: "Synthetic content",
        synthetic: true,
      }
      const result = formatPart(part, options)
      expect(result).toBe("")
    })

    test("formats reasoning when thinking enabled", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123" as any,
        messageID: "msg_123" as any,
        type: "reasoning",
        text: "Let me think...",
        time: { start: 1000 },
      }
      const result = formatPart(part, options)
      expect(result).toBe("_Thinking:_\n\nLet me think...\n\n")
    })

    test("skips reasoning when thinking disabled", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123" as any,
        messageID: "msg_123" as any,
        type: "reasoning",
        text: "Let me think...",
        time: { start: 1000 },
      }
      const result = formatPart(part, { ...options, thinking: false })
      expect(result).toBe("")
    })

    test("formats tool part with details", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123" as any,
        messageID: "msg_123" as any,
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
          output: "file1.txt\nfile2.txt",
          title: "List files",
          metadata: {},
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, options)
      expect(result).toContain("**Tool: bash**")
      expect(result).toContain("**Input:**")
      expect(result).toContain('"command": "ls"')
      expect(result).toContain("**Output:**")
      expect(result).toContain("file1.txt")
    })

    test("formats tool output containing triple backticks without breaking markdown", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123" as any,
        messageID: "msg_123" as any,
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "echo '```hello```'" },
          output: "```hello```",
          title: "Echo backticks",
          metadata: {},
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, options)
      // The tool header should not be inside a code block
      expect(result).toStartWith("**Tool: bash**\n")
      // Input and output should each be in their own code blocks
      expect(result).toContain("**Input:**\n```json")
      expect(result).toContain("**Output:**\n```\n```hello```\n```")
    })

    test("formats tool part without details when disabled", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123" as any,
        messageID: "msg_123" as any,
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
          output: "file1.txt",
          title: "List files",
          metadata: {},
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, { ...options, toolDetails: false })
      expect(result).toContain("**Tool: bash**")
      expect(result).not.toContain("**Input:**")
      expect(result).not.toContain("**Output:**")
    })

    test("formats tool error", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123" as any,
        messageID: "msg_123" as any,
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "error",
          input: { command: "invalid" },
          error: "Command failed",
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, options)
      expect(result).toContain("**Error:**")
      expect(result).toContain("Command failed")
    })
  })

  describe("deriveCeremonyRoleLabel", () => {
    test("maps ceremony labels to shared role labels", () => {
      expect(deriveCeremonyRoleLabel("FIRST UPLINK")).toBe("uplink")
      expect(deriveCeremonyRoleLabel("FIRST CONVOY")).toBe("convoy")
      expect(deriveCeremonyRoleLabel("FIRST HANDOFF")).toBe("handoff")
      expect(deriveCeremonyRoleLabel("FIRST HOLD")).toBe("hold")
      expect(deriveCeremonyRoleLabel("FIRST FRACTURE")).toBe("fracture")
      expect(deriveCeremonyRoleLabel("FIRST RETURN")).toBe("return")
      expect(deriveCeremonyRoleLabel("FIRST SIGNAL")).toBe("signal")
      expect(deriveCeremonyRoleLabel("AFTERGLOW")).toBe("afterglow")
    })

    test("falls back to role when ceremony label is unknown", () => {
      expect(deriveCeremonyRoleLabel("QUIET", "assistant")).toBe("organism")
      expect(deriveCeremonyRoleLabel(undefined, "user")).toBe("uplink")
    })
  })

  describe("deriveTurnSurface", () => {
    const assistantBase: AssistantMessage = {
      id: "msg_assistant",
      sessionID: "ses_123",
      role: "assistant",
      agent: "build",
      modelID: "claude-sonnet-4-20250514",
      providerID: "anthropic",
      mode: "",
      parentID: "msg_parent",
      path: { cwd: "/test", root: "/test" },
      cost: 0.001,
      tokens: { input: 100, output: 50, reasoning: 5, cache: { read: 0, write: 0 } },
      time: { created: 1000000, completed: 1005400 },
    }

    const userBase: UserMessage = {
      id: "msg_user",
      sessionID: "ses_123",
      role: "user",
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      time: { created: 1000000 },
    }

    test("derives user preview from visible text parts", () => {
      const parts: Part[] = [
        {
          id: "part_user_1",
          sessionID: "ses_123",
          messageID: "msg_user",
          type: "text",
          text: "Hello   world\nwith newlines",
          synthetic: false,
          ignored: false,
        },
      ]

      const turn = deriveTurnSurface(userBase, parts, { previewLength: 20 })
      expect(turn.role).toBe("user")
      expect(turn.status).toBe("user")
      expect(turn.roleLabel).toBe("uplink")
      expect(turn.traceLabel).toBe("intent uplink")
      expect(turn.preview).toBe("Hello world with ne…")
    })

    test("derives assistant tool-only preview and tooling status", () => {
      const parts: Part[] = [
        {
          id: "part_tool_1",
          sessionID: "ses_123",
          messageID: "msg_assistant",
          type: "tool",
          callID: "tool_call_1",
          tool: "bash",
          state: { status: "running", input: {}, title: "Run command", metadata: {}, time: { start: 100 } },
        },
      ]

      const turn = deriveTurnSurface(
        {
          ...assistantBase,
          id: "msg_assistant_running",
          time: { created: 1000000 },
          finish: "tool-calls",
        },
        parts,
        { previewLength: 24 },
      )

      expect(turn.status).toBe("tooling")
      expect(turn.preview).toBe("tool bash running")
      expect(turn.statusLabel).toBe("convoy")
      expect(turn.traceLabel).toBe("bash live")
    })

    test("derives assistant truncated status and token/cost totals", () => {
      const parts: Part[] = [
        {
          id: "part_text_1",
          sessionID: "ses_123",
          messageID: "msg_assistant",
          type: "text",
          text: "A full response that got cut off",
        },
      ]

      const turn = deriveTurnSurface(
        { ...assistantBase, id: "msg_assistant_truncated", time: { created: 1000000, completed: 1000600 }, finish: "length" },
        parts,
        { previewLength: 200 },
      )

      expect(turn.status).toBe("truncated")
      expect(turn.preview).toBe("A full response that got cut off")
      expect(turn.statusLabel).toBe("overflow")
      expect(turn.traceLabel).toBe("context edge")
      expect(turn.tokens).toBe(155)
      expect(turn.cost).toBe(0.001)
    })

    test("derives assistant complete status when finished", () => {
      const turn = deriveTurnSurface(assistantBase, [], { previewLength: 40 })
      expect(turn.status).toBe("complete")
      expect(turn.preview).toBe("(thinking...)")
      expect(turn.statusLabel).toBe("sealed")
      expect(turn.traceLabel).toBe("response sealed")
    })

    test("derives boundary grammar for intent and convoy turns", () => {
      const userTurn = deriveTurnSurface(userBase, [], { previewLength: 20 })
      const userBoundary = deriveTurnBoundary(userTurn)
      expect(userBoundary.headerLabel).toBe("INTENT ARC")
      expect(userBoundary.footerLabel).toBe("intent anchored in the root")
      expect(userBoundary.dividerLabel).toBe(" Intent Fold ")

      const branchUserBoundary = deriveTurnBoundary(userTurn, { isBranchTurn: true })
      expect(branchUserBoundary.headerLabel).toBe("BRANCH ARC")
      expect(branchUserBoundary.footerLabel).toBe("intent anchored in a branch lane")
      expect(branchUserBoundary.dividerLabel).toBe(" Branch Fold ")

      const convoyTurn = deriveTurnSurface(
        {
          ...assistantBase,
          id: "msg_assistant_running_2",
          time: { created: 1000000 },
          finish: "tool-calls",
        },
        [
          {
            id: "part_tool_2",
            sessionID: "ses_123",
            messageID: "msg_assistant_running_2",
            type: "tool",
            callID: "tool_call_2",
            tool: "bash",
            state: { status: "running", input: {}, title: "Run command", metadata: {}, time: { start: 100 } },
          },
        ],
        { previewLength: 30 },
      )
      const convoyBoundary = deriveTurnBoundary(convoyTurn)
      expect(convoyBoundary.headerLabel).toBe("CONVOY ARC")
      expect(convoyBoundary.footerLabel).toContain("tool convoy")

      const branchConvoyBoundary = deriveTurnBoundary(convoyTurn, { isBranchTurn: true })
      expect(branchConvoyBoundary.headerLabel).toBe("CONVOY ARC")
      expect(branchConvoyBoundary.footerLabel).toContain("branch convoy")
      expect(branchConvoyBoundary.dividerLabel).toBe(" Branch Convoy Fold ")
    })

    test("derives opening ceremony beats for first uplink, convoy, and signal", () => {
      const userMessage = { ...userBase, id: "msg_user_first" }
      const convoyMessage = {
        ...assistantBase,
        id: "msg_assistant_convoy_first",
        parentID: "msg_user_first",
        time: { created: 1000010 },
        finish: "tool-calls" as const,
      }
      const signalMessage = {
        ...assistantBase,
        id: "msg_assistant_signal_first",
        parentID: "msg_user_first",
        time: { created: 1000020, completed: 1000400 },
      }

      const userCeremony = deriveTurnCeremony({
        message: userMessage,
        parts: [],
        messages: [userMessage],
      })
      expect(userCeremony.label).toBe("FIRST UPLINK")

      const convoyParts: Part[] = [
        {
          id: "part_tool_convoy",
          sessionID: "ses_123",
          messageID: "msg_assistant_convoy_first",
          type: "tool",
          callID: "tool_call_convoy",
          tool: "bash",
          state: { status: "running", input: {}, title: "Run command", metadata: {}, time: { start: 100 } },
        },
      ]
      const convoyCeremony = deriveTurnCeremony({
        message: convoyMessage,
        parts: convoyParts,
        messages: [userMessage, convoyMessage],
        partsByMessage: {
          [userMessage.id]: [],
          [convoyMessage.id]: convoyParts,
        },
      })
      expect(convoyCeremony.label).toBe("FIRST CONVOY")

      const signalParts: Part[] = [
        {
          id: "part_text_signal",
          sessionID: "ses_123",
          messageID: "msg_assistant_signal_first",
          type: "text",
          text: "Ready.",
        },
      ]
      const signalCeremony = deriveTurnCeremony({
        message: signalMessage,
        parts: signalParts,
        messages: [userMessage, signalMessage],
        partsByMessage: {
          [userMessage.id]: [],
          [signalMessage.id]: signalParts,
        },
      })
      expect(signalCeremony.label).toBe("FIRST SIGNAL")
      expect(signalCeremony.roleLabel).toBe("signal")
    })
  })

  describe("formatMessage", () => {
    const options = { thinking: true, toolDetails: true, assistantMetadata: true, providers }

    test("formats user message", () => {
      const msg: UserMessage = {
        id: "msg_123",
        sessionID: "ses_123" as any,
        role: "user",
        agent: "build",
        model: { providerID: "anthropic" as any, modelID: "claude-sonnet-4-20250514" as any },
        time: { created: 1000000 },
      }
      const parts: Part[] = [{ id: "p1", sessionID: "ses_123" as any, messageID: "msg_123" as any, type: "text", text: "Hello" }]
      const result = formatMessage(msg, parts, options)
      expect(result).toContain("## User")
      expect(result).toContain("Hello")
    })

    test("formats assistant message with metadata", () => {
      const msg: AssistantMessage = {
        id: "msg_123",
        sessionID: "ses_123" as any,
        role: "assistant",
        agent: "build",
        modelID: "claude-sonnet-4-20250514" as any,
        providerID: "anthropic" as any,
        mode: "",
        parentID: "msg_parent",
        path: { cwd: "/test", root: "/test" },
        cost: 0.001,
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1000000, completed: 1005400 },
      }
      const parts: Part[] = [{ id: "p1", sessionID: "ses_123" as any, messageID: "msg_123" as any, type: "text", text: "Hi there" }]
      const result = formatMessage(msg, parts, options)
      expect(result).toContain("## Assistant (Build · Claude Sonnet 4 · 5.4s)")
      expect(result).toContain("Hi there")
    })
  })

  describe("formatTranscript", () => {
    test("formats complete transcript", () => {
      const session = {
        id: "ses_abc123",
        title: "Test Session",
        time: { created: 1000000000000, updated: 1000000001000 },
      }
      const messages = [
        {
          info: {
            id: "msg_1",
            sessionID: "ses_abc123" as any,
            role: "user" as const,
            agent: "build",
            model: { providerID: "anthropic" as any, modelID: "claude-sonnet-4-20250514" as any },
            time: { created: 1000000000000 },
          },
          parts: [{ id: "p1", sessionID: "ses_abc123" as any, messageID: "msg_1" as any, type: "text" as const, text: "Hello" }],
        },
        {
          info: {
            id: "msg_2",
            sessionID: "ses_abc123" as any,
            role: "assistant" as const,
            agent: "build",
            modelID: "claude-sonnet-4-20250514" as any,
            providerID: "anthropic" as any,
            mode: "",
            parentID: "msg_1",
            path: { cwd: "/test", root: "/test" },
            cost: 0.001,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1000000000100, completed: 1000000000600 },
          },
          parts: [{ id: "p2", sessionID: "ses_abc123" as any, messageID: "msg_2" as any, type: "text" as const, text: "Hi!" }],
        },
      ]
      const options = {
        thinking: false,
        toolDetails: false,
        assistantMetadata: true,
        providers,
      }

      const result = formatTranscript(session, messages, options)

      expect(result).toContain("# Test Session")
      expect(result).toContain("**Session ID:** ses_abc123")
      expect(result).toContain("## User")
      expect(result).toContain("Hello")
      expect(result).toContain("## Assistant (Build · Claude Sonnet 4 · 0.5s)")
      expect(result).toContain("Hi!")
      expect(result).toContain("---")
    })

    test("falls back to raw model id when provider data is missing", () => {
      const session = {
        id: "ses_abc123",
        title: "Test Session",
        time: { created: 1000000000000, updated: 1000000001000 },
      }
      const messages = [
        {
          info: {
            id: "msg_1",
            sessionID: "ses_abc123" as any,
            role: "assistant" as const,
            agent: "build",
            modelID: "claude-sonnet-4-20250514" as any,
            providerID: "anthropic" as any,
            mode: "",
            parentID: "msg_0",
            path: { cwd: "/test", root: "/test" },
            cost: 0.001,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1000000000100, completed: 1000000000600 },
          },
          parts: [{ id: "p1", sessionID: "ses_abc123" as any, messageID: "msg_1" as any, type: "text" as const, text: "Response" }],
        },
      ]

      const result = formatTranscript(session, messages, {
        thinking: false,
        toolDetails: false,
        assistantMetadata: true,
      })

      expect(result).toContain("## Assistant (Build · claude-sonnet-4-20250514 · 0.5s)")
    })

    test("formats transcript without assistant metadata", () => {
      const session = {
        id: "ses_abc123",
        title: "Test Session",
        time: { created: 1000000000000, updated: 1000000001000 },
      }
      const messages = [
        {
          info: {
            id: "msg_1",
            sessionID: "ses_abc123" as any,
            role: "assistant" as const,
            agent: "build",
            modelID: "claude-sonnet-4-20250514" as any,
            providerID: "anthropic" as any,
            mode: "",
            parentID: "msg_0",
            path: { cwd: "/test", root: "/test" },
            cost: 0.001,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1000000000100, completed: 1000000000600 },
          },
          parts: [{ id: "p1", sessionID: "ses_abc123" as any, messageID: "msg_1" as any, type: "text" as const, text: "Response" }],
        },
      ]
      const options = { thinking: false, toolDetails: false, assistantMetadata: false }

      const result = formatTranscript(session, messages, options)

      expect(result).toContain("## Assistant\n\n")
      expect(result).not.toContain("Build")
      expect(result).not.toContain("claude-sonnet-4-20250514")
    })
  })
})
