import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import {
  beginPromptStageTrace,
  clearPromptStageTrace,
  createPromptStageRecord,
  getPromptStageTrace,
  promptStageTracePath,
  serializePromptStageRecord,
  summarizePromptStageTrace,
  updatePromptStageTrace,
} from "../../src/cli/cmd/tui/util/prompt-stage-trace"

describe("prompt stage trace", () => {
  afterEach(() => {
    clearPromptStageTrace("sess_1")
  })

  test("builds the per-instance trace path under state", () => {
    expect(promptStageTracePath("C:\\state")).toBe("C:\\state\\tui\\prompt-stage-timing.jsonl")
  })

  test("serializes stage records with elapsed timing", () => {
    const item = createPromptStageRecord({
      stage: "assistant.completed",
      sessionID: "sess_1" as any,
      messageID: "msg_1" as any,
      assistantMessageID: "msg_2",
      submittedAt: 100,
      at: 190,
      data: {
        refreshDurationMS: 42,
      },
    })

    expect(item.stage).toBe("assistant.completed")
    expect(item.sessionID).toBe("sess_1")
    expect(item.messageID).toBe("msg_1")
    expect(item.assistantMessageID).toBe("msg_2")
    expect(item.elapsedMS).toBe(90)
    // @ts-ignore
    expect(item.refreshDurationMS).toBe(42)
    expect(JSON.parse(serializePromptStageRecord({
      stage: "assistant.completed",
      sessionID: "sess_1" as any,
      messageID: "msg_1" as any,
      submittedAt: 100,
      at: 190,
    })).elapsedMS).toBe(90)
  })

  test("tracks live prompt stages in memory for sync correlation", () => {
    beginPromptStageTrace({
      sessionID: "sess_1" as any,
      messageID: "msg_1" as any,
      submittedAt: 100,
    })

    expect(getPromptStageTrace("sess_1")).toEqual({
      sessionID: "sess_1" as any,
      messageID: "msg_1" as any,
      submittedAt: 100,
    })

    updatePromptStageTrace("sess_1", {
      assistantMessageID: "msg_2",
      firstPartAt: 150,
      firstVisibleAt: 155,
    })

    expect(getPromptStageTrace("sess_1")).toEqual({
      sessionID: "sess_1" as any,
      messageID: "msg_1" as any,
      submittedAt: 100,
      assistantMessageID: "msg_2",
      firstPartAt: 150,
      firstVisibleAt: 155,
    })
  })

  test("summarizes per-turn latency breakdowns from tracked timestamps", () => {
    expect(
      summarizePromptStageTrace({
        sessionID: "sess_1" as any,
        messageID: "msg_1" as any,
        submittedAt: 100,
        dispatchAckAt: 140,
        assistantMessageID: "msg_2",
        firstPartAt: 180,
        firstVisibleAt: 215,
        completedAt: 460,
      }),
    ).toEqual({
      dispatchAckMS: 40,
      assistantMessageVisibleMS: 40,
      firstPartMS: 80,
      firstVisiblePartMS: 115,
      completedMS: 360,
      dispatchToFirstPartMS: 40,
      dispatchToFirstVisibleMS: 75,
      firstPartToFirstVisibleMS: 35,
      firstVisibleToCompletedMS: 245,
      dispatchToCompletedMS: 320,
    })
  })

  test("prompt component emits the turn summary into debug logs on completion", () => {
    const root = join(__dirname, "..", "..")
    const source = readFileSync(join(root, "src/cli/cmd/tui/component/prompt/index.tsx"), "utf-8")
    expect(source).toContain('stage: "assistant.first_part"')
    expect(source).toContain('stage: "assistant.turn_summary"')
    expect(source).toContain("...summary")
    expect(source).toContain("promptTimingLog.info(\"prompt timing\"")
  })

  test("sync emits a cache-level first assistant part timing marker", () => {
    const root = join(__dirname, "..", "..")
    const source = readFileSync(join(root, "src/cli/cmd/tui/context/sync.tsx"), "utf-8")
    expect(source).toContain('stage: "sync.assistant.first_part"')
    expect(source).toContain("submitToFirstSourcePartMS")
    expect(source).toContain("markFirstAssistantPartAtSource")
  })

  test("processor emits first part timing markers before sync receives parts", () => {
    const root = join(__dirname, "..", "..")
    const source = readFileSync(join(root, "src/session/processor.ts"), "utf-8")
    expect(source).toContain('stage: "processor.first_step_event"')
    expect(source).toContain('stage: "processor.first_part_event"')
    expect(source).toContain('stage: "processor.first_part_content"')
    expect(source).toContain("submitToStageMS")
    expect(source).toContain("markFirstPartTiming")
  })

  test("processor logs raw pre-part stream events for stalled turns", () => {
    const root = join(__dirname, "..", "..")
    const source = readFileSync(join(root, "src/session/processor.ts"), "utf-8")
    expect(source).toContain("firstEventType: value.type")
    expect(source).toContain("prePartEvents")
    expect(source).toContain("rememberPrePartEvent")
  })

  test("llm emits streamText timing markers into prompt timing logs", () => {
    const root = join(__dirname, "..", "..")
    const source = readFileSync(join(root, "src/session/llm.ts"), "utf-8")
    expect(source).toContain('stage: "llm.pre_request_summary"')
    expect(source).toContain('stage: "llm.streamText.call"')
    expect(source).toContain('stage: "llm.streamText.returned"')
    expect(source).toContain('stage: "llm.streamText.first_chunk"')
    expect(source).toContain("streamTextFirstChunkMS")
    expect(source).toContain("systemLength")
    expect(source).toContain("enableThinking")
    expect(source).toContain('"x-opencode-trace-session": input.sessionID')
    expect(source).toContain('"x-opencode-trace-request": input.user.id')
  })

  test("openai-compatible chat adapter emits first delta timing markers", () => {
    const root = join(__dirname, "..", "..")
    const source = readFileSync(
      join(root, "src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts"),
      "utf-8",
    )
    expect(source).toContain('"provider.first_delta_chunk"')
    expect(source).toContain('"provider.first_reasoning_delta"')
    expect(source).toContain('"provider.first_text_delta"')
    expect(source).toContain('"provider.first_tool_call_delta"')
    expect(source).toContain("preDeltaChunks")
    expect(source).toContain("x-opencode-trace-session")
  })

  test("openai responses adapter emits first delta timing markers", () => {
    const root = join(__dirname, "..", "..")
    const source = readFileSync(join(root, "src/provider/sdk/copilot/responses/openai-responses-language-model.ts"), "utf-8")
    expect(source).toContain('"provider.responses.first_delta_chunk"')
    expect(source).toContain('"provider.responses.first_reasoning_delta"')
    expect(source).toContain('"provider.responses.first_text_delta"')
    expect(source).toContain('"provider.responses.first_tool_call_delta"')
    expect(source).toContain("preDeltaChunks")
    expect(source).toContain("x-opencode-trace-session")
  })
})
