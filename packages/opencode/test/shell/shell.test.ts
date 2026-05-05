import { afterEach, expect, spyOn, test } from "bun:test"
import { Shell } from "../../src/shell/shell"

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform })
})

test("windows fallback prefers PowerShell 7 over cmd", () => {
  Object.defineProperty(process, "platform", { value: "win32" })
  const whichSpy = spyOn(Bun, "which").mockImplementation((name: string) => {
    if (name === "pwsh" || name === "pwsh.exe") return "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
    return null
  })

  expect(Shell.fallbackForPlatform("win32")).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
  expect(Shell.name("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe("pwsh")

  whichSpy.mockRestore()
})
