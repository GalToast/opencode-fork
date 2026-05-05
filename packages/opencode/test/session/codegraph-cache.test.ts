import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { CodeGraph } from "../../src/graph/code-graph"
import { SQLiteKV } from "../../src/mecha/sqlite-kv"

const projectRoot = path.join(__dirname, "../..")

describe("codegraph cache size", () => {
  test("codegraph uses increased cache sizes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await CodeGraph.init()
        
        const source = await Bun.file(path.join(projectRoot, "src/graph/code-graph.ts")).text()
        
        const symbolsMatch = source.match(/maxCacheSize:\s*(\d+)/g)
        expect(symbolsMatch).not.toBeNull()
        
        const sizes = symbolsMatch!.map(m => parseInt(m.match(/\d+/)![0]))
        
        expect(sizes[0]).toBeGreaterThanOrEqual(10000)
        expect(sizes[1]).toBeGreaterThanOrEqual(5000)
        expect(sizes[2]).toBeGreaterThanOrEqual(2000)
      },
    })
  })

  test("LRU cache evicts oldest entries when limit is exceeded", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const kv = new SQLiteKV<{ n: number }>("test.lru.eviction", { maxCacheSize: 5 })
        
        for (let i = 0; i < 10; i++) {
          kv.set(`key-${i}`, { n: i })
          await new Promise(r => setTimeout(r, 2))
        }
        
        // @ts-ignore
        expect(kv.cache.size).toBeLessThanOrEqual(5)
        
        // @ts-ignore
        const cachedKeys = [...kv.cache.keys()]
        expect(cachedKeys).toContain("key-9")
        expect(cachedKeys).toContain("key-8")
        expect(cachedKeys).toContain("key-7")
        expect(cachedKeys).toContain("key-6")
        expect(cachedKeys).toContain("key-5")
        expect(cachedKeys).not.toContain("key-0")
        expect(cachedKeys).not.toContain("key-1")
        expect(cachedKeys).not.toContain("key-2")
        expect(cachedKeys).not.toContain("key-3")
        expect(cachedKeys).not.toContain("key-4")
        
        kv.clear()
      },
    })
  })

  test("LRU cache keeps recently accessed entries", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const kv = new SQLiteKV<{ n: number }>("test.lru.access", { maxCacheSize: 3 })
        
        kv.set("a", { n: 1 })
        await new Promise(r => setTimeout(r, 2))
        kv.set("b", { n: 2 })
        await new Promise(r => setTimeout(r, 2))
        kv.set("c", { n: 3 })
        await new Promise(r => setTimeout(r, 2))
        
        kv.get("a")
        await new Promise(r => setTimeout(r, 2))
        
        kv.set("d", { n: 4 })
        
        // @ts-ignore
        const cachedKeys = [...kv.cache.keys()]
        expect(cachedKeys).toContain("a")
        expect(cachedKeys).toContain("c")
        expect(cachedKeys).toContain("d")
        expect(cachedKeys).not.toContain("b")
        
        kv.clear()
      },
    })
  })
})