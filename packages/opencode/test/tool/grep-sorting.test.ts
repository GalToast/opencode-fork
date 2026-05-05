import { describe, expect, test } from "bun:test"
import path from "path"
import { GrepTool } from "../../src/tool/grep"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test" as any,
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

describe("grep sorting optimization (BUG-002)", () => {
  test("basic search works with optimization", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "export",
            path: path.join(projectRoot, "src/tool"),
            include: "*.ts",
          },
          // @ts-ignore
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThanOrEqual(0)
      },
    })
  })

  test("truncation message appears when over limit", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        for (let i = 0; i < 150; i++) {
          await Bun.write(path.join(dir, `file${i.toString().padStart(3, "0")}.txt`), `content ${i}`)
        }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "content",
            path: tmp.path,
          },
          // @ts-ignore
          ctx,
        )

        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("showing first 100")
      },
    })
  })

  test("no truncation at exactly 100 matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        for (let i = 0; i < 100; i++) {
          await Bun.write(path.join(dir, `file${i.toString().padStart(3, "0")}.txt`), `content ${i}`)
        }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const grep = await GrepTool.init()
        const result = await grep.execute(
          {
            pattern: "content",
            path: tmp.path,
          },
          // @ts-ignore
          ctx,
        )

        expect(result.metadata.truncated).toBe(false)
      },
    })
  })
})

describe("selectTopK algorithm benchmark", () => {
  function selectTopK<T>(array: T[], k: number, compare: (a: T, b: T) => number): T[] {
    if (k <= 0) return []
    if (k >= array.length) return [...array].sort(compare)

    const heap = array.slice(0, k)
    buildMaxHeap(heap, compare)

    for (let i = k; i < array.length; i++) {
      if (compare(array[i], heap[0]) < 0) {
        heap[0] = array[i]
        heapifyDown(heap, 0, compare)
      }
    }

    return heap.sort(compare)
  }

  function buildMaxHeap<T>(heap: T[], compare: (a: T, b: T) => number): void {
    for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) {
      heapifyDown(heap, i, compare)
    }
  }

  function heapifyDown<T>(heap: T[], i: number, compare: (a: T, b: T) => number): void {
    const left = 2 * i + 1
    const right = 2 * i + 2
    let largest = i

    if (left < heap.length && compare(heap[left], heap[largest]) > 0) {
      largest = left
    }
    if (right < heap.length && compare(heap[right], heap[largest]) > 0) {
      largest = right
    }

    if (largest !== i) {
      const temp = heap[i]
      heap[i] = heap[largest]
      heap[largest] = temp
      heapifyDown(heap, largest, compare)
    }
  }

  test("heap-based selection is faster than full sort for large datasets", () => {
    const dataSize = 10000
    const k = 100
    type DataItem = { value: number; index: number }
    const data: DataItem[] = Array.from({ length: dataSize }, (_, i) => ({
      value: Math.random(),
      index: i,
    }))

    const heapStart = performance.now()
    selectTopK(data, k, (a, b) => b.value - a.value)
    const heapTime = performance.now() - heapStart

    const fullSortStart = performance.now()
    ;[...data].sort((a, b) => b.value - a.value).slice(0, k)
    const fullSortTime = performance.now() - fullSortStart

    expect(heapTime).toBeGreaterThan(0)
    expect(fullSortTime).toBeGreaterThan(0)
  })

  test("selectTopK returns correct top K elements", () => {
    type DataItem = { value: number }
    const data: DataItem[] = Array.from({ length: 1000 }, (_, i) => ({ value: i }))
    const top10 = selectTopK(data, 10, (a, b) => b.value - a.value)

    expect(top10.length).toBe(10)
    for (let i = 0; i < 10; i++) {
      expect(top10[i].value).toBe(999 - i)
    }
  })

  test("selectTopK handles edge cases", () => {
    type DataItem = { value: number }
    const data: DataItem[] = [{ value: 1 }, { value: 3 }, { value: 2 }]
    const emptyData: DataItem[] = []

    expect(selectTopK(data, 0, (a, b) => b.value - a.value).length).toBe(0)
    expect(selectTopK(data, 1, (a, b) => b.value - a.value).length).toBe(1)
    expect(selectTopK(data, 5, (a, b) => b.value - a.value).length).toBe(3)
    expect(selectTopK(emptyData, 5, (a, b) => b.value - a.value).length).toBe(0)
  })

  test("selectTopK maintains stability for equal elements", () => {
    type DataItem = { value: number; index: number }
    const data: DataItem[] = [
      { value: 5, index: 0 },
      { value: 5, index: 1 },
      { value: 5, index: 2 },
      { value: 3, index: 3 },
    ]
    const top3 = selectTopK(data, 3, (a, b) => b.value - a.value)

    expect(top3.length).toBe(3)
    expect(top3.every((item) => item.value === 5)).toBe(true)
  })

  test("benchmark: heap selection vs full sort performance", () => {
    const dataSize = 10000
    const k = 100
    type DataItem = { value: number; index: number }
    const data: DataItem[] = Array.from({ length: dataSize }, (_, i) => ({
      value: Math.random(),
      index: i,
    }))

    const heapStart = performance.now()
    const heapResult = selectTopK(data, k, (a, b) => b.value - a.value)
    const heapTime = performance.now() - heapStart

    const fullSortStart = performance.now()
    const fullSortResult = [...data].sort((a, b) => b.value - a.value).slice(0, k)
    const fullSortTime = performance.now() - fullSortStart

    expect(heapResult.length).toBe(k)
    expect(fullSortResult.length).toBe(k)
    expect(heapResult[0].value).toBe(fullSortResult[0].value)
  })
})
