import { describe, expect, test } from "bun:test"

function summarizeBackgroundToolPartForCache(part: { type: string; state: { status: string; output?: string; error?: string } }): { type: string; text: string; synthetic: boolean; metadata: { backgroundToolCache: boolean; originalPartCount: number } } {
  let text = `[Background tool activity summarized]`
  if (part.state.status === "completed" && part.state.output?.trim()) {
    text += ` ${part.state.output.trim().substring(0, 220)}`
  } else if (part.state.status === "error" && part.state.error?.trim()) {
    text += ` Tool error: ${part.state.error.trim()}`
  } else {
    text += ` Latest tool state: ${part.state.status}.`
  }
  return { type: "text", text, synthetic: true, metadata: { backgroundToolCache: true, originalPartCount: 1 } }
}

function compactForegroundToolParts(parts: { type: string; state: { status: string; output?: string } }[], retainLatest = 3) {
  const toolParts: { index: number; part: typeof parts[0] }[] = []
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]?.type === "tool") toolParts.push({ index: i, part: parts[i] })
  }
  const olderTools = toolParts.slice(0, -retainLatest)
  if (olderTools.length === 0) return parts

  const next = [...parts]
  for (const { index, part } of olderTools) {
    // @ts-ignore
    next[index] = summarizeBackgroundToolPartForCache(part)
  }
  return next
}

function makeTool(status: string, output: string) {
  return { type: "tool", state: { status, output } }
}

function makeText(text: string) {
  return { type: "text", text }
}

describe("compactForegroundToolParts", () => {
  test("does nothing when under retain limit", () => {
    const parts = [
      makeText("Hello"),
      makeTool("completed", "output 1"),
      makeTool("completed", "output 2"),
      makeTool("completed", "output 3"),
    ]
    // @ts-ignore
    const result = compactForegroundToolParts(parts, 3)
    expect(result).toHaveLength(4)
    expect(result.filter(p => p.type === "tool")).toHaveLength(3)
    // @ts-ignore
    expect(result.filter(p => p.type === "text" && p.synthetic)).toHaveLength(0)
  })

  test("compacts older tools when over retain limit", () => {
    const parts = [
      makeText("Hello"),
      makeTool("completed", "output 1"),
      makeTool("completed", "output 2"),
      makeTool("completed", "output 3"),
      makeTool("completed", "output 4"),
      makeTool("completed", "output 5"),
    ]
    // @ts-ignore
    const result = compactForegroundToolParts(parts, 3)
    expect(result).toHaveLength(6)

    // First 2 tools should be compacted (indices 1, 2)
    expect(result[1].type).toBe("text")
    // @ts-ignore
    expect(result[1].synthetic).toBe(true)
    expect(result[2].type).toBe("text")
    // @ts-ignore
    expect(result[2].synthetic).toBe(true)

    // Last 3 tools should be full size
    expect(result[3].type).toBe("tool")
    expect(result[4].type).toBe("tool")
    expect(result[5].type).toBe("tool")
  })

  test("keeps running tools at full size", () => {
    const parts = [
      makeTool("completed", "output 1"),
      makeTool("completed", "output 2"),
      makeTool("completed", "output 3"),
      makeTool("running", ""),
    ]
    const result = compactForegroundToolParts(parts, 3)
    expect(result).toHaveLength(4)
    // All 3 completed + 1 running = 4 tools, retainLatest=3
    // 1 tool should be compacted
    expect(result[0].type).toBe("text") // compacted
    // @ts-ignore
    expect(result[0].synthetic).toBe(true)
    expect(result[1].type).toBe("tool") // retained
    expect(result[2].type).toBe("tool") // retained
    expect(result[3].type).toBe("tool") // retained (running)
  })

  test("does nothing when no tool parts", () => {
    const parts = [
      makeText("Hello"),
      makeText("World"),
    ]
    // @ts-ignore
    const result = compactForegroundToolParts(parts, 3)
    expect(result).toHaveLength(2)
  })

  test("compaction includes output summary", () => {
    const parts = [
      makeTool("completed", "line 1\nline 2\nline 3"),
      makeTool("completed", "line 4\nline 5"),
      makeTool("completed", "line 6"),
      makeTool("completed", "line 7"),
      makeTool("completed", "line 8"),
    ]
    const result = compactForegroundToolParts(parts, 3)
    expect(result[0].type).toBe("text")
    // @ts-ignore
    expect(result[0].text).toContain("Background tool activity summarized")
    // @ts-ignore
    expect(result[0].text).toContain("line 1")
    expect(result[3].type).toBe("tool")
    expect(result[3].state.output).toBe("line 7")
    expect(result[4].type).toBe("tool")
    expect(result[4].state.output).toBe("line 8")
  })
})
