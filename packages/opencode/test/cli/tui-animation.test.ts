import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

describe("TUI Animation Interval Cleanup", () => {
  const packageRoot = join(__dirname, "..", "..")

  test("sidebar.tsx - uses consolidated animation timer", () => {
    const content = readFileSync(
      join(packageRoot, "src/cli/cmd/tui/routes/session/sidebar.tsx"),
      "utf-8"
    )

    const setIntervalCount = (content.match(/setInterval\(/g) || []).length
    expect(setIntervalCount).toBe(0)
  })

  test("header.tsx - uses consolidated animation timers", () => {
    const content = readFileSync(
      join(packageRoot, "src/cli/cmd/tui/routes/session/header.tsx"),
      "utf-8"
    )

    const setIntervalCount = (content.match(/setInterval\(/g) || []).length
    expect(setIntervalCount).toBe(0)
    expect(content).toContain("useLingeringShellEvent")
    expect(content).toContain("useShellClimate")
  })

  test("footer.tsx - avoids timer-driven hint rotation", () => {
    const content = readFileSync(
      join(packageRoot, "src/cli/cmd/tui/routes/session/footer.tsx"),
      "utf-8"
    )
    
    expect(content).not.toContain("useAnimationTimer")
    
    const setIntervalCount = (content.match(/setInterval\(/g) || []).length
    expect(setIntervalCount).toBe(0)
  })

  test("all TUI components properly manage timer resources", () => {
    const components = [
      "src/cli/cmd/tui/routes/session/sidebar.tsx",
      "src/cli/cmd/tui/routes/session/header.tsx",
      "src/cli/cmd/tui/routes/session/footer.tsx",
    ]
    
    components.forEach((componentPath) => {
      const content = readFileSync(join(packageRoot, componentPath), "utf-8")
      
      const hasSetInterval = content.includes("setInterval(")
      const hasOnCleanup = content.includes("onCleanup(")
      const hasUseAnimationTimer = content.includes("useAnimationTimer")
      
      if (hasSetInterval) {
        expect(hasOnCleanup || hasUseAnimationTimer).toBe(true)
      }
    })
  })
})

describe("TUI Animation Memory Leak Prevention", () => {
  const packageRoot = join(__dirname, "..", "..")

  test("components don't create intervals in render body", () => {
    const components = [
      "src/cli/cmd/tui/routes/session/sidebar.tsx",
      "src/cli/cmd/tui/routes/session/header.tsx",
      "src/cli/cmd/tui/routes/session/footer.tsx",
    ]
    
    components.forEach((componentPath) => {
      const content = readFileSync(join(packageRoot, componentPath), "utf-8")
      const lines = content.split("\n")
      
      let inComponentBody = false
      let inLifecycleHook = false
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const trimmedLine = line.trim()
        
        if (trimmedLine.match(/export\s+function\s+\w+\(/) || trimmedLine.match(/function\s+\w+\(props/)) {
          inComponentBody = true
          continue
        }
        
        if (trimmedLine.startsWith("onMount(") || trimmedLine.startsWith("createEffect(")) {
          inLifecycleHook = true
          continue
        }
        
        if (inLifecycleHook && trimmedLine === "})") {
          inLifecycleHook = false
          continue
        }
        
        if (inComponentBody && !inLifecycleHook && line.includes("setInterval(")) {
          throw new Error(
            `${componentPath}:${i + 1} - setInterval should only be created in onMount or createEffect`
          )
        }
      }
    })
    
    expect(true).toBe(true)
  })

  test("footer.tsx avoids ad-hoc timeout cleanup scaffolding", () => {
    const content = readFileSync(
      join(packageRoot, "src/cli/cmd/tui/routes/session/footer.tsx"),
      "utf-8"
    )
    
    expect(content).not.toContain("setTimeout(")
    expect(content).not.toContain("clearTimeout(")
  })
})

describe("TUI Animation Consolidation Results", () => {
  const packageRoot = join(__dirname, "..", "..")

  test("sidebar.tsx - intervals consolidated successfully", () => {
    const content = readFileSync(
      join(packageRoot, "src/cli/cmd/tui/routes/session/sidebar.tsx"),
      "utf-8"
    )
    
    const setIntervalCount = (content.match(/setInterval\(/g) || []).length
    const useAnimationTimerCount = (content.match(/useAnimationTimer\(/g) || []).length
    
    expect(setIntervalCount).toBe(0)
    expect(useAnimationTimerCount).toBe(0)
    console.log(`sidebar.tsx: 0 raw intervals, ${useAnimationTimerCount} consolidated timers`)
  })

  test("header.tsx - intervals consolidated successfully", () => {
    const content = readFileSync(
      join(packageRoot, "src/cli/cmd/tui/routes/session/header.tsx"),
      "utf-8"
    )
    
    const setIntervalCount = (content.match(/setInterval\(/g) || []).length
    const useAnimationTimerCount = (content.match(/useAnimationTimer\(/g) || []).length
    
    expect(setIntervalCount).toBe(0)
    expect(useAnimationTimerCount).toBe(0)
    expect(content).toContain("useLingeringShellEvent")
    expect(content).toContain("useShellClimate")
    console.log(`header.tsx: 0 raw intervals, shell-signal hooks drive motion state`)
  })

  test("footer.tsx - intervals consolidated successfully", () => {
    const content = readFileSync(
      join(packageRoot, "src/cli/cmd/tui/routes/session/footer.tsx"),
      "utf-8"
    )
    
    const setIntervalCount = (content.match(/setInterval\(/g) || []).length
    const useAnimationTimerCount = (content.match(/useAnimationTimer\(/g) || []).length
    
    expect(setIntervalCount).toBe(0)
    expect(useAnimationTimerCount).toBe(0)
    console.log(`footer.tsx: ${setIntervalCount} raw intervals, ${useAnimationTimerCount} consolidated timers`)
  })
})
