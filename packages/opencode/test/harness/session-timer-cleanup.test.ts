import { describe, test, expect, mock } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

describe("runReadOnlyHarnessSession timer cleanup", () => {
  test("clearAllTimers is defined in session.ts", () => {
    const sessionPath = join(__dirname, "../../src/harness/session.ts")
    const content = readFileSync(sessionPath, "utf-8")
    
    expect(content).toContain("const clearAllTimers = ()")
    expect(content).toContain("clearTimeout(timeoutHandle)")
    expect(content).toContain("clearTimeout(stallHandle)")
    expect(content).toContain("clearTimeout(completionHandle)")
  })

  test("clearAllTimers is called in finally block", () => {
    const sessionPath = join(__dirname, "../../src/harness/session.ts")
    const content = readFileSync(sessionPath, "utf-8")
    
    const lines = content.split("\n")
    let inFinallyBlock = false
    let foundClearAllTimers = false
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      
      if (line.includes("} catch (error) {")) {
        continue
      }
      
      if (line.includes("} finally {")) {
        inFinallyBlock = true
        continue
      }
      
      if (inFinallyBlock && line === "}") {
        inFinallyBlock = false
        continue
      }
      
      if (inFinallyBlock && line.includes("clearAllTimers()")) {
        foundClearAllTimers = true
        break
      }
    }
    
    expect(foundClearAllTimers).toBe(true)
  })

  test("clearAllTimers is NOT only in catch blocks", () => {
    const sessionPath = join(__dirname, "../../src/harness/session.ts")
    const content = readFileSync(sessionPath, "utf-8")
    
    const lines = content.split("\n")
    let onlyInCatch = true
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      
      if (line.includes("clearAllTimers()")) {
        const prevLines = lines.slice(Math.max(0, i - 5), i)
        const isInCatch = prevLines.some(l => l.includes("} catch"))
        const isInFinally = prevLines.some(l => l.includes("} finally"))
        
        if (!isInCatch || isInFinally) {
          onlyInCatch = false
          break
        }
      }
    }
    
    expect(onlyInCatch).toBe(false)
  })

  test("main try block wraps all error-prone code", () => {
    const sessionPath = join(__dirname, "../../src/harness/session.ts")
    const content = readFileSync(sessionPath, "utf-8")
    
    const lines = content.split("\n")
    
    let mainTryLine = -1
    let mainCatchLine = -1
    let mainFinallyLine = -1
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      
      if (line.trim() === "try {" && lines[i + 1]?.includes("const providers = await withTimeout")) {
        mainTryLine = i
      }
      
      if (line.trim() === "} catch (error) {" && i > 1500) {
        mainCatchLine = i
      }
      
      if (line.trim() === "} finally {" && i > 1500) {
        mainFinallyLine = i
      }
    }
    
    expect(mainTryLine).toBeGreaterThan(0)
    expect(mainCatchLine).toBeGreaterThan(mainTryLine)
    expect(mainFinallyLine).toBeGreaterThan(mainCatchLine)
  })

  test("all throw statements are within try block that has finally", () => {
    const sessionPath = join(__dirname, "../../src/harness/session.ts")
    const content = readFileSync(sessionPath, "utf-8")
    
    const lines = content.split("\n")
    
    const throwLines: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("throw ") && !lines[i].trim().startsWith("//")) {
        throwLines.push(i)
      }
    }
    
    expect(throwLines.length).toBeGreaterThan(0)
    
    const mainFinallyLine = lines.findIndex((line, i) => 
      i > 1500 && line.trim() === "} finally {"
    )
    
    expect(mainFinallyLine).toBeGreaterThan(0)
    
    for (const throwLine of throwLines) {
      if (throwLine < 900 || throwLine > 1600) continue
      
      expect(throwLine).toBeLessThan(mainFinallyLine)
    }
  })

  test("Chrome instance cleanup is in finally block", () => {
    const sessionPath = join(__dirname, "../../src/harness/session.ts")
    const content = readFileSync(sessionPath, "utf-8")
    
    const lines = content.split("\n")
    let finallyStartLine = -1
    let finallyEndLine = -1
    let braceCount = 0
    let inFinally = false
    let foundChromeCleanup = false
    let foundEnvCleanup = false
    
    for (let i = 0; i < lines.length; i++) {
      const trimmedLine = lines[i].trim()
      
      if (trimmedLine === "} finally {" && i > 1500) {
        finallyStartLine = i
        inFinally = true
        braceCount = 1
        continue
      }
      
      if (inFinally) {
        if (trimmedLine.includes("{")) braceCount++
        if (trimmedLine.includes("}")) braceCount--
        
        if (braceCount === 0) {
          finallyEndLine = i
          inFinally = false
        }
        
        if (trimmedLine.includes("chromePool.release")) {
          foundChromeCleanup = true
        }
        if (trimmedLine.includes("delete process.env.OPENCODE_CHROME_DEVTOOLS_URL")) {
          foundEnvCleanup = true
        }
      }
    }
    
    expect(finallyStartLine).toBeGreaterThan(1500)
    expect(foundChromeCleanup).toBe(true)
    expect(foundEnvCleanup).toBe(true)
  })
})
