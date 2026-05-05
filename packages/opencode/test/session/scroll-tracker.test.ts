import { describe, expect, test } from "bun:test"

interface ScrollChild {
  id: string
  y: number
  height: number
}

interface Message {
  id: string
  role: string
}

function getVisibleMessageIDs(
  children: ScrollChild[],
  scrollTop: number,
  viewportHeight: number,
  messages: Message[],
  bufferRows = 5,
): Set<string> {
  const messageIDs = new Set(messages.map(m => m.id))
  const visibleStart = Math.max(0, scrollTop - bufferRows)
  const visibleEnd = scrollTop + viewportHeight + bufferRows
  
  const visible = new Set<string>()
  for (const child of children) {
    if (!messageIDs.has(child.id)) continue
    const childBottom = child.y + child.height
    if (childBottom > visibleStart && child.y < visibleEnd) {
      visible.add(child.id)
    }
  }
  return visible
}

describe("scroll tracker visible window", () => {
  test("calculates visible messages correctly", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      id: `msg-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
    }))
    
    const children: ScrollChild[] = messages.map((m, i) => ({
      id: m.id,
      y: i * 3,
      height: 3,
    }))
    
    const visible = getVisibleMessageIDs(children, 15, 10, messages, 2)
    
    expect(visible.has("msg-4")).toBe(true)
    expect(visible.has("msg-5")).toBe(true)
    expect(visible.has("msg-8")).toBe(true)
    expect(visible.has("msg-9")).toBe(false)
  })

  test("handles empty children list", () => {
    const visible = getVisibleMessageIDs([], 0, 10, [], 5)
    expect(visible.size).toBe(0)
  })

  test("handles scroll at top", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `msg-${i}`,
      role: "user",
    }))
    const children: ScrollChild[] = messages.map((m, i) => ({
      id: m.id,
      y: i * 3,
      height: 3,
    }))
    
    const visible = getVisibleMessageIDs(children, 0, 10, messages, 2)
    
    expect(visible.has("msg-0")).toBe(true)
    expect(visible.has("msg-1")).toBe(true)
    expect(visible.has("msg-2")).toBe(true)
    expect(visible.has("msg-3")).toBe(true)
    expect(visible.has("msg-4")).toBe(false)
  })

  test("handles scroll at bottom", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `msg-${i}`,
      role: "user",
    }))
    const children: ScrollChild[] = messages.map((m, i) => ({
      id: m.id,
      y: i * 3,
      height: 3,
    }))
    
    const visible = getVisibleMessageIDs(children, 20, 10, messages, 2)
    
    expect(visible.has("msg-5")).toBe(false)
    expect(visible.has("msg-6")).toBe(true)
    expect(visible.has("msg-7")).toBe(true)
    expect(visible.has("msg-8")).toBe(true)
    expect(visible.has("msg-9")).toBe(true)
  })

  test("filters out non-message children", () => {
    const messages = [{ id: "msg-0", role: "user" }]
    const children: ScrollChild[] = [
      { id: "msg-0", y: 0, height: 3 },
      { id: "header", y: 0, height: 1 },
      { id: "footer", y: 10, height: 1 },
    ]
    
    const visible = getVisibleMessageIDs(children, 0, 10, messages, 2)
    expect(visible.size).toBe(1)
    expect(visible.has("msg-0")).toBe(true)
  })

  test("handles variable message heights", () => {
    const messages = [
      { id: "msg-0", role: "user" },
      { id: "msg-1", role: "assistant" },
      { id: "msg-2", role: "assistant" },
      { id: "msg-3", role: "user" },
    ]
    const children: ScrollChild[] = [
      { id: "msg-0", y: 0, height: 2 },
      { id: "msg-1", y: 2, height: 15 },
      { id: "msg-2", y: 17, height: 3 },
      { id: "msg-3", y: 20, height: 2 },
    ]
    
    // visibleStart=3, visibleEnd=17
    // msg-0: y=0, bottom=2. bottom(2)>3 ✗ -> NOT visible
    // msg-1: y=2, bottom=17. bottom(17)>3 ✓, y(2)<17 ✓ -> visible
    // msg-2: y=17, bottom=20. bottom(20)>3 ✓, y(17)<17 ✗ -> NOT visible
    // msg-3: y=20, bottom=22. y(20)<17 ✗ -> NOT visible
    const visible = getVisibleMessageIDs(children, 5, 10, messages, 2)
    
    expect(visible.has("msg-0")).toBe(false)
    expect(visible.has("msg-1")).toBe(true)
    expect(visible.has("msg-2")).toBe(false)
    expect(visible.has("msg-3")).toBe(false)
  })

  test("handles zero buffer", () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({
      id: `msg-${i}`,
      role: "user",
    }))
    const children: ScrollChild[] = messages.map((m, i) => ({
      id: m.id,
      y: i * 3,
      height: 3,
    }))
    
    const visible = getVisibleMessageIDs(children, 3, 6, messages, 0)
    
    expect(visible.has("msg-0")).toBe(false)
    expect(visible.has("msg-1")).toBe(true)
    expect(visible.has("msg-2")).toBe(true)
    expect(visible.has("msg-3")).toBe(false)
  })

  test("handles overlapping children (same y position)", () => {
    const messages = [
      { id: "msg-0", role: "user" },
      { id: "msg-1", role: "assistant" },
    ]
    const children: ScrollChild[] = [
      { id: "msg-0", y: 0, height: 3 },
      { id: "msg-1", y: 0, height: 3 },
    ]
    
    const visible = getVisibleMessageIDs(children, 0, 10, messages, 2)
    
    expect(visible.has("msg-0")).toBe(true)
    expect(visible.has("msg-1")).toBe(true)
  })

  test("handles large scroll offset", () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      id: `msg-${i}`,
      role: "user",
    }))
    const children: ScrollChild[] = messages.map((m, i) => ({
      id: m.id,
      y: i * 3,
      height: 3,
    }))
    
    // visibleStart=245, visibleEnd=265
    // msg-81: y=243, bottom=246. bottom(246)>245 ✓, y(243)<265 ✓ -> visible
    // msg-88: y=264, bottom=267. bottom(267)>245 ✓, y(264)<265 ✓ -> visible
    // msg-89: y=267. y(267)<265 ✗ -> NOT visible
    const visible = getVisibleMessageIDs(children, 250, 10, messages, 5)
    
    expect(visible.size).toBe(8)
    expect(visible.has("msg-81")).toBe(true)
    expect(visible.has("msg-88")).toBe(true)
    expect(visible.has("msg-89")).toBe(false)
  })

  test("performance with 500 messages", () => {
    const messages = Array.from({ length: 500 }, (_, i) => ({
      id: `msg-${i}`,
      role: "user",
    }))
    const children: ScrollChild[] = messages.map((m, i) => ({
      id: m.id,
      y: i * 3,
      height: 3,
    }))
    
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      getVisibleMessageIDs(children, i * 10, 20, messages, 5)
    }
    const elapsed = performance.now() - start
    
    expect(elapsed).toBeLessThan(1000)
  })
})
