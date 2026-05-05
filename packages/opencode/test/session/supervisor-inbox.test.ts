import { describe, expect, test } from "bun:test"

// Copy of the function from sync.tsx for isolated testing
// This avoids pulling in JSX dependencies
function upsertSupervisorInboxItem<T extends { taskID: string; time: number }>(
  items: T[],
  update: T,
  maxItems = 50,
) {
  const next = [...items]
  const existingIndex = next.findIndex(i => i.taskID === update.taskID)
  if (existingIndex >= 0) {
    next[existingIndex] = { ...next[existingIndex], ...update }
  } else {
    // Binary search for insertion point by taskID
    let lo = 0
    let hi = next.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (next[mid].taskID < update.taskID) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    next.splice(lo, 0, update)
  }
  if (next.length <= maxItems) return next

  // Remove the item with the smallest taskID to preserve binary search order
  next.shift()
  return next
}

interface TestInboxItem {
  taskID: string
  title: string
  status: string
  time: number
  eventKind: string
  supervisorSessionID: string
}

function makeItem(taskID: string, time: number): TestInboxItem {
  return {
    taskID,
    title: `Task ${taskID}`,
    status: "running",
    time,
    eventKind: "heartbeat",
    supervisorSessionID: "sup-1",
  }
}

describe("upsertSupervisorInboxItem", () => {
  test("inserts new item in sorted order by taskID", () => {
    const items = [makeItem("a", 100), makeItem("c", 300)]
    const result = upsertSupervisorInboxItem(items, makeItem("b", 200))
    
    expect(result.map(i => i.taskID)).toEqual(["a", "b", "c"])
  })

  test("updates existing item by taskID", () => {
    const items = [makeItem("a", 100), makeItem("b", 200)]
    const update = makeItem("b", 250)
    const result = upsertSupervisorInboxItem(items, update)
    
    expect(result.map(i => i.taskID)).toEqual(["a", "b"])
    expect(result.find(i => i.taskID === "b")?.time).toBe(250)
  })

  test("evicts item with smallest taskID when max exceeded", () => {
    const items = [
      makeItem("a", 100),
      makeItem("b", 200),
      makeItem("c", 300),
    ]
    
    const result = upsertSupervisorInboxItem(items, makeItem("d", 400), 3)
    
    expect(result).toHaveLength(3)
    expect(result.map(i => i.taskID)).toEqual(["b", "c", "d"])
    
    // Verify sorted order
    for (let i = 1; i < result.length; i++) {
      expect(result[i].taskID > result[i - 1].taskID).toBe(true)
    }
  })

  test("eviction preserves binary search order after multiple inserts", () => {
    let items: TestInboxItem[] = []
    
    for (const id of ["e", "a", "c", "b", "d"]) {
      items = upsertSupervisorInboxItem(items, makeItem(id, Date.now()), 3)
    }
    
    expect(items).toHaveLength(3)
    expect(items.map(i => i.taskID)).toEqual(["c", "d", "e"])
    
    for (let i = 1; i < items.length; i++) {
      expect(items[i].taskID > items[i - 1].taskID).toBe(true)
    }
  })

  test("eviction removes smallest taskID, preserving sorted order", () => {
    const items = [
      makeItem("x", 777),
      makeItem("y", 888),
      makeItem("z", 999),
    ]
    
    const result = upsertSupervisorInboxItem(items, makeItem("w", 100), 3)
    
    expect(result).toHaveLength(3)
    // "w" inserted -> ["w", "x", "y", "z"], then smallest ("w") removed
    expect(result.map(i => i.taskID)).toEqual(["x", "y", "z"])
    
    // Verify sorted order
    for (let i = 1; i < result.length; i++) {
      expect(result[i].taskID > result[i - 1].taskID).toBe(true)
    }
  })
})